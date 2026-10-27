import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { assertDicomUid } from '../../common/id/ids.js';
import { StudiesService } from './studies.service.js';
import { normalizeStudyListQuery, studyListQuerySchema } from './studies.schema.js';

/**
 * 检查端点。
 *
 * 只做：参数校验 -> 调 service -> 组装响应。
 */
@Controller('studies')
@UseGuards(AuthGuard)
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  /**
   * GET /api/v1/studies
   *
   * 检查列表（按数据权限过滤）。
   */
  @Get()
  async list(
    @CurrentSession() session: Session,
    @Query() query: Record<string, unknown>,
    @Req() request: { headers: Record<string, unknown> }
  ): Promise<components['schemas']['StudyListResponse']> {
    // 校验枚举类参数（非法枚举 -> 10001）
    parseOrThrow(studyListQuerySchema, query, 'query');
    const filters = normalizeStudyListQuery(query);
    const deidentify = parseDeidentifyHeader(request.headers['x-deidentify']);
    return this.studiesService.listStudies(session, filters, deidentify);
  }

  /**
   * GET /api/v1/studies/{studyUid}/series
   *
   * 序列列表（按期相自动分组）。
   */
  @Get(':studyUid/series')
  async listSeries(
    @CurrentSession() session: Session,
    @Param('studyUid') studyUid: string
  ): Promise<components['schemas']['SeriesGroupedResponse']> {
    assertDicomUid(studyUid, 'studyUid');
    return this.studiesService.listSeries(session, studyUid);
  }
}

/**
 * 解析 `x-deidentify` 头。
 *
 * 契约默认 true（掩码）。只有显式的 `false` 才关闭脱敏。
 * 非法值按默认（脱敏）处理 —— 脱敏开关必须**默认关闭明文**，
 * 一个拼错的 `x-deidentify: False0` 不应该泄露姓名。
 */
export function parseDeidentifyHeader(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== 'false';
}
