import { Injectable } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { canReadAuditLog } from '../../common/auth/session.js';
import { toContractEventType } from '../../common/audit/audit-event-type.js';
import { AuditLogsRepository, type AuditLogRow } from './audit-logs.repository.js';

/**
 * 审计日志查询业务逻辑。
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly repository: AuditLogsRepository) {}

  /**
   * GET /api/v1/audit-logs
   *
   * 审计查询（管理员 / 质控科只读）。
   *
   * ## 权限
   *
   * 只有 `system_admin` / `quality_control` / `medical_records` 可查。
   * 其他人 -> **10003**（角色级无权限）。
   *
   * 注意与 10004 的区别：10003 是「你的角色不能做这个操作」，
   * 与患者是否存在**完全无关**，因此可以安全地区分 ——
   * 契约 §4.1 明确「10003 无权限（角色级）… 与患者是否存在无关」。
   */
  async queryAuditLogs(
    session: Session,
    filters: {
      actorId?: string;
      eventTypes?: string[];
      patientId?: string;
      resourceType?: string;
      result?: string;
      eventTimeFrom?: string;
      eventTimeTo?: string;
      page: number;
      limit: number;
    },
    verifyChain: boolean
  ): Promise<components['schemas']['AuditLogListResponse']> {
    if (!canReadAuditLog(session)) {
      throw AppError.forbiddenRole('当前角色无审计查询权限');
    }

    const { rows, total } = await this.repository.query(filters);

    const chainVerification = verifyChain
      ? await this.repository.verifyChain(rows)
      : { valid: true, checkedRows: 0, firstHashPrev: null, lastHashSelf: null };

    return {
      code: 0,
      message: '',
      data: {
        items: rows.map((row) => toAuditLogItem(row)),
        total,
        page: filters.page,
        limit: filters.limit,
        hasMore: filters.page * filters.limit < total,
        chainVerification: {
          valid: chainVerification.valid,
          checkedRows: chainVerification.checkedRows,
          firstHashPrev: chainVerification.firstHashPrev,
          lastHashSelf: chainVerification.lastHashSelf,
          verifiedAt: new Date().toISOString(),
        },
      },
    };
  }
}

/** DB 行 -> 契约审计条目 */
function toAuditLogItem(row: AuditLogRow): components['schemas']['AuditLogItem'] {
  return {
    auditLogId: `a-${row.id}`,
    eventTime: row.event_time.toISOString(),
    actorId: row.actor_id ?? '',
    actorNameMasked: row.actor_name_masked,
    actorDepartment: row.actor_department,
    actorRoles: (row.actor_roles ?? []) as components['schemas']['AuditLogItem']['actorRoles'],
    eventType: toContractEventType(row.event_type),
    result: row.result as components['schemas']['AuditResult'],
    resultCode: row.result_code,
    patientId: row.patient_id ?? null,
    patientNameMasked: row.patient_name_masked,
    resourceType: row.resource_type as components['schemas']['AuditLogItem']['resourceType'],
    resourceId: row.resource_id,
    sourceIp: row.source_ip ?? '',
    terminalId: row.terminal_id,
    detail: row.detail ?? {},
    hashPrev: row.hash_prev,
    hashSelf: row.hash_self,
  };
}
