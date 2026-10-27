import {
  Body,
  Controller,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthGuard, CurrentSession } from '../../common/auth/auth.guard.js';
import type { Session } from '../../common/auth/session.js';
import { parseOrThrow } from '../../common/validation/schema.js';
import { WadoService } from './wado.service.js';
import { wadoRetrieveSchema, type WadoRetrieveInput } from './wado.schema.js';

/**
 * DICOM 取图端点。
 */
@Controller('wado')
@UseGuards(AuthGuard)
export class WadoController {
  constructor(private readonly wadoService: WadoService) {}

  /**
   * POST /api/v1/wado/instances
   *
   * WADO-RS 取图（阅片网关代理）。
   *
   * ## 为什么不用统一响应包裹
   *
   * 契约对这个端点的 200 响应规定的是 **原始内容**：
   *   - `metadataOnly: true` -> `application/dicom+json`（DICOM JSON 数组）
   *   - 否则 -> `application/dicom`（Part 10 二进制）或 `multipart/related`
   *
   * 前端的 `dicom-image-loader` 直接消费这些内容，
   * 套一层 `{code,data,message}` 会让图像解析失败。
   * 这是契约中**唯一**不返回统一包裹的端点。
   *
   * 错误路径仍然走统一包裹（由全局异常过滤器产出）。
   */
  @Post('instances')
  async retrieve(
    @CurrentSession() session: Session,
    @Body() body: unknown,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const request = parseOrThrow(
      wadoRetrieveSchema,
      body,
      'wado'
    ) as WadoRetrieveInput;

    const result = await this.wadoService.retrieveInstances(session, request);

    // 本次实际返回的实例数。前端据此判断是否需要续拉
    reply.header('X-Instance-Count', String(result.instanceCount));

    if (result.metadataOnly) {
      reply.type('application/dicom+json');
      reply.send(result.metadata ?? []);
      return;
    }

    reply.type('application/dicom');
    reply.send(result.binary ?? Buffer.alloc(0));
  }
}
