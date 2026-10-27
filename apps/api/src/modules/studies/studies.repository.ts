import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne } from '../../common/db/pool.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
  type WhereClause,
} from '../../common/db/access-scope.repository.js';

/**
 * 检查数据访问。
 *
 * 行类型。字段名与 DB 列名一致（snake_case），映射到契约 DTO 的工作
 * 放在 service 层 —— repository 只做数据存取与映射，不含业务判断。
 */
export interface StudyListRow {
  study_uid: string;
  accession_no: string;
  modality: string;
  body_part: string;
  study_description: string | null;
  study_date: Date;
  status: string;
  read_status: string;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
  empi_id: string;
  patient_name: string;
  gender: string;
  birth_date: Date;
  id_card_masked: string | null;
  visit_id: string;
  visit_no: string;
  visit_type: string;
  dept: string;
  ward_dept: string | null;
  bed_no: string | null;
  series_count: number;
  report_id: string | null;
  has_signed_report: boolean;
  age_years: number;
  queue_wait_seconds: number | null;
}

export interface StudyListFilters {
  patientId?: string;
  accessionNo?: string;
  modality?: string;
  studyDateFrom?: string;
  studyDateTo?: string;
  status?: string;
  visitType?: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
}


export interface StudyHeaderRow {
  study_uid: string;
  accession_no: string;
  modality: string;
  study_description: string | null;
  total_instances: number;
}

/**
 * 检查与序列的数据访问。
 *
 * ## 关键设计：权限判定下推到 SQL
 *
 * `andWhere(...)` 把患者可见性谓词直接拼进 WHERE，
 * 因此**分页总数与返回行数用的是同一套过滤条件** ——
 * 应用层过滤会让 total 泄露全库规模（schema.sql 明令禁止）。
 *
 * ## 恒定索引路径
 *
 * 「探测」查询只按主键/唯一索引命中（`uq_studies_study_uid`），
 * 「作用域」查询在其上叠加可见性谓词。两次查询的**执行次数恒定**，
 * 与「资源是否存在」「是否有权限」无关 —— 这是时序不可区分的前提。
 */
