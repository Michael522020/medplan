import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne } from '../../common/db/pool.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
} from '../../common/db/access-scope.repository.js';

/**
 * 序列的数据访问。
 *
 * 单独成文件：检查列表与序列列表是**两个不同的读模型** ——
 * 前者分页聚合到患者/就诊/报告维度，后者按期相分组。
 * 混在一个 repository 里，两条查询的 WHERE 条件会互相干扰。
 */

export interface SeriesRow {
  series_uid: string;
  series_number: number;
  series_description: string | null;
  phase: string;
  phase_confidence: number | null;
  instance_count: number;
  slice_thickness_mm: number | null;
  rows: number | null;
  columns: number | null;
  pixel_spacing_mm: number[] | null;
  transfer_syntax_uid: string | null;
  window_center: number | null;
  window_width: number | null;
}

export interface StudyHeaderRow {
  study_uid: string;
  accession_no: string;
  modality: string;
  study_description: string | null;
  total_instances: number;
}

@Injectable()
export class SeriesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 按 studyUid 取检查头信息 + 序列列表。
   *
   * 可见性谓词下推到 WHERE：不可见的检查返回 0 行，
   * 与「检查不存在」同样是 0 行 —— 两者在 service 层归并为同一个 10004。
   */
  async findStudyWithSeries(
    studyUid: string,
    access: AccessContext
  ): Promise<{ header: StudyHeaderRow; series: SeriesRow[] } | undefined> {
    const visibility = patientVisibilityPredicate('s.patient_id', access);
    const where = andWhere(
      visibility,
      { sql: 's.deleted_at IS NULL', values: [] },
      eq('s.study_uid', studyUid)
    );

    const header = await queryOne<StudyHeaderRow>(
      this.pool,
      `SELECT s.study_uid,
              s.accession_no,
              s.modality,
              s.study_description,
              COALESCE(SUM(se.instance_count), 0)::int AS total_instances
         FROM studies s
         LEFT JOIN series se ON se.study_id = s.id AND se.deleted_at IS NULL
        WHERE ${where.sql}
        GROUP BY s.id, s.study_uid, s.accession_no, s.modality, s.study_description`,
      where.values
    );
    if (!header) return undefined;

    const seriesResult = await query<SeriesRow>(
      this.pool,
      `SELECT se.series_uid,
              se.series_number,
              se.series_description,
              se.phase,
              se.phase_confidence,
              se.instance_count,
              se.slice_thickness_mm,
              se.rows,
              se.columns,
              se.pixel_spacing_mm,
              se.transfer_syntax_uid,
              se.window_center,
              se.window_width
         FROM series se
         JOIN studies s ON s.id = se.study_id
        WHERE se.study_uid = $1
          AND se.deleted_at IS NULL
        ORDER BY se.series_number`,
      [studyUid]
    );

    return { header, series: seriesResult.rows };
  }
}
