import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

import { withBusinessSearchPath } from '../common/db/pool.js';
import { TaskOutboxRepository } from '../modules/segmentation/task-outbox.repository.js';
import { TaskDispatcherService } from '../modules/segmentation/task-dispatcher.service.js';
import { TaskWorkerClaimService } from '../modules/segmentation/task-worker-claim.service.js';
import { TaskWorkerClaimRepository } from '../modules/segmentation/task-worker-claim.repository.js';
import { TaskWorkerConsumerService } from '../modules/segmentation/task-worker-consumer.service.js';
import { RedisQueueClient } from '../common/queue/redis-queue.client.js';

/**
 * 任务队列的**集成测试**（真实 PostgreSQL + 真实 Redis）。
 *
 * 覆盖 lead 指定的三个场景：
 *   1. 投递失败时任务状态与 outbox 的一致性
 *   2. Worker 重复领取时 status 已是 running 的跳过路径
 *   3. 至少一次投递下不产生重复任务（配合 idempotency_key 唯一约束）
 *
 * ## 为什么必须用真数据库/真 Redis
 *
 * 投递失败后的补偿、重复领取的跳过，都依赖**数据库的条件更新原子性**
 * 与 **Redis Stream 的真实语义**。用 mock 测这些等于没测 ——
 * mock 掉的条件更新恰好就是并发正确性的全部。
 *
 * 需要环境变量：
 *   TEST_DATABASE_URL  指向已建好 schema 的 PostgreSQL 18
 *   TEST_REDIS_URL     指向 Redis 8
 * 未设置时整个套件跳过（不产生假绿）。
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

const describeIf = databaseUrl && redisUrl ? describe : describe.skip;

/**
 * 准备最小种子数据（user / patient / visit / study / series）。
 *
 * 测试库可能是**全新的空库**（CI 每次重建），
 * 因此这里自建种子而不是依赖预置数据。
 * 已存在时不重复插入（幂等）。
 */
