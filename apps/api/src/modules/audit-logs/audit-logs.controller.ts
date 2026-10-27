import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { AuditLogsService } from './audit-logs.service.js';
import { auditLogQuerySchema, normalizeAuditQuery } from './audit-logs.schema.js';

/**
 * 审计日志端点。
 *
 * **只读**。本模块没有任何写、删、改能力。
 */
@Controller('audit-logs')
@UseGuards(AuthGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * GET /api/v1/audit-logs
   *
   * 审计查询（管理员 / 质控科只读）。
   */
  @Get()
  async query(
    @CurrentSession() session: Session,
    @Query() query: Record<string, unknown>
  ): Promise<components['schemas']['AuditLogListResponse']> {
    // **先 normalize 再校验**：Fastify 的 query 参数永远是字符串
    // （`?page=1` -> `'1'`），直接交给 `s.number()` 会报「必须为有限数字」，
    // 导致 `GET /api/v1/audit-logs?page=1` 直接 400。
    const filters = normalizeAuditQuery(query);
    parseOrThrow(auditLogQuerySchema, filters, 'query');
    return this.auditLogsService.queryAuditLogs(
      session,
      filters,
      filters.verifyChain
    );
  }
}
