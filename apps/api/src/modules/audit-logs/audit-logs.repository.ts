import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query } from '../../common/db/pool.js';
import { andWhere, type SqlFragment } from '../../common/db/access-scope.repository.js';

/**
 * 审计日志查询的数据访问。
 *
 * ## 只读
 *
 * `audit_logs` 在 DB 层对查询账号只有 SELECT（`REVOKE UPDATE, DELETE,
 * TRUNCATE`），且有 `trg_audit_logs_no_update` / `_no_delete` 触发器。
 * 本 repository **只有 SELECT**，没有任何写路径。
 */

export interface AuditLogRow {
  id: string;
  event_time: Date;
  actor_id: string | null;
  actor_name_masked: string | null;
  actor_department: string | null;
  actor_roles: string[] | null;
  event_type: string;
  result: string;
  result_code: number | null;
  patient_id: string | null;
  patient_name_masked: string | null;
  resource_type: string;
  resource_id: string;
  source_ip: string | null;
  terminal_id: string | null;
  detail: Record<string, unknown> | null;
  hash_prev: string;
  hash_self: string;
}

export interface AuditQueryFilters {
  actorId?: string;
  eventTypes?: string[];
  patientId?: string;
  resourceType?: string;
  result?: string;
  eventTimeFrom?: string;
  eventTimeTo?: string;
  page: number;
  limit: number;
}

@Injectable()
export class AuditLogsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** 构造查询条件 */
  private buildWhere(filters: AuditQueryFilters): { sql: string; values: unknown[] } {
    const clauses: SqlFragment[] = [];

    if (filters.actorId) {
      clauses.push({ sql: 'a.actor_id::text = $1', values: [filters.actorId] });
    }
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      const placeholders = filters.eventTypes.map((_v, i) => `$${i + 1}`).join(', ');
      clauses.push({
        sql: `a.event_type::text IN (${placeholders})`,
        values: [...filters.eventTypes],
      });
    }
    if (filters.patientId) {
      clauses.push({ sql: 'p.empi_id = $1', values: [filters.patientId] });
    }
    if (filters.resourceType) {
      clauses.push({ sql: 'a.resource_type = $1', values: [filters.resourceType] });
    }
    if (filters.result) {
      clauses.push({ sql: 'a.result::text = $1', values: [filters.result] });
    }
    if (filters.eventTimeFrom) {
      clauses.push({ sql: 'a.event_time >= $1', values: [filters.eventTimeFrom] });
    }
    if (filters.eventTimeTo) {
      clauses.push({ sql: 'a.event_time <= $1', values: [filters.eventTimeTo] });
    }

    const where = andWhere(...clauses);
    return { sql: where.sql, values: where.values };
  }

  /**
   * 查询审计记录。
   *
   * 关联 `users`（操作人掩码与科室）与 `patients`（患者 EMPI 与掩码姓名）。
   * 注意 `patients` 用**明文表**的掩码视图以获得 EMPI（患者标识），
   * 但姓名取脱敏视图的掩码值。
   */
  async query(filters: AuditQueryFilters): Promise<{ rows: AuditLogRow[]; total: number }> {
    const where = this.buildWhere(filters);
    const offset = (filters.page - 1) * filters.limit;

    const rowsResult = await query<AuditLogRow>(
      this.pool,
      `SELECT a.id::text AS id,
              a.event_time,
              a.actor_id,
              (SELECT left(u.display_name, 1) || '*' || right(u.display_name, 1)
                 FROM users u WHERE u.id = a.actor_id) AS actor_name_masked,
              (SELECT u.department_code FROM users u WHERE u.id = a.actor_id) AS actor_department,
              a.actor_roles::text[] AS actor_roles,
              a.event_type::text AS event_type,
              a.result::text AS result,
              a.result_code,
              a.patient_id,
              (SELECT pm.name_masked
                 FROM v_patients_masked pm WHERE pm.id = a.patient_id) AS patient_name_masked,
              a.resource_type,
              a.resource_id,
              a.source_ip::text AS source_ip,
              a.terminal_id,
              a.detail,
              a.hash_prev,
              a.hash_self
         FROM audit_logs a
         LEFT JOIN patients p ON p.id = a.patient_id
        WHERE ${where.sql}
        ORDER BY a.event_time DESC, a.id DESC
        LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      [...where.values, filters.limit, offset]
    );

    const totalResult = await query<{ total: number }>(
      this.pool,
      `SELECT count(*)::int AS total
         FROM audit_logs a
         LEFT JOIN patients p ON p.id = a.patient_id
        WHERE ${where.sql}`,
      where.values
    );

    return {
      rows: rowsResult.rows,
      total: totalResult.rows[0]?.total ?? 0,
    };
  }

  /**
   * 校验返回区间的 hash chain 完整性。
   *
   * 契约：`chainVerification` 给出本次返回区间的 hash chain 校验结果。
   * `valid = false` 说明审计数据被篡改或损坏，前端须以最高告警呈现
   * 并禁止继续业务操作（R6）。
   *
   * 校验两件事：
   *   1. **链式连续性**：区间内相邻行满足 `本行.hash_prev == 上行.hash_self`
   *   2. **首行衔接**：区间首行的 hash_prev 是否等于区间外上一行的 hash_self
   *      （区间外的那条也要取，才能发现「整段被替换」）
   *
   * 注意：这里校验的是**链式关系**。单行摘要的算法校验由 DB 触发器
   * `fn_audit_chain_guard` 在写入时保证（它用 `sm3_or_fallback` 计算）。
   */
  async verifyChain(
    rows: AuditLogRow[]
  ): Promise<{ valid: boolean; checkedRows: number; firstHashPrev: string | null; lastHashSelf: string | null }> {
    if (rows.length === 0) {
      return { valid: true, checkedRows: 0, firstHashPrev: null, lastHashSelf: null };
    }

    // rows 已按 event_time DESC 排序（最新在前）。链式校验需要按时间升序。
    const ordered = [...rows].reverse();

    let valid = true;
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous && current && previous.hash_self !== current.hash_prev) {
        valid = false;
        break;
      }
    }

    // 首行衔接：取区间外紧邻的上一条（时间更早）
    if (valid) {
      const first = ordered[0];
      if (first) {
        const predecessor = await this.pool.query<{ hash_self: string }>(
          `SELECT hash_self
             FROM audit_logs
            WHERE event_time < $1
               OR (event_time = $1 AND id < $2)
            ORDER BY event_time DESC, id DESC
            LIMIT 1`,
          [first.event_time, first.id]
        );
        const prevHash = predecessor.rows[0]?.hash_self;
        // 首条记录（整链第一条）的 hash_prev 是 64 个 0
        if (prevHash && prevHash !== first.hash_prev) {
          valid = false;
        }
      }
    }

    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      valid,
      checkedRows: ordered.length,
      firstHashPrev: first?.hash_prev ?? null,
      lastHashSelf: last?.hash_self ?? null,
    };
  }
}
