import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { RedisQueueClient, type RedisStreamMessage } from '../../common/queue/redis-queue.client.js';
import { TaskWorkerClaimService } from './task-worker-claim.service.js';

/**
 * 推理执行器端口。
 *
 * 实际实现是 AI Worker（Python + TotalSegmentator），
 * 通过内部 HTTP 回调或消息回传结果。本模块只定义契约，
 * 保持后端与 AI 引擎解耦（架构方案 §5：AI 是独立服务）。
 */
export interface InferenceRunner {
  /**
   * 执行推理。
   *
   * @param taskId 任务 id
   * @throws 失败时抛错，由调用方标记任务 failed
   */
  run(taskId: string): Promise<void>;
}

/**
 * 推理执行器的 DI 令牌。
 *
 * interface 编译后被擦除，不能直接当 Nest 令牌用（会得到 undefined）。
 */
export const INFERENCE_RUNNER = 'INFERENCE_RUNNER';

/**
 * 任务消息消费者。
 *
 * ## 至少一次投递下的处理流程（架构方案 §6.3）
 *
 * ```
 * XREADGROUP 领取消息
 *   -> 查库看 status
 *      - queued   -> 置 running（条件更新）-> 调 GPU 推理 -> 回写结果 -> 置 succeeded
 *      - running  -> 说明已被其他 Worker 领取，XACK 后跳过
 *      - succeeded/failed -> XACK 后跳过
 * ```
 *
 * ## 为什么「条件更新」而不是「先查后改」
 *
 * 先 SELECT 查 status、再 UPDATE，中间有竞态窗口：两个 Worker 都查到
 * queued，然后都去跑 GPU，产生重复计算（一次腹部 CT 分割要占 GPU 十分钟）。
 * 用单条 `UPDATE ... WHERE status = 'queued'` 由数据库保证原子性。
 *
 * ## XACK 的时机
 *
 * **在处理完成之后**才 ACK。若 Worker 在处理中崩溃，消息留在
 * Pending Entries List，可被其他 Worker 通过 XAUTOCLAIM 认领 ——
 * 这正是「至少一次投递不丢消息」的落点。
 */
@Injectable()
export class TaskWorkerConsumerService implements OnModuleInit {
  /** 轮询间隔（毫秒） */
  private static readonly POLL_INTERVAL_MS = 1000;
  /** 单批处理条数 */
  private static readonly BATCH_SIZE = 10;
  /** 定时器 */
  private timer: NodeJS.Timeout | null = null;
  /** 防重入 */
  private running = false;

  constructor(
    private readonly queueClient: RedisQueueClient,
    private readonly claimService: TaskWorkerClaimService,
    @Inject(INFERENCE_RUNNER) private readonly runner: InferenceRunner
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, TaskWorkerConsumerService.POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 处理一轮消息。
   *
   * 暴露为 public 便于测试直接驱动。
   *
   * @returns 本轮处理的消息数
   */
  async pollOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      // 先认领超时未处理的消息（其他 Worker 崩溃后的恢复），
      // 再领新消息
      const stale = await this.queueClient.claimStale(
        await this.claimIdleMs(),
        TaskWorkerConsumerService.BATCH_SIZE
      );
      const fresh = await this.queueClient.claimBatch(TaskWorkerConsumerService.BATCH_SIZE);
      const messages = [...stale, ...fresh];
      for (const message of messages) {
        await this.handleMessage(message);
      }
      return messages.length;
    } finally {
      this.running = false;
    }
  }

  /**
   * 处理单条消息。
   *
   * 状态机的全部分支都在这里 —— 重复投递的跳过路径是最关键的一条。
   */
  async handleMessage(message: RedisStreamMessage): Promise<void> {
    const taskId = message.fields.task_id;
    if (!taskId) {
      // 消息格式不对：ACK 掉，否则会永远在 Pending 里循环
      await this.queueClient.acknowledge([message.id]);
      return;
    }

    const outcome = await this.claimService.claim(taskId);
    if (outcome.status === 'not_found') {
      // 任务不存在（例如被删）：ACK 掉，不重试
      await this.queueClient.acknowledge([message.id]);
      return;
    }
    if (outcome.status === 'skipped') {
      // 已被其他 Worker 领取，或任务已结束 -> 跳过
      // 这是**至少一次投递不产生重复 GPU 计算**的关键分支
      await this.queueClient.acknowledge([message.id]);
      return;
    }

    // 成功领取：执行推理
    try {
      await this.runner.run(taskId);
      await this.claimService.markSucceeded(taskId);
    } catch (err) {
      await this.claimService.markFailed(taskId, {
        code: 40002, // AI 推理失败（契约错误码）
        step: 'inference',
        detail: (err as Error).message,
      });
    } finally {
      // 无论成败都 ACK：失败的任务状态已在库里，不会重复处理
      await this.queueClient.acknowledge([message.id]);
    }
  }

  /** 未 ACK 消息的认领超时 */
  private async claimIdleMs(): Promise<number> {
    return Number(process.env.AI_TASK_CLAIM_IDLE_MS ?? 300000);
  }
}
