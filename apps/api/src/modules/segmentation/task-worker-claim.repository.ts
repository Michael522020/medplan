import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne } from '../../common/db/pool.js';

/**
 * 分割任务状态流转的数据访问。
 *
 * SQL 只在本文件（repository 层）。
 */

/** 任务状态（DB 枚举 segmentation_task_status） */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** 领取结果 */
export type ClaimOutcome =
  /** 成功领取，任务已进入 running */
  | { status: 'claimed'; taskId: string }
  /** 已被他人领取或任务已结束 -> 跳过 */
  | { status: 'skipped'; taskId: string; currentStatus: string }
  /** 任务不存在 */
  | { status: 'not_found'; taskId: string };

@Injectable()
export class TaskWorkerClaimRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 条件更新：把 `queued` 原子地改为 `running`。
   *
   * 若 Worker 先 SELECT 查 status 再 UPDATE，中间有竞态窗口 ——
   * 两个 Worker 都查到 queued，然后都去跑 GPU，产生重复计算。
   * 用单条条件 UPDATE（`WHERE status = 'queued'`）由数据库保证原子性：
   * 只有一个 Worker 能把行从 queued 改成 running，其余的 UPDATE 影响 0 行。
   */
  async tryMarkRunning(taskId: string): Promise<boolean> {
    const result = await query<{ id: string }>(
      this.pool,
      `UPDATE segmentation_tasks
          SET status = 'running',
              started_at = now()
        WHERE id = $1
          AND status = 'queued'
          AND deleted_at IS NULL
        RETURNING id`,
      [taskId]
    );
    return result.rows.length > 0;
  }

  /** 取任务当前状态 */
  async findStatus(taskId: string): Promise<TaskStatus | undefined> {
    const row = await queryOne<{ status: TaskStatus }>(
      this.pool,
      `SELECT status FROM segmentation_tasks WHERE id = $1 AND deleted_at IS NULL`,
      [taskId]
    );
    return row?.status;
  }

  /**
   * 标记任务成功。
   *
   * 必须同时满足 `status = 'running'` —— 已 failed 的任务不能被后来的
   * 成功回调改写（那会让失败原因丢失，违反「禁止以空模型冒充成功」）。
   */
  async markSucceeded(taskId: string, progressPercent = 100): Promise<boolean> {
    const result = await query(
      this.pool,
      `UPDATE segmentation_tasks
          SET status = 'succeeded',
              progress_percent = $2,
              finished_at = now()
        WHERE id = $1
          AND status = 'running'
          AND deleted_at IS NULL`,
      [taskId, progressPercent]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * 标记任务失败。
   *
   * DB 约束 `ck_seg_task_failure_detail` 要求失败时必须同时有
   * error_code 与 error_step —— 这里显式要求调用方提供，不给默认值，
   * 避免「失败但不知道失败在哪一步」这种无用记录。
   */
  async markFailed(
    taskId: string,
    error: { code: number; step: string; detail: string }
  ): Promise<boolean> {
    const result = await query(
      this.pool,
      `UPDATE segmentation_tasks
          SET status = 'failed',
              error_code = $2,
              error_step = $3,
              error_detail = $4,
              finished_at = now()
        WHERE id = $1
          AND status = 'running'
          AND deleted_at IS NULL`,
      [taskId, error.code, error.step, error.detail]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** 更新进度（仅 running 状态可更新） */
  async updateProgress(taskId: string, percent: number): Promise<boolean> {
    const result = await query(
      this.pool,
      `UPDATE segmentation_tasks
          SET progress_percent = $2
        WHERE id = $1
          AND status = 'running'
          AND deleted_at IS NULL`,
      [taskId, percent]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
