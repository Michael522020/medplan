import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { AUDIT_POOL } from '../db/pool.js';
import type { RoleCode } from '../auth/session.js';
import type { AuditEvent } from './audit-hook.js';
import { toDbEventType, type ContractAuditEventType } from './audit-event-type.js';
import type { ModelLicenseEntry } from '../../modules/segmentation/model-license-whitelist.js';

/**
 * 审计写入。
 *
 * ## 账号分离（等保 8.1.4.2 权限分离）
 *
 * 审计写入走**专用账号 app_audit**（只对 audit_logs 有 INSERT + SELECT，
 * 碰不到任何业务表）。业务账号即便被攻破也改不了审计；
 * 审计账号即便被攻击也碰不到 PHI 业务数据。
 *
 * ## hash chain 由数据库计算
 *
 * `audit_logs` 上有 `trg_audit_chain` BEFORE INSERT 触发器，
 * 用 `pg_advisory_xact_lock` 串行化写入并计算 `hash_prev` / `hash_self`。
 * 应用层**不计算**摘要 —— 自己算会和触发器的算法漂移，
 * 导致整条链校验失败。
 *
 * ## 失败必须向上抛（fail-closed）
 *
 * 审计写入失败**不得**放行业务请求 —— 审计丢失是不可接受的
 * （等保 8.1.4.3）。本 service 不 catch 任何异常，
 * 由调用方决定如何处理，但绝不能吞掉。
 */
export interface AuditRecordInput {
  /** 契约事件类型 */
  eventType: ContractAuditEventType;
  /** 操作人。系统任务为服务账号 */
  actorId: string | null;
  /** 操作时刻的角色快照 */
  actorRoles: string[];
  /** 操作结果 */
  result: 'success' | 'failure' | 'denied';
  /** 失败/拒绝时的业务错误码 */
  resultCode?: number | null;
  /** 被访问患者 */
  patientId?: string | null;
  resourceType: string;
  resourceId: string;
  sourceIp?: string | null;
  terminalId?: string | null;
  /** 事件明细。禁止写入姓名明文、身份证、手机号 */
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_POOL) private readonly auditPool: Pool) {}

  /**
   * 追加一条审计记录。
   *
   * @throws 写入失败时抛原始异常（fail-closed）
   */
  async append(input: AuditRecordInput): Promise<void> {
    await this.appendWith(this.auditPool, input);
  }

  /**
   * 用给定连接（Pool 或 PoolClient）追加审计记录。
   *
   * 传入 `PoolClient` 时审计写入与业务写入处于**同一事务** ——
   * 这是「业务写成功但审计没写」这一中间态的消除方式。
   *
   * 依据：`schema.sql` 授予了 `app_rw` 对 audit_logs 的 INSERT 权限
   * （`GRANT INSERT ON audit_logs TO app_rw; -- 业务服务可写审计（经审计拦截器）`），
   * 同时 REVOKE 了 UPDATE/DELETE/TRUNCATE —— 能写不能改，防篡改第一层不变。
   */
  async appendWith(
    executor: Pool | PoolClient,
    input: AuditRecordInput
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_logs (
         actor_id, actor_roles, event_type, result, result_code,
         patient_id, resource_type, resource_id, source_ip, terminal_id, detail
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.actorId,
        input.actorRoles,
        toDbEventType(input.eventType),
        input.result,
        input.resultCode ?? null,
        input.patientId ?? null,
        input.resourceType,
        input.resourceId,
        input.sourceIp ?? null,
        input.terminalId ?? null,
        JSON.stringify(input.detail ?? {}),
      ]
    );
  }

  /**
   * 追加一条由审计钩子派生的记录。
   *
   * 钩子的事件类型是「资源类型.方法」派生的（如 `studies.get`），
   * 不是契约枚举值，因此这里做一次归一化。
   */
  async appendEvent(event: AuditEvent): Promise<void> {
    await this.append({
      eventType: normalizeHookEventType(event.eventType),
      actorId: event.actorId,
      actorRoles: event.actorRoles,
      result: event.result,
      resultCode: event.resultCode ?? null,
      patientId: event.patientId ?? null,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      sourceIp: event.sourceIp ?? null,
      terminalId: event.terminalId ?? null,
      detail: event.detail ?? {},
    });
  }

  /**
   * 记录一次**模型许可拒绝**（AC-09）。
   *
   * 契约 `ModelLicenseRejectedDetail` 要求 `auditRecorded` 恒为 true ——
   * 「白名单拒绝本身是必须留痕的合规事件」。
   *
   * ## 顺序很重要
   *
   * 审计写入**先于**抛 40003。若审计写入失败，异常向上抛，
   * 请求以 500 结束，`auditRecorded: true` 不会被返回 ——
   * 否则就是在对前端谎报「已记入审计」，那比不记更糟。
   */
  async recordModelLicenseRejection(params: {
    actorId: string;
    actorRoles: RoleCode[];
    studyUid: string;
    requestedModel: string;
    license: ModelLicenseEntry | undefined;
    sourceIp?: string | null;
  }): Promise<void> {
    await this.append({
      eventType: 'SEGMENTATION_TASK_REJECTED',
      actorId: params.actorId,
      actorRoles: params.actorRoles,
      result: 'denied',
      resultCode: 40003,
      resourceType: 'segmentation_task',
      resourceId: params.studyUid,
      sourceIp: params.sourceIp ?? null,
      detail: {
        reason: params.license
          ? `模型 ${params.requestedModel} 的许可为 ${params.license.license}，不允许商业使用`
          : `模型 ${params.requestedModel} 不在许可白名单内`,
        requestedModel: params.requestedModel,
        requestedLicense: params.license?.license ?? 'UNKNOWN',
        commercialUseAllowed: params.license?.commercialUseAllowed ?? false,
      },
    });
  }
}

