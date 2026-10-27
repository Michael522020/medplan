import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { DB_POOL, withTransaction } from '../../common/db/pool.js';
import { formatResourceId, parseResourceId } from '../../common/id/ids.js';
import { assertIdempotencyKey } from '../../common/idempotency/idempotency.service.js';
import { SegmentationRepository } from './segmentation.repository.js';
import { SegmentationConfirmsRepository } from './segmentation-confirms.repository.js';
import { buildConfirmProgress } from './segmentation-mapper.js';

/**
 * 医师逐项确认 AI 辅助标记。
 *
 * 单独成文件的原因：这是**合规归档证据**（国卫办医发〔2017〕8 号操作印痕、
 * PRD AI-03），它的「确认人身份不可由前端指定」这条约束值得独占一个文件，
 * 让审阅者能完整看到这条安全边界而不被提交/查询逻辑打断。
 */
@Injectable()
export class SegmentationConfirmService {
  constructor(
    private readonly repository: SegmentationRepository,
    private readonly confirmsRepository: SegmentationConfirmsRepository,
    @Inject(DB_POOL) private readonly pool: Pool
  ) {}

  /**
   * POST /api/v1/segmentation-tasks/{taskId}/confirm
   *
   * ## 安全约束：确认人身份不由前端传入
   *
   * 契约 `ConfirmSegmentationRequest` 的 schema **不含** `confirmedBy` /
   * `confirmedAt`，且两层都设了 `additionalProperties: false`，
   * 客户端传了会被 schema 直接拒绝。
   *
   * 本方法从**会话**取确认人（`session.userId`），确认时间用**服务端**的
   * `now()`。若确认人可由前端指定，任何登录用户都能代签别人的医师确认，
   * AC-11「强制逐项医师确认」形同虚设。
   */
  async confirmItems(
    session: Session,
    taskIdParam: string,
    body: {
      items: Array<{ structureName: string; action: string; modificationNote?: string }>;
    },
    idempotencyKeyHeader: string | undefined
  ): Promise<components['schemas']['ConfirmSegmentationResponse']> {
    const taskId = parseResourceId(taskIdParam, 'seg');
    const access = toAccessContext(session);
    const idempotencyKey = assertIdempotencyKey(idempotencyKeyHeader);

    // 恒定索引路径的探测查询
    await this.repository.probeTask(taskId);

    const task = await this.repository.findTaskById(taskId, access);
    if (!task) {
      throw AppError.inaccessible();
    }

    // 任务必须已成功结束才可确认（契约 409）
    if (task.status !== 'succeeded') {
      throw AppError.paramInvalid('任务尚未成功完成，暂不可确认');
    }

    // 确认项必须属于本任务的实际分割结果。
    // 不属于 -> 10003（角色/归属级），**不是** 10004 ——
    // 10004 保留给患者级越权，混用会污染那条安全语义（契约 422 说明）。
    const knownStructures = await this.confirmsRepository.findStructureNames(taskId);
    for (const item of body.items) {
      if (!knownStructures.has(item.structureName)) {
        throw AppError.forbiddenRole(
          '所确认的分割项不属于当前任务，或无权确认该检查的 AI 标记'
        );
      }
    }

    // 修改必须带备注（无备注的修改一律拒绝）
    for (const item of body.items) {
      if (item.action === 'modified' && !item.modificationNote?.trim()) {
        throw AppError.paramInvalid('action 为 modified 时必须填写 modificationNote');
      }
    }

    // 实习/试用期医师的确认需要上级复核
    const pendingSupervisorReview = session.roles.includes('trainee_physician');

    const structures = await this.repository.findStructures(taskId);
    const volumeByStructure = new Map(
      structures.map((row) => [row.structure_name, row.volume_ml])
    );

    await withTransaction(this.pool, async (client) => {
      for (const item of body.items) {
        await this.confirmsRepository.upsertConfirm(client, {
          taskId,
          structureName: item.structureName,
          action: item.action,
          modificationNote: item.modificationNote ?? null,
          volumeMlSnapshot: volumeByStructure.get(item.structureName) ?? null,
          // 确认人来自会话，不来自请求体
          confirmedBy: session.userId,
          pendingSupervisorReview,
          idempotencyKey,
        });
      }
    });

    const confirms = await this.confirmsRepository.findConfirms(taskId);

    return {
      code: 0,
      message: '',
      data: {
        taskId: formatResourceId('seg', task.id),
        accepted: body.items.length,
        rejected: 0,
        confirmProgress: buildConfirmProgress(structures, confirms),
        pendingSupervisorReview,
        idempotentReplay: false,
        confirmedAt: new Date().toISOString(),
      },
    };
  }
}
