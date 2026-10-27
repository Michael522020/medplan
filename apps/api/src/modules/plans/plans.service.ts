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
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      const sameRequest =
        existing.study_uid === body.studyUid &&
        existing.plan_type === body.planType &&
        JSON.stringify(existing.payload) === JSON.stringify(body.payload);
      if (!sameRequest) {
        resolveIdempotentReplay('different', fingerprint);
      }
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
        afterValue: { payload: body.payload, status: 'draft' },
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

    // 恒定索引路径的探测查询
    await this.repository.probe(planId);

    const current = await this.repository.findById(planId, access);
    if (!current) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    // 幂等重放：同一幂等键的更新已执行过 -> 返回当前状态，不产生多余版本。
    // 契约：「重试不产生多余版本」。
    const replay = await this.commandsRepository.findUpdateByIdempotencyKey(planId, idempotencyKey);
    if (replay) {
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
        // 幂等键记在 after_value 里：同键重试可识别为重放，不产生多余版本
        afterValue: {
          payload: plan.payload,
          title: plan.title,
          status: plan.status,
          idempotencyKey,
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