/**
 * 钩子事件类型 -> 契约事件类型。
 *
 * 钩子按**路由模式**生成事件类型（见 audit-hook.ts 的 ROUTE_EVENT_TYPES），
 * 精确对应契约里每个端点的 `x-audit-event`。
 *
 * 映射表是显式列举而非字符串推导 —— 因为契约事件类型与路由的对应关系
 * 是**规范决定**（openapi.yaml 里逐个端点标注），不是命名规律。
 * 用推导（例如把 `studies.list` 去掉后缀）会在新增端点时静默错配，
 * 而错配的审计事件在等保测评里是查不出来的。
 */
const HOOK_EVENT_TYPE_MAP: ReadonlyMap<string, ContractAuditEventType> = new Map([
  ['auth.login', 'AUTH_LOGIN'],
  ['studies.list', 'STUDY_LIST_VIEWED'],
  ['studies.series', 'STUDY_SERIES_VIEWED'],
  ['wado.instances', 'DICOM_INSTANCES_RETRIEVED'],
  ['segmentation-tasks.submit', 'SEGMENTATION_TASK_SUBMITTED'],
  ['segmentation-tasks.read', 'SEGMENTATION_TASK_READ'],
  ['segmentation-tasks.confirm', 'SEGMENTATION_ITEM_CONFIRMED'],
  ['plans.create', 'PLAN_CREATED'],
  ['plans.update', 'PLAN_UPDATED'],
  ['reports.read', 'REPORT_VIEWED'],
  ['reports.sign', 'REPORT_SIGNED'],
  ['audit-logs.query', 'AUDIT_LOG_QUERIED'],
]);

/** 钩子事件类型归一化。无法映射时用一个确定性的兜底值 */
function normalizeHookEventType(raw: string): ContractAuditEventType {
  return HOOK_EVENT_TYPE_MAP.get(raw) ?? 'AUTH_LOGOUT';
}
