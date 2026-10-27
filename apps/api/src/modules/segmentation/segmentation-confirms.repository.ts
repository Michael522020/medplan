import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, type Queryable } from '../../common/db/pool.js';

/**
 * 医师逐项确认的数据访问。
 *
 * 单独成文件：确认记录是「AI 标记的合规留痕」，
 * 与任务本身的读写关注点不同，且它的**写入语义**（幂等 / 最后一次为准）
 * 需要独立审阅。
 */
export interface ConfirmRow {
  structure_name: string;
  action: string;
  modification_note: string | null;
  volume_ml_snapshot: string | null;
  confirmed_by: string;
  confirmed_at: Date;
  pending_supervisor_review: boolean;
}

@Injectable()
export class SegmentationConfirmsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** 取任务的全部确认记录 */
  async findConfirms(taskId: string): Promise<ConfirmRow[]> {
    const result = await query<ConfirmRow>(
      this.pool,
      `SELECT structure_name,
              action,
              modification_note,
              volume_ml_snapshot,
              confirmed_by,
              confirmed_at,
              pending_supervisor_review
         FROM segmentation_confirms
        WHERE task_id = $1
        ORDER BY confirmed_at`,
      [taskId]
    );
    return result.rows;
  }

  /**
   * 取任务的分割结构名集合（用于校验确认项是否属于本任务）。
   */
  async findStructureNames(taskId: string): Promise<Set<string>> {
    const result = await query<{ structure_name: string }>(
      this.pool,
      `SELECT structure_name FROM segmentations WHERE task_id = $1`,
      [taskId]
    );
    return new Set(result.rows.map((row) => row.structure_name));
  }

  /**
   * 写入确认记录。
   *
   * ## 幂等与「最后一次为准」
   *
   * 契约要求：
   *   > 同一 `structureName` 重复确认以最后一次为准，每次变更追加
   *   > `segmentation_confirms` 记录（append-only，不 UPDATE）
   *
   * 但 DB 约束 `uq_seg_confirm_task_structure UNIQUE (task_id, structure_name)`
   * 意味着同一 (task, structure) **只能有一行**。
   *
   * 两者只能二选一。DB 约束是**物理事实**（无法绕过），
   * 因此这里用 `ON CONFLICT DO UPDATE` 实现「最后一次为准」的**可观测语义**，
   * 并在 `confirmed_at` 上留痕变更时刻。
   *
   * 「append-only」的完整留痕由 `plans.plan_commands` 风格的变更日志承担；
   * 若后续法务要求逐次确认都独立成行，需要 DB 侧放宽唯一约束
   * （改为部分唯一索引 + 保留历史行），这属于 schema 变更，需项目裁决。
   */
  async upsertConfirm(
    client: Queryable,
    params: {
      taskId: string;
      structureName: string;
      action: string;
      modificationNote: string | null;
      volumeMlSnapshot: string | null;
      confirmedBy: string;
      pendingSupervisorReview: boolean;
      idempotencyKey: string;
    }
  ): Promise<void> {
    await query(
      client,
      `INSERT INTO segmentation_confirms (
         task_id, structure_name, action, modification_note, volume_ml_snapshot,
         confirmed_by, confirmed_at, pending_supervisor_review, idempotency_key, retention_class
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, 'plan_15y')
       ON CONFLICT (task_id, structure_name) DO UPDATE SET
         action = EXCLUDED.action,
         modification_note = EXCLUDED.modification_note,
         volume_ml_snapshot = EXCLUDED.volume_ml_snapshot,
         confirmed_by = EXCLUDED.confirmed_by,
         confirmed_at = now(),
         pending_supervisor_review = EXCLUDED.pending_supervisor_review,
         idempotency_key = EXCLUDED.idempotency_key`,
      [
        params.taskId,
        params.structureName,
        params.action,
        params.modificationNote,
        params.volumeMlSnapshot,
        params.confirmedBy,
        params.pendingSupervisorReview,
        params.idempotencyKey,
      ]
    );
  }
}
