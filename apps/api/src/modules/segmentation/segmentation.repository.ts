import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne, type Queryable } from '../../common/db/pool.js';
import type {
  SegmentationStructureRow,
  SegmentationTaskRow,
} from './segmentation-types.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
} from '../../common/db/access-scope.repository.js';

/**
 * AI 分割任务的数据访问。
 */

@Injectable()
export class SegmentationRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 按幂等键查任务。
   *
   * 幂等重放的判定依据（契约 §2）：
   *   同一 Idempotency-Key + 同一请求体 -> 返回首次结果
   */
  async findByIdempotencyKey(key: string): Promise<SegmentationTaskRow | undefined> {
    return queryOne<SegmentationTaskRow>(
      this.pool,
      `SELECT t.id,
              t.study_uid,
              se.series_uid,
              t.model_name,
              t.model_version,
              t.weights_version,
              t.fast_flag,
              t.degraded,
              t.status,
              t.progress_percent,
              t.phase_checked,
              t.phase_eligible,
              t.error_code,
              t.error_step,
              t.error_detail,
              t.submitted_by,
              t.started_at,
              t.finished_at,
              t.created_at
         FROM segmentation_tasks t
         JOIN series se ON se.id = t.series_id
        WHERE t.idempotency_key = $1
          AND t.deleted_at IS NULL`,
      [key]
    );
  }

  /**
   * 探测检查是否可见（恒定索引路径的探测查询）。
   *
   * 返回 `studyId`（studies.id）—— 分割任务表的 `study_id` 外键指向的是它，
   * **不是** patient_id。
   */
  async probeStudy(studyUid: string): Promise<{ studyId: string } | undefined> {
    return queryOne<{ studyId: string }>(
      this.pool,
      `SELECT id AS "studyId"
         FROM studies
        WHERE study_uid = $1
          AND deleted_at IS NULL`,
      [studyUid]
    );
  }

  /**
   * 探测序列是否存在，并取其所属检查与期相。
   *
   * 同时返回 `seriesId`（series.id）—— 分割任务表的 `series_id` 外键指向它。
   * 期相一并取回，避免再发一次查询。
   */
  async probeSeries(
    seriesUid: string
  ): Promise<
    | {
        seriesId: string;
        studyId: string;
        studyUid: string;
        phase: string;
        phase_confidence: number | null;
      }
    | undefined
  > {
    return queryOne<{
      seriesId: string;
      studyId: string;
      studyUid: string;
      phase: string;
      phase_confidence: number | null;
    }>(
      this.pool,
      `SELECT id AS "seriesId",
              study_id AS "studyId",
              study_uid AS "studyUid",
              phase,
              phase_confidence
         FROM series
        WHERE series_uid = $1
          AND deleted_at IS NULL`,
      [seriesUid]
    );
  }

  /**
   * 创建分割任务。
   *
   * @param client 事务客户端。任务创建与幂等键占用必须在同一事务里，
   *                否则并发双击会产生两个任务（数据库唯一约束会拦下第二个，
   *                但那时已经多消耗了一次 AI 入队）
   */
  async createTask(
    client: Queryable,
    params: {
      studyId: string;
      studyUid: string;
      seriesId: string;
      modelName: string;
      modelVersion: string;
      weightsVersion: string | null;
      fast: boolean;
      degraded: boolean;
      phaseChecked: string;
      phaseEligible: boolean;
      submittedBy: string;
      idempotencyKey: string;
    }
  ): Promise<SegmentationTaskRow> {
    const row = await queryOne<SegmentationTaskRow>(
      client,
      `INSERT INTO segmentation_tasks (
         study_id, study_uid, series_id, model_name, model_version, weights_version,
         fast_flag, degraded, status, progress_percent,
         phase_checked, phase_eligible, submitted_by, idempotency_key, retention_class
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, 'queued', 0,
         $9, $10, $11, $12, 'plan_15y'
       )
       RETURNING id,
                 study_uid,
                 (SELECT series_uid FROM series WHERE id = $3) AS series_uid,
                 model_name,
                 model_version,
                 weights_version,
                 fast_flag,
                 degraded,
                 status,
                 progress_percent,
                 phase_checked,
                 phase_eligible,
                 error_code,
                 error_step,
                 error_detail,
                 submitted_by,
                 started_at,
                 finished_at,
                 created_at`,
      [
        params.studyId,
        params.studyUid,
        params.seriesId,
        params.modelName,
        params.modelVersion,
        params.weightsVersion,
        params.fast,
        params.degraded,
        params.phaseChecked,
        params.phaseEligible,
        params.submittedBy,
        params.idempotencyKey,
      ]
    );
    if (!row) throw new Error('分割任务创建失败');
    return row;
  }

  /**
   * 按任务 ID 取任务（带可见性判定）。
   *
   * 可见性谓词下推到 WHERE：不可见 -> 0 行，与「不存在」同样 0 行。
   */
  async findTaskById(
    taskId: string,
    access: AccessContext
  ): Promise<SegmentationTaskRow | undefined> {
    const visibility = patientVisibilityPredicate('s.patient_id', access);
    const where = andWhere(
      visibility,
      { sql: 't.deleted_at IS NULL', values: [] },
      eq('t.id', taskId)
    );
    return queryOne<SegmentationTaskRow>(
      this.pool,
      `SELECT t.id,
              t.study_uid,
              se.series_uid,
              t.model_name,
              t.model_version,
              t.weights_version,
              t.fast_flag,
              t.degraded,
              t.status,
              t.progress_percent,
              t.phase_checked,
              t.phase_eligible,
              t.error_code,
              t.error_step,
              t.error_detail,
              t.submitted_by,
              t.started_at,
              t.finished_at,
              t.created_at
         FROM segmentation_tasks t
         JOIN series se ON se.id = t.series_id
         JOIN studies s ON s.id = t.study_id
        WHERE ${where.sql}`,
      where.values
    );
  }

  /** 探测任务是否存在（不含权限判定，恒定索引路径） */
  async probeTask(taskId: string): Promise<{ studyId: string } | undefined> {
    return queryOne<{ studyId: string }>(
      this.pool,
      `SELECT study_id AS "studyId"
         FROM segmentation_tasks
        WHERE id = $1
          AND deleted_at IS NULL`,
      [taskId]
    );
  }

  /**
   * 取任务的分割结果结构 + 确认状态。
   *
   * 确认状态取「每个结构最新一条确认记录」——
   * `segmentation_confirms` 有 `uq_seg_confirm_task_structure UNIQUE (task_id, structure_name)`，
   * 同一结构只保留一条，因此直接连接即可。
   */
  async findStructures(taskId: string): Promise<SegmentationStructureRow[]> {
    const result = await query<SegmentationStructureRow>(
      this.pool,
      `SELECT sg.structure_name,
              sg.structure_label_zh,
              sg.volume_ml,
              sg.seg_sop_uid,
              (sc.id IS NOT NULL) AS confirmed,
              sc.confirmed_by,
              sc.confirmed_at,
              sc.action AS confirm_action
         FROM segmentations sg
         LEFT JOIN segmentation_confirms sc
                ON sc.task_id = sg.task_id
               AND sc.structure_name = sg.structure_name
        WHERE sg.task_id = $1
        ORDER BY sg.structure_name`,
      [taskId]
    );
    return result.rows;
  }

}
