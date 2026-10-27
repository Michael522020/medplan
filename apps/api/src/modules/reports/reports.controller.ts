import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { assertIdempotencyKey } from '../../common/idempotency/idempotency.service.js';
import { ReportsService } from './reports.service.js';
import { signReportSchema, type SignReportInput } from './reports.schema.js';

/**
 * 报告端点。
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /api/v1/reports/{reportId}
   *
   * 获取结构化报告。响应含服务端权威的 `lockState`。
   */
  @Get(':reportId')
  async get(
    @CurrentSession() session: Session,
    @Param('reportId') reportId: string
  ): Promise<components['schemas']['ReportResponse']> {
    return this.reportsService.getReport(session, reportId);
  }

  /**
   * POST /api/v1/reports/{reportId}/sign
   *
   * 医师电子签名。**必须**携带 `Idempotency-Key`
   * （重复提交不产生重复签名与重复流水号）。
   */
  @Post(':reportId/sign')
  async sign(
    @CurrentSession() session: Session,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<components['schemas']['SignReportResponse']> {
    const request = parseOrThrow(signReportSchema, body, 'sign') as SignReportInput;
    // 幂等键必填（契约标注幂等 = 是）。缺省时由 service 层的
    // assertIdempotencyKey 抛 10001。
    const key = assertIdempotencyKey(idempotencyKey);
    return this.reportsService.signReport(session, reportId, request, key);
  }
}
