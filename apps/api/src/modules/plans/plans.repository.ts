import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, queryOne, type Queryable } from '../../common/db/pool.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
} from '../../common/db/access-scope.repository.js';

/**
 * 规划方案的数据访问。
 */

export interface PlanRow {
  id: string;
  study_uid: string;
  segmentation_task_id: string | null;
  version: number;
  plan_type: string;
  title: string | null;
  payload: unknown;
  status: string;
  locked_at: Date | null;
  locked_by_report_id: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
  /** 最后编辑者姓名（掩码） */
  updated_by_name_masked: string | null;
  created_by_name_masked: string | null;
}


export interface PlanCommandRow {
  id: string;
  command_type: string;
  before_value: unknown;
  after_value: unknown;
  version_before: number | null;
  version_after: number | null;
  created_at: Date;
}

@Injectable()
export class PlansRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** 按幂等键查方案 */
  async findByIdempotencyKey(key: string): Promise<PlanRow | undefined> {
    return queryOne<PlanRow>(
      this.pool,
      `SELECT p.id,
              p.study_uid,
              p.segmentation_task_id,
              p.version,
              p.plan_type,
              p.title,
              p.payload,
              p.status,
              p.locked_at,
              p.locked_by_report_id,
              p.created_by,
              p.created_at,
              p.updated_by,
              p.updated_at,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = p.updated_by) AS updated_by_name_masked,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = p.created_by) AS created_by_name_masked
         FROM plans p
        WHERE p.idempotency_key = $1
          AND p.deleted_at IS NULL`,
      [key]
    );
  }

  /**
   * 按 ID 查方案（带可见性判定）。
   *
   * 可见性谓词下推到 WHERE：不可见 -> 0 行，与「不存在」同样 0 行。
   */
  async findById(planId: string, access: AccessContext): Promise<PlanRow | undefined> {
    const visibility = patientVisibilityPredicate('s.patient_id', access);
    const where = andWhere(
      visibility,
      { sql: 'p.deleted_at IS NULL', values: [] },
      eq('p.id', planId)
    );
    return queryOne<PlanRow>(
      this.pool,
      `SELECT p.id,
              p.study_uid,
              p.segmentation_task_id,
              p.version,
              p.plan_type,
              p.title,
              p.payload,
              p.status,
              p.locked_at,
              p.locked_by_report_id,
              p.created_by,
              p.created_at,
              p.updated_by,
              p.updated_at,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = p.updated_by) AS updated_by_name_masked,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = p.created_by) AS created_by_name_masked
         FROM plans p
         JOIN studies s ON s.id = p.study_id
        WHERE ${where.sql}`,
      where.values
    );
  }

  /** 探测方案是否存在（不含权限判定，恒定索引路径） */
  async probe(planId: string): Promise<{ studyId: string } | undefined> {
    return queryOne<{ studyId: string }>(
      this.pool,
      `SELECT study_id AS "studyId"
         FROM plans
        WHERE id = $1
          AND deleted_at IS NULL`,
      [planId]
    );
  }

  /** 探测检查是否存在（供创建方案前用） */
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
   * 创建方案。
   *
   * @param client 事务客户端。方案 + 操作日志 + 幂等键占用必须同事务
   */
  async create(
    client: Queryable,
    params: {
      studyId: string;
      studyUid: string;
      segmentationTaskId: string | null;
      planType: string;
      title: string | null;
      payload: unknown;
      createdBy: string;
      idempotencyKey: string;
    }
  ): Promise<PlanRow> {
    const row = await queryOne<PlanRow>(
      client,
      `INSERT INTO plans (
         study_id, study_uid, segmentation_task_id, version, plan_type, title,
         payload, status, created_by, updated_by, idempotency_key, retention_class
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, 'draft', $7, $7, $8, 'plan_15y')
       RETURNING id,
                 study_uid,
                 segmentation_task_id,
                 version,
                 plan_type,
                 title,
                 payload,
                 status,
                 locked_at,
                 locked_by_report_id,
                 created_by,
                 created_at,
                 updated_by,
                 updated_at`,
      [
        params.studyId,
        params.studyUid,
        params.segmentationTaskId,
        params.planType,
        params.title,
        JSON.stringify(params.payload),
        params.createdBy,
        params.idempotencyKey,
      ]
    );
    if (!row) throw new Error('规划方案创建失败');
    return {
      ...row,
      updated_by_name_masked: null,
      created_by_name_masked: null,
    };
  }

  /**
   * 更新方案（乐观锁）。
   *
   * `WHERE version = $expectedVersion` 是乐观锁的核心：
   * 版本不匹配时**不更新任何行**（返回 0 行），
   * 由 service 据此返回 409 + 20003。
   *
   * 用 UPDATE ... WHERE version 的单语句实现，而不是「先 SELECT 再 UPDATE」——
   * 后者存在检查与更新之间的竞态窗口（两个并发请求都能通过检查）。
   */
  async updateWithVersion(
    client: Queryable,
    params: {
      planId: string;
      expectedVersion: number;
      title: string | null;
      payload: unknown | null;
      status: string | null;
      updatedBy: string;
    }
  ): Promise<PlanRow | undefined> {
    return queryOne<PlanRow>(
      client,
      `UPDATE plans
          SET version = version + 1,
              title = COALESCE($3, title),
              payload = COALESCE($4, payload),
              status = COALESCE($5, status),
              updated_by = $6
        WHERE id = $1
          AND version = $2
          AND deleted_at IS NULL
          AND status <> 'archived'
        RETURNING id,
                  study_uid,
                  segmentation_task_id,
                  version,
                  plan_type,
                  title,
                  payload,
                  status,
                  locked_at,
                  locked_by_report_id,
                  created_by,
                  created_at,
                  updated_by,
                  updated_at`,
      [
        params.planId,
        params.expectedVersion,
        params.title,
        params.payload === null ? null : JSON.stringify(params.payload),
        params.status,
        params.updatedBy,
      ]
    );
  }

  /**
   * 取方案当前版本与最后编辑者（冲突时给前端定位信息）。
   */
  async findVersionInfo(
    planId: string
  ): Promise<{ version: number; updatedBy: string; updatedByMasked: string | null; updatedAt: Date } | undefined> {
    return queryOne<{
      version: number;
      updatedBy: string;
      updatedByMasked: string | null;
      updatedAt: Date;
    }>(
      this.pool,
      `SELECT p.version,
              p.updated_by AS "updatedBy",
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = p.updated_by) AS "updatedByMasked",
              p.updated_at AS "updatedAt"
         FROM plans p
        WHERE p.id = $1
          AND p.deleted_at IS NULL`,
      [planId]
    );
  }

}
