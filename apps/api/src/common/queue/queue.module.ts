import { Module } from '@nestjs/common';

import {
  REDIS_CLIENT,
  RedisQueueClient,
  loadRedisQueueConfig,
} from './redis-queue.client.js';
import { TaskOutboxRepository } from '../../modules/segmentation/task-outbox.repository.js';
import { TaskDispatcherService } from '../../modules/segmentation/task-dispatcher.service.js';
import { TaskWorkerClaimService } from '../../modules/segmentation/task-worker-claim.service.js';
import { TaskWorkerClaimRepository } from '../../modules/segmentation/task-worker-claim.repository.js';
import {
  INFERENCE_RUNNER,
  TaskWorkerConsumerService,
  type InferenceRunner,
} from '../../modules/segmentation/task-worker-consumer.service.js';

/**
 * 任务队列模块（Redis Stream + outbox）。
 *
 * ## 职责边界
 *
 * | 组件 | 职责 |
 * |------|------|
 * | `TaskOutboxRepository` | outbox 表读写（SQL） |
 * | `TaskDispatcherService` | 投递侧：扫 outbox -> XADD -> 标记已投递 |
 * | `TaskWorkerClaimService` | 领取侧：状态机流转（条件更新保证原子性） |
 * | `TaskWorkerConsumerService` | 消费循环：XREADGROUP -> 领取 -> 推理 -> ACK |
 * | `RedisQueueClient` | Redis Stream 原语封装 |
 *
 * ## 为什么 `InferenceRunner` 未在本模块提供实现
 *
 * 实际推理在 AI Worker（Python + TotalSegmentator）里，是**独立服务**
 * （架构方案 §5）。本模块只定义端口（`INFERENCE_RUNNER` 令牌），
 * 由部署方注入对应实现 —— 后端不直接跑 GPU 推理。
 */
@Module({
  providers: [
    TaskOutboxRepository,
    TaskDispatcherService,
    TaskWorkerClaimRepository,
    TaskWorkerClaimService,
    TaskWorkerConsumerService,
    RedisQueueClient,
    {
      provide: REDIS_CLIENT,
      useFactory: () => loadRedisQueueConfig(),
    },
    {
      // 推理执行器端口。默认实现是「拒绝执行」——
      // 未接入真实 AI Worker 时，宁可任务留在 running 被人工发现，
      // 也不要伪造一个「成功」结果（那违反「禁止以空模型冒充成功」）。
      provide: INFERENCE_RUNNER,
      useFactory: (): InferenceRunner => ({
        run: async (taskId: string) => {
          throw new Error(`未配置 AI 推理执行器，任务 ${taskId} 无法执行推理`);
        },
      }),
    },
  ],
  exports: [
    TaskOutboxRepository,
    TaskDispatcherService,
    TaskWorkerClaimRepository,
    TaskWorkerClaimService,
    TaskWorkerConsumerService,
    RedisQueueClient,
    REDIS_CLIENT,
  ],
})
export class QueueModule {}
