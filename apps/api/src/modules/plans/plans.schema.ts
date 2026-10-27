import { AppError } from '../../common/errors/app-error.js';
import { s } from '../../common/validation/schema.js';

/**
 * 规划方案的请求校验。
 */

/** 契约 PlanType 枚举 */
export const PLAN_TYPES = [
  'hepatic_wedge_resection',
  'hepatic_right_lobectomy',
  'nephro_partial_resection',
  'pulmonary_lobectomy',
  'thoracic_wedge_resection',
  'abdominal_puncture_path',
] as const;

/** 契约 status 枚举（状态流转 draft -> confirmed -> archived） */
export const PLAN_STATUSES = ['draft', 'confirmed', 'archived'] as const;

/**
 * 规划方案数据（payload）。
 *
 * 契约刻意保持松散（ADR-004：jsonb + GIN 索引，避免过早固定 Schema），
 * 但**必须**包含 `entry`（入路点）与 `target`（靶点）两组坐标 ——
 * 否则三维视图无法渲染。
 *
 * 硬约束（与 AI 合规边界同源）：扩展键只允许**中性几何 / 量化**语义。
 * 禁止引入病灶性质、疗效评价、术式建议等结论性字段
 * （`nature` / `diagnosis` / `malignancy` / `recommendation` 等）——
 * 那是越过辅助决策边界。
 *
 * 这里的校验是**白名单 + 禁词**：既不锁死科室自定义键，
 * 又能挡住结论性字段。契约的 lint_openapi.js 已把同一约束固化为断言。
 */
const FORBIDDEN_PAYLOAD_KEYS = [
  'nature',
  'diagnosis',
  'malignancy',
  'benign',
  'impression',
  'suggestion',
  'recommendation',
  'conclusion',
  'comment',
  'finding',
];

/** 三个坐标分量的校验 */
const coordinateSchema = s.array(s.number(), { minItems: 3, maxItems: 3 });

export const planPayloadSchema = s.object({
  entry: s.object({
    patientXYZmm: coordinateSchema,
    orientation: s.optional(
      s.enumOf([
        'anterior',
        'posterior',
        'posterolateral_right',
        'posterolateral_left',
        'lateral_right',
        'lateral_left',
        'superior',
        'inferior',
      ] as const)
    ),
    label: s.optional(s.string({ max: 64 })),
  }),
  target: s.object({
    patientXYZmm: coordinateSchema,
    structureName: s.string({ min: 1, max: 64 }),
    label: s.optional(s.string({ max: 64 })),
  }),
  approachAngleDeg: s.optional(s.number({ min: 0, max: 90 })),
  corridorWidthMm: s.optional(s.number({ min: 0 })),
  avoidanceStructures: s.optional(s.array(s.string({ max: 64 }), { maxItems: 64 })),
  notes: s.optional(s.string({ max: 1000 })),
});

/**
 * 创建方案。
 *
 * `payload` 允许额外键（科室自定义），但禁止结论性字段 ——
 * 因此这里**不能**用默认严格的 `s.object`，需要单独的宽松对象校验。
 */
export const createPlanSchema = s.object({
  studyUid: s.string({
    pattern: /^[0-9]+(\.[0-9]+)+$/,
    patternHint: '不是合法的 DICOM UID',
    max: 64,
  }),
  segmentationTaskId: s.optional(s.string({ max: 64 })),
  planType: s.enumOf(PLAN_TYPES),
  title: s.optional(s.string({ max: 200 })),
  payload: s.unknown(),
});

/** 更新方案。`version` 必填 —— 这是乐观锁的载体 */
export const updatePlanSchema = s.object({
  version: s.number({ integer: true, min: 1 }),
  title: s.optional(s.string({ max: 200 })),
  payload: s.optional(s.unknown()),
  status: s.optional(s.enumOf(PLAN_STATUSES)),
});

export type CreatePlanInput = {
  studyUid: string;
  segmentationTaskId?: string;
  planType: string;
  title?: string;
  payload: unknown;
};

export type UpdatePlanInput = {
  version: number;
  title?: string;
  payload?: unknown;
  status?: string;
};

/**
 * 校验 payload 的合规边界。
 *
 * 三条规则：
 *   1. 必须含 `entry` 与 `target`（渲染必需）
 *   2. 扩展键不得含结论性字段（AI 合规边界）
 *   3. 键名不得含结论性词根（大小写不敏感）
 *
 * 违规 -> 10001。
 */
export function assertPayloadCompliance(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw AppError.paramInvalid('payload 必须为对象');
  }
  const record = payload as Record<string, unknown>;

  if (!('entry' in record)) {
    throw AppError.paramInvalid('payload 必须包含 entry（入路点）');
  }
  if (!('target' in record)) {
    throw AppError.paramInvalid('payload 必须包含 target（靶点）');
  }

  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    // 词根匹配：拦住 `lesion_nature`、`ai_diagnosis` 这类拼接字段名
    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      if (lower.includes(forbidden)) {
        throw AppError.paramInvalid(`payload 不允许包含结论性字段：${key}`);
      }
    }
  }
}
