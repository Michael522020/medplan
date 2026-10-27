import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { SegmentationService } from './segmentation.service.js';
import { SegmentationConfirmService } from './segmentation-confirm.service.js';
import {
  confirmSegmentationSchema,
  createSegmentationTaskSchema,
  type ConfirmSegmentationInput,
} from './segmentation.schema.js';

/**
 * AI 分割任务端点。
 */
@Controller('segmentation-tasks')
@UseGuards(AuthGuard)
export class SegmentationController {
  constructor(
    private readonly segmentationService: SegmentationService,
    private readonly confirmService: SegmentationConfirmService
  ) {}

  /**
   * POST /api/v1/segmentation-tasks
   *
   * 提交 AI 分割任务。**必须**携带 `Idempotency-Key`（契约标注幂等 = 是）。
   */
  @Post()
  async submit(
    @CurrentSession() session: Session,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<components['schemas']['CreateSegmentationTaskResponse']> {
    const request = parseOrThrow(createSegmentationTaskSchema, body, 'segmentationTask');
    return this.segmentationService.submitTask(session, request, idempotencyKey);
  }

  /**
   * GET /api/v1/segmentation-tasks/{taskId}
   *
   * 查询任务状态与结果。
   */
  @Get(':taskId')
  async get(
    @CurrentSession() session: Session,
    @Param('taskId') taskId: string
  ): Promise<components['schemas']['SegmentationTaskResponse']> {
    return this.segmentationService.getTask(session, taskId);
  }

  /**
   * POST /api/v1/segmentation-tasks/{taskId}/confirm
   *
   * 医师逐项确认 AI 辅助标记。
   *
   * **确认人由后端从会话取**，请求体里传 `confirmedBy` / `confirmedAt` 会被
   * schema 拒绝（见 segmentation.schema.ts）。
   */
  @Post(':taskId/confirm')
  async confirm(
    @CurrentSession() session: Session,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<components['schemas']['ConfirmSegmentationResponse']> {
    const request = parseOrThrow(
      confirmSegmentationSchema,
      body,
      'confirm'
    ) as ConfirmSegmentationInput;
    return this.confirmService.confirmItems(session, taskId, request, idempotencyKey);
  }
}
