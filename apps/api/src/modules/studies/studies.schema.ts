import { s } from '../../common/validation/schema.js';

/**
 * 检查列表的查询参数校验。
 *
 * 契约参数（openapi.yaml components/parameters）：
 * patientId / accessionNo / modality / studyDateFrom / studyDateTo /
 * status / visitType / page / limit / sort / order
 *
 * 全部可选，缺省取契约声明的默认值。
 */

/** 契约 Modality 枚举 */
export const MODALITIES = [
  'CT', 'MR', 'US', 'XA', 'CR', 'DX', 'MG', 'NM', 'PT', 'PET',
] as const;

/** 契约 StudyStatus 枚举 */
export const STUDY_STATUSES = [
  'registered', 'in_progress', 'completed', 'archived', 'cancelled',
] as const;

/** 契约 VisitType 枚举 */
export const VISIT_TYPES = [
  'outpatient', 'emergency', 'inpatient', 'physical_exam', 'day_surgery',
] as const;

/** 契约 Sort 枚举（白名单，防注入） */
export const SORT_FIELDS = ['studyDate', 'createdAt', 'updatedAt', 'accessionNo'] as const;

/** DICOM UID 正则（契约 StudyUidPath.pattern） */
export const DICOM_UID_PATTERN = /^[0-9]+(\.[0-9]+)+$/;

/** EMPI 正则（契约 PatientId.pattern） */
export const EMPI_PATTERN = /^EMPI[0-9]{10}$/;

/**
 * 列表查询参数。
 *
 * 用 `partial: true` —— 所有键都可选。
 * 数值型参数（page/limit）走 query string 时是字符串，这里做显式转换与范围校验。
 */
export const studyListQuerySchema = s.object(
  {
    patientId: s.optional(s.string({ pattern: EMPI_PATTERN, patternHint: '必须是 EMPI 格式' })),
    accessionNo: s.optional(s.string({ max: 32 })),
    modality: s.optional(s.enumOf(MODALITIES)),
    studyDateFrom: s.optional(s.string({ max: 40 })),
    studyDateTo: s.optional(s.string({ max: 40 })),
    status: s.optional(s.enumOf(STUDY_STATUSES)),
    visitType: s.optional(s.enumOf(VISIT_TYPES)),
    page: s.optional(s.number({ integer: true, min: 1 })),
    limit: s.optional(s.number({ integer: true, min: 1, max: 200 })),
    sort: s.optional(s.enumOf(SORT_FIELDS)),
    order: s.optional(s.enumOf(['asc', 'desc'] as const)),
  },
  { partial: true }
);

export type StudyListQuery = {
  patientId?: string;
  accessionNo?: string;
  modality?: string;
  studyDateFrom?: string;
  studyDateTo?: string;
  status?: string;
  visitType?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
};

/**
 * 把 query string 里的字符串转成契约声明的类型。
 *
 * Fastify 的 query 参数全是字符串（`?page=2` -> `'2'`）。
 * 直接交给数值校验器会因类型不符而报「必须为有限数字」，
 * 因此这里先做显式转换；转换失败的值按「未传」处理，
 * 由后续的缺省逻辑接管。
 */
export function normalizeStudyListQuery(raw: Record<string, unknown>): {
  patientId?: string;
  accessionNo?: string;
  modality?: string;
  studyDateFrom?: string;
  studyDateTo?: string;
  status?: string;
  visitType?: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
} {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  const int = (value: unknown): number | undefined => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    patientId: text(raw.patientId),
    accessionNo: text(raw.accessionNo),
    modality: text(raw.modality),
    studyDateFrom: text(raw.studyDateFrom),
    studyDateTo: text(raw.studyDateTo),
    status: text(raw.status),
    visitType: text(raw.visitType),
    sort: text(raw.sort) ?? 'studyDate',
    order: (text(raw.order) as 'asc' | 'desc' | undefined) ?? 'desc',
    page: int(raw.page) ?? 1,
    limit: int(raw.limit) ?? 20,
  };
}