@Injectable()
export class StudiesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** 构造检查列表的 WHERE 条件 */
  private buildStudyFilter(
    filters: StudyListFilters,
    access: AccessContext
  ): WhereClause {
    const visibility = patientVisibilityPredicate('s.patient_id', access);
    return andWhere(
      visibility,
      { sql: 's.deleted_at IS NULL', values: [] },
      filters.patientId ? eq('p.empi_id', filters.patientId) : null,
      filters.accessionNo ? eq('s.accession_no', filters.accessionNo) : null,
      filters.modality ? eq('s.modality', filters.modality) : null,
      filters.status ? eq('s.status', filters.status) : null,
      filters.visitType ? eq('v.visit_type', filters.visitType) : null,
      filters.studyDateFrom ? { sql: 's.study_date >= $1', values: [filters.studyDateFrom] } : null,
      filters.studyDateTo ? { sql: 's.study_date <= $1', values: [filters.studyDateTo] } : null
    );
  }

  /**
   * 查询检查列表。
   *
   * @param usePlainName 是否返回患者姓名明文（仅质控/病案角色受控路径）。
   *                      走 `v_patients_plain` 视图，该视图仅授予 app_rw 的
   *                      SELECT 权限，且调用方必须已强制写审计。
   */
  async listStudies(
    filters: StudyListFilters,
    access: AccessContext,
    usePlainName: boolean
  ): Promise<{ rows: StudyListRow[]; total: number }> {
    const where = this.buildStudyFilter(filters, access);
    const patientView = usePlainName ? 'v_patients_plain' : 'v_patients_masked';
    const patientNameColumn = usePlainName ? 'p.name' : 'p.name_masked';

    const baseSelect = `
        FROM studies s
        JOIN visits v ON v.id = s.visit_id
        JOIN ${patientView} p ON p.id = s.patient_id
       WHERE ${where.sql}`;

    // 排序字段白名单。**绝不**把用户输入拼进 ORDER BY ——
    // 列名无法参数化，只能靠白名单映射（契约 Sort 参数说明：仅允许白名单字段，防注入）
    const orderColumn = SORTABLE_COLUMNS[filters.sort] ?? 's.study_date';
    const orderDirection = filters.order === 'asc' ? 'ASC' : 'DESC';
    const offset = (filters.page - 1) * filters.limit;

    const rowsResult = await query<StudyListRow>(
      this.pool,
      `SELECT s.study_uid,
              s.accession_no,
              s.modality,
              s.body_part,
              s.study_description,
              s.study_date,
              s.status,
              s.read_status,
              s.read_at,
              s.created_at,
              s.updated_at,
              p.empi_id,
              ${patientNameColumn} AS patient_name,
              p.gender,
              p.birth_date,
              p.id_card_masked,
              v.id AS visit_id,
              v.visit_no,
              v.visit_type,
              v.dept,
              v.ward_dept,
              v.bed_no,
              (SELECT count(*)::int
                 FROM series se
                WHERE se.study_id = s.id
                  AND se.deleted_at IS NULL) AS series_count,
              latest.id AS report_id,
              (latest.status = 'signed') AS has_signed_report,
              EXTRACT(YEAR FROM age(s.study_date::timestamp, p.birth_date::timestamp))::int AS age_years,
              GREATEST(0, EXTRACT(EPOCH FROM (
                CASE WHEN s.read_at IS NOT NULL THEN s.read_at ELSE now() END - s.study_date
              )))::bigint AS queue_wait_seconds
         ${baseSelect}
         LEFT JOIN LATERAL (
           SELECT r.id, r.status
             FROM reports r
            WHERE r.study_id = s.id
              AND r.deleted_at IS NULL
            ORDER BY r.version DESC
            LIMIT 1
         ) latest ON TRUE
        ORDER BY ${orderColumn} ${orderDirection}, s.id ${orderDirection}
        LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      [...where.values, filters.limit, offset]
    );

    const totalResult = await query<{ total: number }>(
      this.pool,
      `SELECT count(*)::int AS total ${baseSelect}`,
      where.values
    );

    return {
      rows: rowsResult.rows,
      total: totalResult.rows[0]?.total ?? 0,
    };
  }

  /**
   * 探测检查是否存在（不含权限判定）。
   *
   * 恒定索引路径：`uq_studies_study_uid`。
   * 无论检查是否存在，本次查询的执行计划与耗时都相同。
   */
  async probeStudy(studyUid: string): Promise<{ patientId: string } | undefined> {
    return queryOne<{ patientId: string }>(
      this.pool,
      `SELECT patient_id AS "patientId"
         FROM studies
        WHERE study_uid = $1
          AND deleted_at IS NULL`,
      [studyUid]
    );
  }

  /**
   * 探测患者是否存在且在授权范围内。
   *
   * 用于 `GET /studies?patientId=...`：指定患者不可见时返 10004，
   * 与「患者不存在」返回完全相同的响应。
   */
  async probePatientScope(empiId: string, access: AccessContext): Promise<boolean> {
    const visibility = patientVisibilityPredicate('p.id', access);
    const where = andWhere(
      visibility,
      { sql: 'p.deleted_at IS NULL', values: [] },
      eq('p.empi_id', empiId)
    );
    const row = await queryOne<{ ok: number }>(
      this.pool,
      `SELECT 1 AS ok FROM v_patients_masked p WHERE ${where.sql} LIMIT 1`,
      where.values
    );
    return row !== undefined;
  }
}

/**
 * 可排序字段白名单。
 *
 * 契约 Sort 参数：`enum: [studyDate, createdAt, updatedAt, accessionNo]`。
 * **列名无法参数化**，只能白名单映射 —— 把用户输入直接拼进 ORDER BY
 * 是 SQL 注入的经典入口。
 */
const SORTABLE_COLUMNS: Record<string, string> = {
  studyDate: 's.study_date',
  createdAt: 's.created_at',
  updatedAt: 's.updated_at',
  accessionNo: 's.accession_no',
};
