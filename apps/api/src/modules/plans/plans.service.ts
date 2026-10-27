import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { DB_POOL, withTransaction } from '../../common/db/pool.js';
import { formatResourceId, parseResourceId } from '../../common/id/ids.js';
import {
  assertIdempotencyKey,
  fingerprintRequestBody,
  resolveIdempotentReplay,
} from '../../common/idempotency/idempotency.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { markBusinessAuditCommitted } from '../../common/audit/audit-context.js';
import { PlansRepository, type PlanRow } from './plans.repository.js';
import { PlanCommandsRepository } from './plan-commands.repository.js';

/**
 * 规划方案业务逻辑。
 *
 * ## 乐观锁（v1.0 唯一的一致性手段）
 *
 * 契约明确不用 CRDT/OT：CRDT 静默合并会产生临床错误且不可审计（ADR-006）。
 * 本模块用 `version` 字段做乐观锁：客户端提交时必须带上它读到的版本号，
 * 不一致则返 409 + `20003`，由人工裁决。
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly commandsRepository: PlanCommandsRepository,
    private readonly auditService: AuditService,
    @Inject(DB_POOL) private readonly pool: Pool
  ) {}

  /**
   * POST /api/v1/plans
   *
   * 新建规划方案。**必须**携带 `Idempotency-Key`
   * （双击保存不产生两份方案）。
   */
  async createPlan(
    session: Session,
    body: {
      studyUid: string;
      segmentationTaskId?: string;
      planType: string;
      title?: string;
      payload: unknown;
    },
    idempotencyKeyHeader: string | undefined
  ): Promise<components['schemas']['PlanResponse']> {
    const idempotencyKey = assertIdempotencyKey(idempotencyKeyHeader);
    const fingerprint = fingerprintRequestBody(body).digest;

    // 幂等重放
    //
    // 契约 §2：「同一 Idempotency-Key + 同一请求体 -> 返回首次结果，
    // HTTP 200 + data.idempotentReplay = true」；
    // 「同一 Idempotency-Key + **不同**请求体 -> code 10001（幂等键冲突）」。
    //
    // 比对用**请求体指纹**，而不是逐字段比较 ——
    // 逐字段比较会漏字段（曾漏掉 title 与 segmentationTaskId），
    // 漏掉的字段变化就��会被误判成「同一体」而静默返回旧结果。
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      const recorded = await this.commandsRepository.findCommandByIdempotencyKey(
        existing.id,
        idempotencyKey
      );
      if (recorded?.requestFingerprint !== fingerprint) {
        // 同键异体 -> 幂等键冲突（10001）
        resolveIdempotentReplay(recorded?.requestFingerprint ?? 'different', fingerprint);
      }
      // 同键同体 -> 返回首次结果
      return this.toPlanResponse(existing, true);
    }

    // 可见性探测（恒定索引路径）
    const probe = await this.repository.probeStudy(body.studyUid);
    if (!probe) {
      throw AppError.inaccessible();
    }

    // 分割任务必须属于该检查，否则可跨检查引用他人任务
    let segmentationTaskId: string | null = null;
    if (body.segmentationTaskId) {
      segmentationTaskId = parseResourceId(body.segmentationTaskId, 'seg');
    }

    // 方案 + 操作日志 + 审计，同一事务
    const created = await withTransaction(this.pool, async (client) => {
      const plan = await this.repository.create(client, {
        studyId: probe.studyId,
        studyUid: body.studyUid,
        segmentationTaskId,
        planType: body.planType,
        title: body.title ?? null,
        payload: body.payload,
        createdBy: session.userId,
        idempotencyKey,
      });
      await this.commandsRepository.append(client, {
        planId: plan.id,
        commandType: 'create',
        beforeValue: null,
        // 幂等键与请求体指纹：创建与更新两条路径的幂等语义统一。
        // 指纹让「同键但请求体不同」能被识别为幂等键冲突（10001），
        // 而不会被静默当成重试。
        afterValue: {
          payload: body.payload,
          status: 'draft',
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
        actorId: session.userId,
        versionBefore: null,
        versionAfter: 1,
      });
      await this.auditService.appendWith(client, {
        eventType: 'PLAN_CREATED',
        actorId: session.userId,
        actorRoles: session.roles,
        result: 'success',
        resourceType: 'plan',
        resourceId: plan.id,
        detail: {
          studyUid: body.studyUid,
          planType: body.planType,
          version: 1,
        },
      });
      return plan;
    });
    markBusinessAuditCommitted();

    return this.toPlanResponse(created, false);
  }

  /**
   * PUT /api/v1/plans/{planId}
   *
   * 更新规划方案（乐观锁）。
   *
   * 冲突（`version` 与服务端当前值不一致）-> **HTTP 409** + `code 20003`，
   * 响应 `data.currentVersion` 与 `data.conflictingEditor` 供前端提示人工裁决。
   */
  async updatePlan(
    session: Session,
    planIdParam: string,
    body: {
      version: number;
      title?: string;
      payload?: unknown;
      status?: string;
    },
    idempotencyKeyHeader: string | undefined
  ): Promise<components['schemas']['PlanResponse']> {
    const planId = parseResourceId(planIdParam, 'plan');
    const idempotencyKey = assertIdempotencyKey(idempotencyKeyHeader);
    const access = toAccessContext(session);
    // 请求体指纹。用于幂等重放时判定「同键同体」还是「同键异体」
    const fingerprint = fingerprintRequestBody(body).digest;

    // 恒定索引路径的探测查询
    await this.repository.probe(planId);

    const current = await this.repository.findById(planId, access);
    if (!current) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    // 幂等重放：同一幂等键的更新已执行过 -> 返回首次结果，不产生多余版本。
    //
    // 契约 §2：「同一 Idempotency-Key + 同一请求体 -> 返回首次结果，
    // HTTP 200 + data.idempotentReplay = true」；「同一 Idempotency-Key +
    // **不同**请求体 -> code 10001（幂等键冲突）」。
    //
    // 关键：**必须**比对请求体指纹。若只按幂等键命中就返回，
    // 客户端复用幂等键改参数时会被静默当成「重试」，
    // 返回一个与本次请求无关的旧结果 —— 这比报冲突危险得多。
    const replay = await this.commandsRepository.findCommandByIdempotencyKey(planId, idempotencyKey);
    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        // 同键异体 -> 幂等键冲突（10001）
        resolveIdempotentReplay(replay.requestFingerprint ?? 'different', fingerprint);
      }
      // 同键同体 -> 返回首次结果
      return this.toPlanResponse(current, true);
    }

    // 归档后修改需医务部门审批（code 50004）
    if (current.status === 'archived') {
      throw AppError.reportArchived();
    }

    // 报告已签名 -> 方案随正文一并锁定（code 50003）
    if (current.locked_at) {
      throw AppError.reportSignedLocked();
    }

    // 乐观锁：version 不一致 -> 409 + 20003
    if (current.version !== body.version) {
      const info = await this.repository.findVersionInfo(planId);
      throw AppError.planVersionConflict(info?.version ?? current.version, {
        conflictingEditorId: info?.updatedBy,
        conflictingEditorMasked: info?.updatedByMasked ?? undefined,
        updatedAt: info?.updatedAt.toISOString(),
      });
    }

    // 更新 + 操作日志 + 审计，同一事务
    const updated = await withTransaction(this.pool, async (client) => {
      const plan = await this.repository.updateWithVersion(client, {
        planId,
        expectedVersion: body.version,
        title: body.title ?? null,
        payload: body.payload ?? null,
        status: body.status ?? null,
        updatedBy: session.userId,
      });
      if (!plan) {
        // 并发下另一请求抢先改了版本 -> 同样按冲突处理
        const info = await this.repository.findVersionInfo(planId);
        throw AppError.planVersionConflict(info?.version ?? current.version, {
          conflictingEditorId: info?.updatedBy,
          conflictingEditorMasked: info?.updatedByMasked ?? undefined,
          updatedAt: info?.updatedAt.toISOString(),
        });
      }
      await this.commandsRepository.append(client, {
        planId,
        commandType: body.status ? 'update_status' : 'update_payload',
        beforeValue: { payload: current.payload, title: current.title, status: current.status },
        // 幂等键与请求体指纹记在 after_value 里：
        //   - 幂等键 -> 同键重试可识别为重放，不产生多余版本
        //   - 指纹   -> 同键但请求体不同可识别为「幂等键冲突」（10001）
        afterValue: {
          payload: plan.payload,
          title: plan.title,
          status: plan.status,
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
        actorId: session.userId,
        versionBefore: current.version,
        versionAfter: plan.version,
      });
      await this.auditService.appendWith(client, {
        eventType: 'PLAN_UPDATED',
        actorId: session.userId,
        actorRoles: session.roles,
        result: 'success',
        resourceType: 'plan',
        resourceId: planId,
        detail: {
          versionBefore: current.version,
          versionAfter: plan.version,
        },
      });
      return plan;
    });
    markBusinessAuditCommitted();

    return this.toPlanResponse(updated, false);
  }

  /** DB 行 -> 契约方案 */
  private toPlanResponse(
    row: PlanRow,
    replay: boolean
  ): components['schemas']['PlanResponse'] {
    return {
      code: 0,
      message: '',
      data: {
        planId: formatResourceId('plan', row.id),
        studyUid: row.study_uid,
        segmentationTaskId: row.segmentation_task_id
          ? formatResourceId('seg', row.segmentation_task_id)
          : null,
        version: row.version,
        status: row.status as components['schemas']['PlanResponse']['data']['status'],
        planType: row.plan_type as components['schemas']['PlanType'],
        title: row.title,
        payload: row.payload as components['schemas']['PlanPayload'],
        createdBy: row.created_by,
        createdByNameMasked: row.created_by_name_masked ?? undefined,
        createdAt: row.created_at.toISOString(),
        updatedBy: row.updated_by,
        updatedByNameMasked: row.updated_by_name_masked ?? undefined,
        updatedAt: row.updated_at.toISOString(),
        idempotentReplay: replay,
      },
    };
  }
}
