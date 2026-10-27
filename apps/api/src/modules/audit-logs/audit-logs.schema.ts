import { s } from '../../common/validation/schema.js';

/**
 * 审计日志查询参数校验。
 */

/** 契约 AuditEventType 枚举 */
export const AUDIT_EVENT_TYPES = [
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

/** 契约 AuditResult 枚举 */
export const AUDIT_RESULTS = ['success', 'failure', 'denied'] as const;

/** 契约 ResourceType 枚举 */
export const AUDIT_RESOURCE_TYPES = [
  'study',
  'series',
  'instance',
  'segmentation_task',
  'plan',
  'report',
  'signature',
  'user',
  'role',
  'patient_grant',
  'measurement',
  'session',
] as const;

export const auditLogQuerySchema = s.object(
  {
    actorId: s.optional(s.string({ max: 64 })),
    eventType: s.optional(s.array(s.enumOf(AUDIT_EVENT_TYPES), { maxItems: 20 })),
    patientId: s.optional(s.string({ max: 32 })),
    resourceType: s.optional(s.enumOf(AUDIT_RESOURCE_TYPES)),
    result: s.optional(s.enumOf(AUDIT_RESULTS)),
    eventTimeFrom: s.optional(s.string({ max: 40 })),
    eventTimeTo: s.optional(s.string({ max: 40 })),
    page: s.optional(s.number({ integer: true, min: 1 })),
    limit: s.optional(s.number({ integer: true, min: 1, max: 200 })),
    verifyChain: s.optional(s.boolean()),
  },
  { partial: true }
);

/**
 * 归一化查询参数。
 *
 * Fastify 的 query 全是字符串；`eventType` 可重复传（多选），
 * 此时 Fastify 给的是数组。
 */
export function normalizeAuditQuery(raw: Record<string, unknown>): {
  actorId?: string;
  eventTypes?: string[];
  patientId?: string;
  resourceType?: string;
  result?: string;
  eventTimeFrom?: string;
  eventTimeTo?: string;
  page: number;
  limit: number;
  verifyChain: boolean;
} {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  // 转换失败保留 NaN，让 s.number() 报「必须为有限数字」（10001），
  // 而不是静默套用缺省值（那会让用户以为翻到了第 1 页，实际参数被丢弃）
  const int = (value: unknown, fallback: number): number => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  };

  // eventType 可重复传：Fastify 在重复 query key 时给出数组
  const rawEventTypes = raw.eventType;
  const eventTypes = Array.isArray(rawEventTypes)
    ? rawEventTypes.filter((v): v is string => typeof v === 'string')
    : typeof rawEventTypes === 'string' && rawEventTypes.length > 0
      ? [rawEventTypes]
      : undefined;

  return {
    actorId: text(raw.actorId),
    eventTypes,
    patientId: text(raw.patientId),
    resourceType: text(raw.resourceType),
    result: text(raw.result),
    eventTimeFrom: text(raw.eventTimeFrom),
    eventTimeTo: text(raw.eventTimeTo),
    page: int(raw.page, 1),
    limit: int(raw.limit, 20),
    // 契约默认 true：质控追溯场景建议开启
    verifyChain: raw.verifyChain === undefined ? true : raw.verifyChain === true || raw.verifyChain === 'true',
  };
}
