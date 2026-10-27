import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne, type Queryable } from '../../common/db/pool.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
} from '../../common/db/access-scope.repository.js';
import type { ReportRow, RevisionRow } from './report-mapper-types.js';

/**
 * 报告的数据访问。
 *
 * 签名日志的读写在 `signature-logs.repository.ts` ——
 * `signature_logs` 是**独立存储**的表（WS/T 847 要求独立于业务系统），
 * 放在一起会让两个表看起来像一体，弱化「独立可还原」的设计意图。
 */
@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 按 ID 查报告（带可见性判定）。
   *
   * 可见性谓词下推到 WHERE：不可见 -> 0 行，与「不存在」同样 0 行。
   */
  async findById(
    reportId: string,
    access: AccessContext
  ): Promise<ReportRow | undefined> {
    const visibility = patientVisibilityPredicate('st.patient_id', access);
    const where = andWhere(
      visibility,
      { sql: 'r.deleted_at IS NULL', values: [] },
      eq('r.id', reportId)
    );
    return queryOne<ReportRow>(
      this.pool,
      `SELECT r.id,
              r.study_uid,
              r.version,
              r.template_code,
              r.status,
              r.exam_body_part,
              r.scan_mode,
              r.findings,
              r.impression,
              r.follow_up_recommendation,
              r.structured_findings,
              r.follow_up_detail,
              r.ai_assist,
              r.segmentation_task_id,
              r.report_doctor_id,
              r.review_doctor_id,
              r.report_time,
              r.reviewed_at,
              r.body_digest,
              r.body_digest_algorithm,
              r.body_sha256,
              r.signed_at,
              r.archived_at,
              r.created_at,
              r.updated_at,
              p.empi_id,
              p.name_masked AS patient_name_masked,
              p.gender,
              p.birth_date,
              p.id_card_masked,
              v.id AS visit_id,
              v.visit_no,
              v.visit_type,
              v.dept,
              v.ward_dept,
              v.bed_no,
              v.admit_date,
              st.accession_no,
              st.modality,
              st.body_part,
              st.study_description,
              st.study_date,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = r.report_doctor_id) AS author_name_masked,
              (SELECT u.title FROM users u WHERE u.id = r.report_doctor_id) AS author_title,
              (SELECT u.department_code FROM users u WHERE u.id = r.report_doctor_id) AS author_department,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = r.review_doctor_id) AS reviewer_name_masked,
              (SELECT u.title FROM users u WHERE u.id = r.review_doctor_id) AS reviewer_title,
              (SELECT u.department_code FROM users u WHERE u.id = r.review_doctor_id) AS reviewer_department
         FROM reports r
         JOIN studies st ON st.id = r.study_id
         JOIN visits v ON v.id = st.visit_id
         JOIN v_patients_masked p ON p.id = st.patient_id
        WHERE ${where.sql}`,
      where.values
    );
  }

  /** 探测报告是否存在（不含权限判定，恒定索引路径） */
  async probe(reportId: string): Promise<{ studyId: string } | undefined> {
    return queryOne<{ studyId: string }>(
      this.pool,
      `SELECT study_id AS "studyId"
         FROM reports
        WHERE id = $1
          AND deleted_at IS NULL`,
      [reportId]
    );
  }

  /** 取报告的修改痕迹（append-only，按版本升序） */
  async findRevisions(reportId: string): Promise<RevisionRow[]> {
    const result = await query<RevisionRow>(
      this.pool,
      `SELECT rr.version,
              rr.body_digest,
              rr.change_summary,
              rr.edited_at,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = rr.edited_by) AS edited_by_masked
         FROM report_revisions rr
        WHERE rr.report_id = $1
        ORDER BY rr.version ASC`,
      [reportId]
    );
    return result.rows;
  }

  /**
   * 锁定报告（签名后）。
   *
   * DB 触发器 `trg_reports_no_signed_update` 会在 OLD.status 已是
   * signed/archived 时阻断 UPDATE —— 因此这里只能从 draft/pending_review
   * 迁移到 signed，迁移之后报告即被物理锁定。
   */
  async markSigned(
    client: Queryable,
    params: {
      reportId: string;
      signedAt: Date;
      bodyDigest: string;
      bodySha256: string;
    }
  ): Promise<void> {
    await query(
      client,
      `UPDATE reports
          SET status = 'signed',
              signed_at = $2,
              body_digest = $3,
              body_sha256 = $4
        WHERE id = $1
          AND status IN ('draft', 'pending_review')
          AND deleted_at IS NULL`,
      [params.reportId, params.signedAt, params.bodyDigest, params.bodySha256]
    );
  }

  /**
   * 锁定关联的规划方案。
   *
   * 契约：「签名后报告正文与关联规划方案**一并锁定**」
   * （PRD：三维规划数据与报告正文同签名、同审计、同归档）。
   */
  async lockPlans(
    client: Queryable,
    params: { studyId: string; reportId: string; lockedAt: Date }
  ): Promise<void> {
    await query(
      client,
      `UPDATE plans
          SET locked_at = $3,
              locked_by_report_id = $2
        WHERE study_id = $1
          AND deleted_at IS NULL
          AND locked_at IS NULL`,
      [params.studyId, params.reportId, params.lockedAt]
    );
  }

  /**
   * 追加报告修改痕迹（append-only）。
   */
  async appendRevision(
    client: Queryable,
    params: {
      reportId: string;
      version: number;
      snapshot: unknown;
      bodyDigest: string;
      changeSummary: string;
      editedBy: string;
    }
  ): Promise<void> {
    await query(
      client,
      `INSERT INTO report_revisions (
         report_id, version, snapshot, body_digest, change_summary, edited_by, retention_class
       ) VALUES ($1, $2, $3, $4, $5, $6, 'report_15y')`,
      [
        params.reportId,
        params.version,
        JSON.stringify(params.snapshot),
        params.bodyDigest,
        params.changeSummary,
        params.editedBy,
      ]
    );
  }

  /**
   * 取报告关联的 AI 分割任务确认进度。
   *
   * 用于签名前的「AI 标记未全部确认」判定（AC-11）。
   */
  async findAiConfirmProgress(
    taskId: string
  ): Promise<{ total: number; confirmed: number } | undefined> {
    return queryOne<{ total: number; confirmed: number }>(
      this.pool,
      `SELECT (SELECT count(*)::int FROM segmentations WHERE task_id = $1) AS total,
              (SELECT count(*)::int FROM segmentation_confirms WHERE task_id = $1) AS confirmed`,
      [taskId]
    );
  }
}
