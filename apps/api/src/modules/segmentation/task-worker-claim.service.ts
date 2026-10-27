import { Injectable } from '@nestjs/common';
import {
  TaskWorkerClaimRepository,
  type ClaimOutcome,
  type TaskStatus,
} from './task-worker-claim.repository.js';

/**
 * AI 分割任务的领取与状态流转（业务语义）。
 *
 * ## 至少一次投递下的幂等保证（架构方案 §6.3）
 *
 *   > Redis Stream 可能重复投递，Worker 领取时校验 `status` 已是 running 则跳过
 *
 * 状态机（segmentation_task_status 枚举）：
 *
 *   queued ──claim──> running ──> succeeded
 *      │                │
 *      │                └──> failed
 *      │
 *      └──（消息被重复投递时命中 running/succeeded/failed -> 跳过）
 *
 * ## 关键：claim 必须是**条件更新**而非「先查后改」
 *
 * 若 Worker 先 SELECT 查 status 再 UPDATE，中间有竞态窗口 ——
 * 两个 Worker 都查到 queued，然后都去跑 GPU，产生重复计算。
 *
 * 用单条条件 UPDATE（`WHERE status = 'queued'`）由数据库保证原子性：
 * 只有一个 Worker 能把行从 queued 改成 running，其余的 UPDATE 影响 0 行，
 * 看到 0 行即「已被他人领取」-> 跳过。
 *
 * 这与 `segmentation_tasks.idempotency_key` 的唯一约束
 * （uq_seg_task_idempotency）配合，覆盖「重复投递不产生重复 GPU 计算」。
 *
 * SQL 在 `task-worker-claim.repository.ts`（repository 层）。
 */
@Injectable()
export class TaskWorkerClaimService {
  constructor(private readonly repository: TaskWorkerClaimRepository) {}

  /**
   * 尝试领取任务：把 `queued` 原子地改为 `running`。
   *
   * @param taskId 任务 id
   */
  async claim(taskId: string): Promise<ClaimOutcome> {
    const claimed = await this.repository.tryMarkRunning(taskId);
    if (claimed) {
      return { status: 'claimed', taskId };
    }

    // 未更新 -> 查当前状态以区分「不存在」与「跳过」
    const current = await this.repository.findStatus(taskId);
    if (!current) {
      return { status: 'not_found', taskId };
    }
    return { status: 'skipped', taskId, currentStatus: current };
  }

  /** 标记任务成功 */
  async markSucceeded(taskId: string, progressPercent = 100): Promise<boolean> {
    return this.repository.markSucceeded(taskId, progressPercent);
  }

  /** 标记任务失败 */
  async markFailed(
    taskId: string,
    error: { code: number; step: string; detail: string }
  ): Promise<boolean> {
    return this.repository.markFailed(taskId, error);
  }

  /** 更新进度（仅 running 状态可更新） */
  async updateProgress(taskId: string, percent: number): Promise<boolean> {
    return this.repository.updateProgress(taskId, percent);
  }

  /** 取任务当前状态 */
  async getStatus(taskId: string): Promise<TaskStatus | undefined> {
    return this.repository.findStatus(taskId);
  }
}
