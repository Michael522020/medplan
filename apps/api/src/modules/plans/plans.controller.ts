import { Body, Controller, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { PlansService } from './plans.service.js';
import {
  assertPayloadCompliance,
  createPlanSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type UpdatePlanInput,
} from './plans.schema.js';

/**
 * 规划方案端点。
 */
@Controller('plans')
@UseGuards(AuthGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /**
   * POST /api/v1/plans
   *
   * 新建规划方案。**必须**携带 `Idempotency-Key`
   * （双击保存不产生两份方案）。
   */
  @Post()
  async create(
    @CurrentSession() session: Session,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<components['schemas']['PlanResponse']> {
    const request = parseOrThrow(createPlanSchema, body, 'plan') as CreatePlanInput;
    // payload 的合规边界（entry/target 必需 + 禁结论性字段）
    assertPayloadCompliance(request.payload);
    return this.plansService.createPlan(session, request, idempotencyKey);
  }

  /**
   * PUT /api/v1/plans/{planId}
   *
   * 更新规划方案（乐观锁）。**必须**带 `version`；
   * 冲突返 HTTP 409 + `code 20003`。
   */
  @Put(':planId')
  async update(
    @CurrentSession() session: Session,
    @Param('planId') planId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<components['schemas']['PlanResponse']> {
    const request = parseOrThrow(updatePlanSchema, body, 'plan') as UpdatePlanInput;
    if (request.payload !== undefined) {
      assertPayloadCompliance(request.payload);
    }
    return this.plansService.updatePlan(session, planId, request, idempotencyKey);
  }
}
