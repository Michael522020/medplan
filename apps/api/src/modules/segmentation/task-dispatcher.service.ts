import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, withTransaction, type Queryable } from '../../common/db/pool.js';
import { RedisQueueClient } from '../../common/queue/redis-queue.client.js';
import { TaskOutboxRepository } from './task-outbox.repository.js';

/**
 * 任务投递器。
 *
 * ## 为什么是 outbox 而不是「先投递后落库」
 *
 * 任务落库（PostgreSQL）与投递队列（Redis）**跨系统无事务**。
 * 两种朴素做法都有丢任务的路径：
 *   - 先投递后落库：Worker 拉取时任务还不存在 -> 空转，消息被消费掉后任务才落库 -> 永远没人做
 *   - 先落库后投递，投递失败就放弃：任务躺在库里 -> **静默丢任务**
 *
 * outbox 把「待投递」持久化到业务库，得到可查的不变量：
 *   **任务存在 ⟺ 队列有消息**
 * 投递失败时 outbox 行仍是 pending，由扫描器补偿。
 *
 * ## 投递顺序（lead 明确要求）
 *
 * **必须先落库后投递**。反过来的话 Worker 拉取时任务还不存在。
 * 本实现用「同事务写 outbox -> 提交后投递」满足这一点：
 * 事务提交时任务与 outbox 行**都已存在**，之后才可能出现在队列里。
 *
 * ## 失败语义
 *
 * 投递失败**不抛给调用方**。理由：任务已经落库（用户视角「提交成功」），
 * 投递失败是**基础设施问题**，应该由 outbox 补偿而不是让用户重试。
 * 若把投递失败抛给用户，用户重试会产生第二个任务 ——
 * 虽然 `idempotency_key` 唯一约束能兜住，但错误语义会误导用户。
 */
@Injectable()
export class TaskDispatcherService implements OnModuleInit {
  /** 扫描间隔（毫秒） */
  private static readonly SCAN_INTERVAL_MS = 5000;
  /** 单批最多投递的行数 */
  private static readonly BATCH_SIZE = 50;
  /** 定时器句柄 */
  private timer: NodeJS.Timeout | null = null;
  /** 防止重入（上一轮扫描未结束时不启动新一轮） */
  private scanning = false;

  constructor(
    private readonly outboxRepository: TaskOutboxRepository,
    private readonly queueClient: RedisQueueClient,
    @Inject(DB_POOL) private readonly pool: Pool
  ) {}

  /** 启动补偿扫描器 */
  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchPending();
    }, TaskDispatcherService.SCAN_INTERVAL_MS);
    // 不阻止进程退出
    this.timer.unref?.();
  }

  /** 停止扫描器 */
  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 在业务事务内登记待投递任务。
   *
   * **必须**与业务写入（任务落库、审计写入）在同一事务中调用。
   * 这样「任务已落库但没有 outbox 行」这个丢任务路径被消除。
   */
  async enqueue(
    client: Queryable,
    params: {
      taskId: string;
      taskType: string;
      idempotencyKey: string | null;
      payload: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.outboxRepository.enqueue(client, params);
  }

  /**
   * 扫描并投递待处理的 outbox 行。
   *
   * @returns 本轮成功投递的条数
   */
  async dispatchPending(): Promise<number> {
    if (this.scanning) return 0;
    this.scanning = true;
    try {
      return await withTransaction(this.pool, async (client) => {
        const rows = await this.outboxRepository.claimPending(
          client,
          TaskDispatcherService.BATCH_SIZE
        );
        let dispatched = 0;

        for (const row of rows) {
          try {
            const messageId = await this.queueClient.publish({
              task_id: row.task_id,
              task_type: row.task_type,
              idempotency_key: row.idempotency_key ?? '',
              payload: JSON.stringify(row.payload),
            });
            await this.outboxRepository.markDispatched(client, row.id, messageId);
            dispatched += 1;
          } catch (err) {
            // 投递失败：标记并退避重试。**不中断整批** ——
            // 一条坏数据不该阻塞其余所有任务的投递。
            await this.outboxRepository.markFailed(
              client,
              row.id,
              (err as Error).message,
              row.attempt_count
            );
          }
        }
        return dispatched;
      });
    } finally {
      this.scanning = false;
    }
  }
}
