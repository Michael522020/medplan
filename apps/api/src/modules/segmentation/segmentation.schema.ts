import { s } from '../../common/validation/schema.js';

/**
 * AI 分割任务的请求校验。
 *
 * 严格模式（`additionalProperties: false`）：契约的 requestBody 均标注
 * `additionalProperties: false`，客户端多传字段一律拒绝。
 */

/** 契约 SegmentationModel 枚举（= 对外暴露的 Apache-2.0 白名单子集） */
export const SEGMENTATION_MODELS = [
  'total',
  'total_mr',
  'liver_segments',
  'lung_vessels',
] as const;

/** 契约 targetPhase 枚举。注意：**不含** plain —— 平扫不满足增强分割 */
export const TARGET_PHASES = ['arterial', 'portal', 'delayed'] as const;

/**
 * 提交分割任务。
 *
 * `model` 故意**不在这里**限制为枚举值 ——
 * 若在此处就按枚举拒绝，`brain_aneurysm` 会得到 10001（参数错误），
 * 而契约要求的是 **40003（模型许可不在白名单）**并写审计。
 *
 * 因此 `model` 只做「非空字符串 + 长度上限」的形式校验，
 * 许可判定交给 service 层的白名单检查（AC-09）。
 */
export const createSegmentationTaskSchema = s.object({
  studyUid: s.string({
    pattern: /^[0-9]+(\.[0-9]+)+$/,
    patternHint: '不是合法的 DICOM UID',
    max: 64,
  }),
  seriesUid: s.string({
    pattern: /^[0-9]+(\.[0-9]+)+$/,
    patternHint: '不是合法的 DICOM UID',
    max: 64,
  }),
  model: s.string({ min: 1, max: 64 }),
  fast: s.optional(s.boolean()),
  targetPhase: s.enumOf(TARGET_PHASES),
});

/**
 * 医师逐项确认。
 *
 * ## 关键安全约束
 *
 * **本 schema 不含 `confirmedBy` / `confirmedAt`，且 `additionalProperties: false`。**
 * 客户端传了这两个字段会被**直接拒绝**（整个请求 10001）。
 *
 * 这不是「service 层忽略该字段」，而是**入口就拒绝**——
 * 若确认人可由前端指定，任何登录用户都能代签别人的医师确认，
 * AC-11「强制逐项医师确认」形同虚设（国卫办医发〔2017〕8 号操作印痕要求）。
 */
export const confirmSegmentationSchema = s.object({
  items: s.array(
    s.object({
      structureName: s.string({ min: 1, max: 64 }),
      action: s.enumOf(['confirmed', 'modified'] as const),
      modificationNote: s.optional(s.string({ max: 500 })),
    }),
    { minItems: 1, maxItems: 200 }
  ),
});

export type ConfirmSegmentationInput = {
  items: Array<{
    structureName: string;
    action: 'confirmed' | 'modified';
    modificationNote?: string;
  }>;
};