async function ensureSeedData(pool: Pool): Promise<void> {
  const existing = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM medplan.users`
  );
  if ((existing.rows[0]?.n ?? 0) > 0) return;

  await pool.query(`
    INSERT INTO medplan.users (id, login_name, display_name, keycloak_subject, title, department_code)
    VALUES ('11111111-1111-4111-8111-111111111111', 'dr.test', '测试医师',
            'kc-test-subject', '主任医师', '医学影像科')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO medplan.patients (id, empi_id, name, gender, birth_date, id_card_masked)
    VALUES ('22222222-2222-4222-8222-222222222222', 'EMPI00000001', '测试患者', 'M',
            DATE '1980-01-01', '310***********1234')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO medplan.visits (id, visit_no, patient_id, visit_type, dept, is_inpatient)
    VALUES ('33333333-3333-4333-8333-333333333333', 'TEST-VISIT-001',
            '22222222-2222-4222-8222-222222222222', 'outpatient', '医学影像科', false)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO medplan.studies (id, study_uid, visit_id, patient_id, accession_no, modality,
                                 body_part, study_date, status)
    VALUES ('44444444-4444-4444-8444-444444444444', '1.2.840.10008.5.1.4.1.1.2.TEST',
            '33333333-3333-4333-8333-333333333333',
            '22222222-2222-4222-8222-222222222222',
            'ACC-TEST-001', 'CT', 'ABDOMEN', now(), 'completed')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO medplan.series (id, series_uid, study_id, study_uid, series_number, phase,
                                phase_confidence, instance_count, slice_thickness_mm, rows, columns)
    VALUES ('55555555-5555-4555-8555-555555555555', '1.2.840.10008.5.1.4.1.1.2.TEST.SER1',
            '44444444-4444-4444-8444-444444444444',
            '1.2.840.10008.5.1.4.1.1.2.TEST', 1, 'portal', 0.950, 100, 1.0, 512, 512)
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * 确认 outbox 表可用。
 *
 * 表由 `docs/db/migrations/002_add_task_outbox.sql` 创建。
 * 测试用的账号是 app_rw —— 它**没有** schema 的 CREATE 权限（生产环境
 * 权限分离的结果：业务账号不该能建表），所以这里只**校验**表存在，
 * 不尝试建表。表不存在时给出明确指引而不是让测试莫名失败。
 */
async function ensureOutboxTable(pool: Pool): Promise<void> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'medplan' AND table_name = 'task_outbox'
     ) AS exists`
  );
  if (!result.rows[0]?.exists) {
    throw new Error(
      '测试库缺少 medplan.task_outbox 表。' +
        '请先执行：psql -v ON_ERROR_STOP=1 -f docs/db/migrations/002_add_task_outbox.sql'
    );
  }
}

describeIf('任务队列集成测试（真实 PostgreSQL + Redis）', () => {
  let pool: Pool;
  let redis: Redis;
  let outboxRepository: TaskOutboxRepository;
  let dispatcher: TaskDispatcherService;
  let claimService: TaskWorkerClaimService;
  let queueClient: RedisQueueClient;
  const createdTaskIds: string[] = [];
  const streamKey = `medplan:test:ai:tasks:${process.pid}`;

  before(async () => {
    // 用与应用相同的连接串处理：应用侧靠 withBusinessSearchPath 保证 search_path，
    // 测试若用裸连接串会因 search_path 不同而报 42P01 ——
    // 那正是缺陷 1 本身，测试不应依赖 DB 级设置。
    pool = new Pool({ connectionString: withBusinessSearchPath(databaseUrl as string) });
    redis = new Redis(redisUrl as string);

    await ensureOutboxTable(pool);
    await ensureSeedData(pool);

    outboxRepository = new TaskOutboxRepository(pool);
    claimService = new TaskWorkerClaimService(new TaskWorkerClaimRepository(pool));

    const queueConfig = {
      url: redisUrl as string,
      streamKey,
      consumerGroup: 'test-workers',
      consumerName: `test-${process.pid}`,
      blockTimeoutMs: 100,
      claimIdleMs: 1000,
    };
    queueClient = new RedisQueueClient(queueConfig);
    // 用一个「永远失败」的队列客户端来模拟投递失败
    const failingQueue = {
      publish: async () => {
        throw new Error('模拟 Redis 不可达');
      },
    } as unknown as RedisQueueClient;

    dispatcher = new TaskDispatcherService(outboxRepository, failingQueue, pool);
  });

  after(async () => {
    // 清理测试数据
    if (createdTaskIds.length > 0) {
      await pool.query(
        `DELETE FROM medplan.task_outbox WHERE task_id = ANY($1::uuid[])`,
        [createdTaskIds]
      );
      await pool.query(
        `DELETE FROM medplan.segmentation_tasks WHERE id = ANY($1::uuid[])`,
        [createdTaskIds]
      );
    }
    await redis.del(streamKey);
    await redis.quit();
    await pool.end();
    // 队列客户端自己也持有一个连接，必须关掉，
    // 否则 Node 进程会因未关闭的 socket 而**挂住不退出的**，
    // 测试全绿但命令跑不完（这比测试失败更难排查）。
    await queueClient.onModuleDestroy();
  });

/**
 * 造一个最小可用的分割任务行。
 *
 * 用真实的 study/series/user 外键（DB 有 NOT NULL 与外键约束，
 * 造不出假外键）。测试数据在 after 里清理。
 */
  async function createTask(idempotencyKey: string): Promise<string> {
    await ensureSeedData(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO medplan.segmentation_tasks (
         study_id, study_uid, series_id, model_name, submitted_by, idempotency_key, status
       )
       SELECT s.study_id, st.study_uid, s.id, 'total', u.id, $1, 'queued'
         FROM medplan.series s
         JOIN medplan.studies st ON st.id = s.study_id
         CROSS JOIN (SELECT id FROM medplan.users LIMIT 1) u
        ORDER BY s.series_number
        LIMIT 1
       RETURNING id`,
      [idempotencyKey]
    );
    const taskId = rows[0]?.id;
    assert.ok(taskId, '测试前置：需要至少一个 series、study 与 user');
    createdTaskIds.push(taskId);
    return taskId;
  }

  it('场景 1：投递失败时，outbox 仍为 pending 且带重试时间（任务不丢）', async () => {
    const taskId = await createTask('11111111-1111-4111-8111-111111111111');

    // 登记 outbox（模拟业务事务里的 enqueue）
    await outboxRepository.enqueue(pool, {
      taskId,
      taskType: 'segmentation_task',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      payload: { task_id: taskId },
    });

    // 投递失败
    const dispatched = await dispatcher.dispatchPending();
    assert.equal(dispatched, 0, '投递失败时不应有成功计数');

    const row = await outboxRepository.findByTaskId(taskId);
    assert.ok(row, 'outbox 行必须存在');
    assert.equal(row.dispatch_status, 'pending', '投递失败后必须仍是 pending（可被补偿）');
    assert.equal(row.attempt_count, 1, '尝试次数应累加');
    assert.ok(row.next_retry_at, '应设置下次重试时间（退避）');
    assert.ok(row.last_error, '应记录失败原因');

    // 任务本身状态不变，仍是 queued（未被误标为失败）
    const status = await claimService.getStatus(taskId);
    assert.equal(status, 'queued');

    // 不变量：任务存在 ⟺ 有待投递凭据
    const pending = await outboxRepository.countPending();
    assert.ok(pending >= 1, '待投递行数应 >= 1');
  });

  it('场景 1b：投递成功后 outbox 变为 dispatched，且记录 Stream 消息 ID', async () => {
    const taskId = await createTask('22222222-2222-4222-8222-222222222222');
    await outboxRepository.enqueue(pool, {
      taskId,
      taskType: 'segmentation_task',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      payload: { task_id: taskId },
    });

    // 用真实 Redis 队列投递
    const messageId = await queueClient.publish({
      task_id: taskId,
      task_type: 'segmentation_task',
      payload: JSON.stringify({ task_id: taskId }),
    });
    assert.ok(messageId, '应拿到 Stream 消息 ID');

    await outboxRepository.markDispatched(pool, (await outboxRepository.findByTaskId(taskId))?.id as string, messageId);

    const row = await outboxRepository.findByTaskId(taskId);
    assert.equal(row?.dispatch_status, 'dispatched');
    assert.equal(row?.stream_message_id, messageId);
    assert.equal(row?.attempt_count, 0);
  });

  it('场景 2：Worker 重复领取时，status 已是 running 的路径被跳过', async () => {
    const taskId = await createTask('33333333-3333-4333-8333-333333333333');

    // 第一次领取：成功
    const first = await claimService.claim(taskId);
    assert.equal(first.status, 'claimed', '首次领取应成功');

    // 第二次领取（模拟重复投递）：应跳过
    const second = await claimService.claim(taskId);
    assert.equal(second.status, 'skipped', '重复领取必须跳过');
    assert.equal(
      second.status === 'skipped' ? second.currentStatus : '',
      'running',
      '跳过时应报告当前状态为 running'
    );
  });

  it('场景 2b：消费者遇到重复投递时不重复执行推理', async () => {
    const taskId = await createTask('44444444-4444-4444-8444-444444444444');

    let runCount = 0;
    const consumer = new TaskWorkerConsumerService(
      queueClient,
      claimService,
      {
        run: async () => {
          runCount += 1;
        },
      }
    );

    // 第一条消息：正常执行
    await consumer.handleMessage({
      id: '1-0',
      fields: { task_id: taskId },
    });
    assert.equal(runCount, 1, '首次应执行推理');
    assert.equal(await claimService.getStatus(taskId), 'succeeded');

    // 重复投递同一条消息：应跳过，不重复执行
    await consumer.handleMessage({
      id: '2-0',
      fields: { task_id: taskId },
    });
    assert.equal(runCount, 1, '重复投递不得重复执行推理（不产生重复 GPU 计算）');
    assert.equal(await claimService.getStatus(taskId), 'succeeded');
  });

  it('场景 3：至少一次投递下，幂等键唯一约束保证不产生重复任务', async () => {
    const key = '55555555-5555-4555-8555-555555555555';
    const taskId = await createTask(key);

    // 用同一个幂等键再建一个任务 -> 必须被唯一约束拒绝
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO medplan.segmentation_tasks (
             study_id, study_uid, series_id, model_name, submitted_by, idempotency_key, status
           )
           SELECT s.study_id, st.study_uid, s.id, 'total', u.id, $1, 'queued'
             FROM medplan.series s
             JOIN medplan.studies st ON st.id = s.study_id
             CROSS JOIN (SELECT id FROM medplan.users LIMIT 1) u
            ORDER BY s.series_number
            LIMIT 1`,
          [key]
        );
      },
      (err: unknown) => {
        // 23505 = unique_violation
        assert.match(String((err as { code?: string }).code), /23505/);
        return true;
      },
      '同一幂等键不得产生第二个任务'
    );

    const count = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM medplan.segmentation_tasks WHERE idempotency_key = $1`,
      [key]
    );
    assert.equal(count.rows[0]?.count, 1, '幂等键对应的任务应恰好 1 条');
    assert.ok(taskId);
  });

  it('场景 3b：outbox 对同一任务重复登记只留一行（ON CONFLICT DO NOTHING）', async () => {
    const taskId = await createTask('66666666-6666-4666-8666-666666666666');
    const params = {
      taskId,
      taskType: 'segmentation_task',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      payload: { task_id: taskId },
    };
    await outboxRepository.enqueue(pool, params);
    await outboxRepository.enqueue(pool, params);
    await outboxRepository.enqueue(pool, params);

    const rows = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM medplan.task_outbox WHERE task_id = $1`,
      [taskId]
    );
    assert.equal(rows.rows[0]?.count, 1, '同一任务只应有一条 outbox 行');
  });

  it('场景 3c：Redis Stream 真实投递与领取（端到端）', async () => {
    const taskId = await createTask('77777777-7777-4777-8777-777777777777');

    // 先确保消费组存在 —— 组用 '$' 创建，只接收**组创建之后**的消息，
    // 所以必须先建组再投递，否则消息会被跳过。
    await queueClient.ensureConsumerGroup();

    const messageId = await queueClient.publish({
      task_id: taskId,
      task_type: 'segmentation_task',
      payload: JSON.stringify({ task_id: taskId }),
    });
    assert.ok(messageId);

    // 消费者领取并处理
    const consumer = new TaskWorkerConsumerService(queueClient, claimService, {
      run: async () => {},
    });
    const batch = await queueClient.claimBatch(5);
    const mine = batch.find((m) => m.fields.task_id === taskId);
    assert.ok(mine, '应领取到刚投递的消息');

    await consumer.handleMessage(mine);
    assert.equal(await claimService.getStatus(taskId), 'succeeded');

    // ACK 后 pending 归零
    const pending = await queueClient.pendingCount();
    assert.equal(pending, 0, 'ACK 后不应有未确认消息');
  });
});
