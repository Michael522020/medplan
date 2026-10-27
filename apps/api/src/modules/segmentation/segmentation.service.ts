import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { DB_POOL, withTransaction } from '../../common/db/pool.js';
import { parseResourceId } from '../../common/id/ids.js';
import {
  assertIdempotencyKey,
  fingerprintRequestBody,
  resolveIdempotentReplay,
} from '../../common/idempotency/idempotency.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { markBusinessAuditCommitted } from '../../common/audit/audit-context.js';
import {
  API_EXPOSED_MODELS,
  isSubmittableModel,
  lookupLicense,
} from './model-license-whitelist.js';
import { rejectionReason } from './model-license-reason.js';
import { SegmentationRepository } from './segmentation.repository.js';
import { SegmentationConfirmsRepository } from './segmentation-confirms.repository.js';
import {
  evaluatePhaseEligibility,
  toSubmitResponse,
  toTaskResponse,
} from './segmentation-mapper.js';

/**
 * AI 分割任务业务逻辑。
 *
 * ## 合规边界
 *
 * 本模块属**非辅助决策类**（器审中心 2022 年第 8 号：自动分割被明确列举
 * 为非辅助决策），不触及三类证。AI 输出只有解剖结构名与量化体积，
 * **没有任何自由文本字段** —— 类型层面不可能承载诊断结论。
 */
@Injectable()
export class SegmentationService {
  constructor(
    private readonly repository: SegmentationRepository,
    private readonly confirmsRepository: SegmentationConfirmsRepository,
    private readonly auditService: AuditService,
    @Inject(DB_POOL) private readonly pool: Pool
  ) {}

  /**
   * POST /api/v1/segmentation-tasks
   *
   * 提交 AI 分割任务。
   *
   * 三道服务端强校验（**不依赖前端**，防绕过）：
   *   1. 模型许可白名单（AC-09）-> 40003 + 写审计
   *   2. 期相前置校验（AI-01）-> 20002
   *   3. 幂等校验 -> 重放返回首次结果
   */
  async submitTask(
    session: Session,
    body: unknown,
    idempotencyKeyHeader: string | undefined
  ): Promise<components['schemas']['CreateSegmentationTaskResponse']> {
    const request = body as {
      studyUid: string;
      seriesUid: string;
      model: string;
      fast?: boolean;
      targetPhase: string;
    };

    // --- 校验 1：模型许可白名单 ---
    // 放在最前面：非白名单模型的提交必须被拒绝并留痕，
    // 不能让它走到期相校验或落库才失败。
    const licenseEntry = lookupLicense(request.model);
    if (!isSubmittableModel(request.model)) {
      await this.auditService.recordModelLicenseRejection({
        actorId: session.userId,
        actorRoles: session.roles,
        studyUid: request.studyUid,
        requestedModel: request.model,
        license: licenseEntry,
        sourceIp: undefined,
      });
      throw AppError.modelLicenseRejected({
        requestedModel: request.model,
        requestedLicense: licenseEntry?.license ?? 'UNKNOWN',
        rejectionReason: rejectionReason(licenseEntry),
        allowedModels: [...API_EXPOSED_MODELS],
        auditRecorded: true,
        auditEventType: 'segmentation_task_rejected',
      });
    }

    // --- 幂等键校验 ---
    const idempotencyKey = assertIdempotencyKey(idempotencyKeyHeader);
    const fingerprint = fingerprintRequestBody(request).digest;

    // --- 幂等重放判定 ---
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      // 同键不同体 -> 10001（契约 §2）
      const sameRequest =
        existing.study_uid === request.studyUid &&
        existing.model_name === request.model &&
        existing.phase_checked === request.targetPhase;
      if (!sameRequest) {
        resolveIdempotentReplay('different', fingerprint);
      }
      return toSubmitResponse(existing, true);
    }

    // --- 可见性探测（恒定索引路径）---
    const probe = await this.repository.probeStudy(request.studyUid);
    if (!probe) {
      // 检查不存在 -> 与无权限同样的 10004
      throw AppError.inaccessible();
    }

    // --- 校验 2：期相前置校验 ---
    // 序列必须属于该检查，否则跨检查引用序列会绕过检查级权限判定
    const series = await this.repository.probeSeries(request.seriesUid);
    if (!series || series.studyUid !== request.studyUid) {
      throw AppError.inaccessible();
    }
    const phaseCheck = evaluatePhaseEligibility(
      series.phase,
      series.phase_confidence,
      request.targetPhase
    );
    if (!phaseCheck.eligible) {
      throw AppError.preconditionNotMet(
        '该序列不满足本次分割的期相要求，请选择增强期相序列',
        {
          seriesPhase: series.phase,
          eligible: false,
          reasonCode: phaseCheck.reasonCode,
        }
      );
    }

    // --- 创建任务 + 同事务写审计 ---
    //
    // 任务行与审计行在**同一事务**内写入（`appendWith` 用的是业务连接）：
    // 两者要么一起提交、要么一起回滚，不存在「任务写成功但审计没写」的窗口。
    //
    // 事务提交**之后**才标记「业务审计已提交」——
    // 若事务回滚，审计行也没了，此时仍需由审计钩子补写一条失败审计。
    const created = await withTransaction(this.pool, async (client) => {
      const task = await this.repository.createTask(client, {
        studyId: probe.studyId,
        studyUid: request.studyUid,
        seriesId: series.seriesId,
        modelName: request.model,
        modelVersion: '2.18.0',
        weightsVersion: null,
        fast: request.fast === true,
        degraded: false,
        phaseChecked: series.phase,
        phaseEligible: phaseCheck.eligible,
        submittedBy: session.userId,
        idempotencyKey,
      });
      await this.auditService.appendWith(client, {
        eventType: 'SEGMENTATION_TASK_SUBMITTED',
        actorId: session.userId,
        actorRoles: session.roles,
        result: 'success',
        resourceType: 'segmentation_task',
        resourceId: task.id,
        detail: {
          model: request.model,
          modelVersion: '2.18.0',
          targetPhase: request.targetPhase,
          seriesPhase: series.phase,
          fast: request.fast === true,
          degraded: false,
        },
      });
      return task;
    });
    markBusinessAuditCommitted();

    return toSubmitResponse(created, false);
  }

  /**
   * GET /api/v1/segmentation-tasks/{taskId}
   *
   * 查询任务状态与结果。
   */
  async getTask(
    session: Session,
    taskIdParam: string
  ): Promise<components['schemas']['SegmentationTaskResponse']> {
    const taskId = parseResourceId(taskIdParam, 'seg');
    const access = toAccessContext(session);

    // 恒定索引路径的探测查询
    await this.repository.probeTask(taskId);

    const task = await this.repository.findTaskById(taskId, access);
    if (!task) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    const includeStructures = true;
    const structures = includeStructures
      ? await this.repository.findStructures(taskId)
      : [];
    const confirms = await this.confirmsRepository.findConfirms(taskId);

    return toTaskResponse(task, structures, confirms);
  }
}
