import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, queryOne } from '../../common/db/pool.js';
import {
  andWhere,
  eq,
  patientVisibilityPredicate,
  type AccessContext,
} from '../../common/db/access-scope.repository.js';

/**
 * DICOM 取图的数据访问。
 *
 * 本表只存**实例元数据索引**，像素数据在 PACS（dcm4chee）。
 * 500 万幅影像绝不能进业务库（ADR-004）。
 */

export interface InstanceIndexRow {
  sop_uid: string;
  instance_number: number;
  rows: number;
  columns: number;
  size_bytes: number | null;
  is_compressed: boolean;
}

export interface SeriesFetchRow {
  series_uid: string;
  study_uid: string;
  instance_count: number;
  transfer_syntax_uid: string | null;
}

@Injectable()
export class WadoRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 按 studyUid 查序列（带可见性判定）。
   *
   * 可见性谓词下推到 WHERE：不可见 -> 0 行，与「不存在」同样 0 行。
   */
  async findSeries(
    studyUid: string,
    seriesUid: string,
    access: AccessContext
  ): Promise<SeriesFetchRow | undefined> {
    const visibility = patientVisibilityPredicate('s.patient_id', access);
    const where = andWhere(
      visibility,
      { sql: 'se.deleted_at IS NULL', values: [] },
      eq('se.series_uid', seriesUid),
      eq('s.study_uid', studyUid)
    );
    return queryOne<SeriesFetchRow>(
      this.pool,
      `SELECT se.series_uid,
              se.study_uid,
              se.instance_count,
              se.transfer_syntax_uid
         FROM series se
         JOIN studies s ON s.id = se.study_id
        WHERE ${where.sql}`,
      where.values
    );
  }

  /** 探测序列是否存在（不含权限判定，恒定索引路径） */
  async probeSeries(seriesUid: string): Promise<{ studyUid: string } | undefined> {
    return queryOne<{ studyUid: string }>(
      this.pool,
      `SELECT study_uid AS "studyUid"
         FROM series
        WHERE series_uid = $1
          AND deleted_at IS NULL`,
      [seriesUid]
    );
  }

  /**
   * 取实例的元数据索引。
   *
   * @param instanceNumbers 指定层号。为空则取整个序列
   */
  async findInstances(
    seriesUid: string,
    instanceNumbers: number[] | undefined
  ): Promise<InstanceIndexRow[]> {
    if (instanceNumbers && instanceNumbers.length > 0) {
      const placeholders = instanceNumbers.map((_v, i) => `$${i + 2}`).join(', ');
      const result = await this.pool.query<InstanceIndexRow>(
        `SELECT sop_uid, instance_number, rows, columns, size_bytes, is_compressed
           FROM instances
          WHERE series_uid = $1
            AND instance_number IN (${placeholders})
            AND deleted_at IS NULL
          ORDER BY instance_number`,
        [seriesUid, ...instanceNumbers]
      );
      return result.rows;
    }
    const result = await this.pool.query<InstanceIndexRow>(
      `SELECT sop_uid, instance_number, rows, columns, size_bytes, is_compressed
         FROM instances
        WHERE series_uid = $1
          AND deleted_at IS NULL
        ORDER BY instance_number`,
      [seriesUid]
    );
    return result.rows;
  }

  /**
   * 按 SOP UID 取实例（用于「按需补拉失败层」）。
   */
  async findInstancesBySopUids(
    seriesUid: string,
    sopUids: string[]
  ): Promise<InstanceIndexRow[]> {
    if (sopUids.length === 0) return [];
    const placeholders = sopUids.map((_v, i) => `$${i + 2}`).join(', ');
    const result = await this.pool.query<InstanceIndexRow>(
      `SELECT sop_uid, instance_number, rows, columns, size_bytes, is_compressed
         FROM instances
        WHERE series_uid = $1
          AND sop_uid IN (${placeholders})
          AND deleted_at IS NULL
        ORDER BY instance_number`,
      [seriesUid, ...sopUids]
    );
    return result.rows;
  }
}
