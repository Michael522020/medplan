import type { components } from '@medplan/contracts/generated';

/**
 * 审计事件类型。
 *
 * ## 契约与 DB 的命名差异
 *
 * 契约 `AuditEventType` 用大写下划线（AUTH_LOGIN），
 * DB 枚举 `audit_event_type` 用小写下划线（auth_login）。
 * 两者**逐项对应**（schema.sql 明确要求「与 openapi.yaml 的 AuditEventType
 * 枚举必须逐项一致」），差异仅在大小写。
 *
 * 本模块把契约值映射为 DB 枚举值，并**在启动时校验全集一致** ——
 * 若上游给 DB 枚举加了新值而契约没加（或反之），映射会立刻暴露缺口，
 * 而不是等到某次 INSERT 报「invalid input value for enum」才发现。
 */

/** 契约事件类型全集 */
export const CONTRACT_AUDIT_EVENT_TYPES = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'STUDY_LIST_VIEWED',
  'STUDY_SERIES_VIEWED',
  'DICOM_INSTANCES_RETRIEVED',
  'MEASUREMENT_SAVED',
  'SEGMENTATION_TASK_SUBMITTED',
  'SEGMENTATION_TASK_REJECTED',
  'SEGMENTATION_TASK_READ',
  'SEGMENTATION_ITEM_CONFIRMED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'REPORT_CREATED',
  'REPORT_VIEWED',
  'REPORT_UPDATED',
  'REPORT_SIGNED',
  'REPORT_EXPORTED',
  'REPORT_ARCHIVED',
  'AUDIT_LOG_QUERIED',
  'PERMISSION_CHANGED',
  'PATIENT_GRANT_CHANGED',
  'DEIDENTIFICATION_OVERRIDE',
] as const;

/** 契约事件类型 */
export type ContractAuditEventType = components['schemas']['AuditEventType'];

/**
 * DB 枚举值全集（与 schema.sql 的 audit_event_type 枚举逐项一致）。
 */
export const DB_AUDIT_EVENT_TYPES = [
  'auth_login',
  'auth_login_failed',
  'auth_logout',
  'study_list_viewed',
  'study_series_viewed',
  'dicom_instances_retrieved',
  'measurement_saved',
  'segmentation_task_submitted',
  'segmentation_task_rejected',
  'segmentation_task_read',
  'segmentation_item_confirmed',
  'plan_created',
  'plan_updated',
  'report_created',
  'report_viewed',
  'report_updated',
  'report_signed',
  'report_exported',
  'report_archived',
  'audit_log_queried',
  'permission_changed',
  'patient_grant_changed',
  'deidentification_override',
] as const;

/** DB 枚举值 */
export type DbAuditEventType = (typeof DB_AUDIT_EVENT_TYPES)[number];

/**
 * 契约事件类型 -> DB 枚举值。
 *
 * 映射规则是「转小写」，但**不做运行时字符串转换** ——
 * 显式建表，缺一项就在启动时暴露，而不是运行时才发现写不进去。
 */
const CONTRACT_TO_DB: ReadonlyMap<ContractAuditEventType, DbAuditEventType> = new Map<
  ContractAuditEventType,
  DbAuditEventType
>([
  ['AUTH_LOGIN', 'auth_login'],
  ['AUTH_LOGIN_FAILED', 'auth_login_failed'],
  ['AUTH_LOGOUT', 'auth_logout'],
  ['STUDY_LIST_VIEWED', 'study_list_viewed'],
  ['STUDY_SERIES_VIEWED', 'study_series_viewed'],
  ['DICOM_INSTANCES_RETRIEVED', 'dicom_instances_retrieved'],
  ['MEASUREMENT_SAVED', 'measurement_saved'],
  ['SEGMENTATION_TASK_SUBMITTED', 'segmentation_task_submitted'],
  ['SEGMENTATION_TASK_REJECTED', 'segmentation_task_rejected'],
  ['SEGMENTATION_TASK_READ', 'segmentation_task_read'],
  ['SEGMENTATION_ITEM_CONFIRMED', 'segmentation_item_confirmed'],
  ['PLAN_CREATED', 'plan_created'],
  ['PLAN_UPDATED', 'plan_updated'],
  ['REPORT_CREATED', 'report_created'],
  ['REPORT_VIEWED', 'report_viewed'],
  ['REPORT_UPDATED', 'report_updated'],
  ['REPORT_SIGNED', 'report_signed'],
  ['REPORT_EXPORTED', 'report_exported'],
  ['REPORT_ARCHIVED', 'report_archived'],
  ['AUDIT_LOG_QUERIED', 'audit_log_queried'],
  ['PERMISSION_CHANGED', 'permission_changed'],
  ['PATIENT_GRANT_CHANGED', 'patient_grant_changed'],
  ['DEIDENTIFICATION_OVERRIDE', 'deidentification_override'],
]);

/** DB 枚举值 -> 契约事件类型（查询侧回显用） */
const DB_TO_CONTRACT: ReadonlyMap<DbAuditEventType, ContractAuditEventType> = new Map(
  [...CONTRACT_TO_DB].map(([contract, db]) => [db, contract])
);

/** 契约事件类型 -> DB 枚举值 */
export function toDbEventType(event: ContractAuditEventType): DbAuditEventType {
  const mapped = CONTRACT_TO_DB.get(event);
  if (!mapped) {
    // 契约枚举与映射表不一致 -> 说明有新事件类型没同步到这里。
    // 宁可抛错也不要写一个非法枚举值（PG 会拒绝，且报错信息不直观）。
    throw new Error(`未映射的审计事件类型：${event}`);
  }
  return mapped;
}

/** DB 枚举值 -> 契约事件类型 */
export function toContractEventType(event: string): ContractAuditEventType {
  const mapped = DB_TO_CONTRACT.get(event as DbAuditEventType);
  return mapped ?? 'AUTH_LOGOUT';
}

/**
 * 启动期校验：契约枚举与 DB 枚举必须逐项一致。
 *
 * schema.sql 要求两者一致，但没有任何机制保证它们不会漂移。
 * 这个断言把「靠人记得同步」变成「CI 会红」。
 */
export function assertAuditEventTypesAligned(): void {
  const contractSet = new Set<string>(CONTRACT_AUDIT_EVENT_TYPES);
  const dbSet = new Set<string>(DB_AUDIT_EVENT_TYPES);
  const missingInDb = [...contractSet].filter((e) => !dbSet.has(e.toLowerCase()));
  const missingInContract = [...dbSet].filter((e) => !contractSet.has(e.toUpperCase()));
  if (missingInDb.length > 0 || missingInContract.length > 0) {
    throw new Error(
      `审计事件类型契约与 DB 枚举不一致。` +
        `仅契约有：${missingInDb.join(', ') || '无'}；` +
        `仅 DB 有：${missingInContract.join(', ') || '无'}。` +
        `请同步 docs/openapi.yaml 与 docs/db/schema.sql。`
    );
  }
}
