/**
 * TotalSegmentator 2.18.0 任务许可白名单。
 *
 * ## 为什么要这个文件
 *
 * TotalSegmentator 共 46 个 task，其中**仅 31 个**的权重以 Apache-2.0 开放，
 * 其余 15 个属于「需申请许可、非商业用途免费」的一类。
 * `brain_aneurysm` 更是明确标注 **CC BY-NC 4.0 且不提供商业许可**。
 *
 * 若不校验，后端可被提交一个非商用授权的 task —— 这在院内私有化商业交付中
 * 是直接的许可证违约风险。因此 AC-09 要求：**服务端在启动时以常量校验拒绝**，
 * 运行时返 `code 40003` 并写审计。
 *
 * 本文件是**唯一权威来源**：新增 task 必须先经法务确认许可，
 * 再同步本文件与 openapi.yaml 的 `SegmentationModel` 枚举。
 *
 * ## 数据来源
 *
 * 上游 README（Apache-2.0 仓库）明确以两段列出全部 task：
 *   - "Openly available for any usage (Apache-2.0 license)"  -> 31 个
 *   - "Available with a license (free licenses available for non-commercial usage ...
 *      For a commercial license contact ...)"                -> 15 个
 * 来源：https://github.com/wasserth/TotalSegmentator#subtasks
 *
 * 许可状态随上游版本变化。**升级 TotalSegmentator 版本时必须重新核对本文件**，
 * 否则可能把已改许可的 task 放进白名单（或漏掉新开放的 task）。
 */

/** 权重许可类型 */
export type ModelLicense =
  /** Apache-2.0：可商用，闭源分发无传染风险 */
  | 'Apache-2.0'
  /** CC BY-NC 4.0：署名-非商业性使用，禁止商业使用 */
  | 'CC BY-NC 4.0'
  /** 上游要求另行申请许可（学术免费，商业需单独授权） */
  | 'Commercial license required';

/** 白名单条目 */
export interface ModelLicenseEntry {
  /** task 名 */
  readonly task: string;
  /** 权重许可类型 */
  readonly license: ModelLicense;
  /** 是否允许院内商业化使用 */
  readonly commercialUseAllowed: boolean;
  /** 上游说明（含额外限制，如「需引用论文」） */
  readonly note: string;
}

/**
 * Apache-2.0 白名单（31 个）。
 *
 * 上游原文："Openly available for any usage (Apache-2.0 license)"
 */
const APACHE_2_0_TASKS: readonly string[] = [
  'total',
  'total_mr',
  'lung_vessels',
  'lung_vessels_LEGACY',
  'body',
  'body_mr',
  'vertebrae_mr',
  'cerebral_bleed',
  'hip_implant',
  'pleural_pericard_effusion',
  'head_glands_cavities',
  'head_muscles',
  'headneck_bones_vessels',
  'headneck_muscles',
  'liver_vessels',
  'oculomotor_muscles',
  'lung_nodules',
  'kidney_cysts',
  'breasts',
  'liver_segments',
  'liver_segments_mr',
  'craniofacial_structures',
  'abdominal_muscles',
  'teeth',
  'trunk_cavities',
  'ventricle_parts',
  'liver_lesions',
  'liver_lesions_mr',
  'vertebrae_pp',
  'vertebrae_pp_refined',
  'vertebrae_body',
];

/**
 * 需要另行申请许可的 task（15 个）。
 *
 * 上游原文："Available with a license (free licenses available for non-commercial
 * usage ... For a commercial license contact ...)"
 *
 * 其中 `brain_aneurysm` 被上游单独标注为 **CC BY-NC 4.0，且明确不提供商业许可**，
 * 是最典型的「一提交就违约」陷阱。
 */
const LICENSED_TASKS: readonly ModelLicenseEntry[] = [
  { task: 'heartchambers_highres', license: 'Commercial license required', commercialUseAllowed: false, note: '亚毫米分辨率心脏 chambers' },
  { task: 'appendicular_bones', license: 'Commercial license required', commercialUseAllowed: false, note: '手足等末端骨骼' },
  { task: 'appendicular_bones_mr', license: 'Commercial license required', commercialUseAllowed: false, note: 'MR 末端骨骼' },
  { task: 'tissue_types', license: 'Commercial license required', commercialUseAllowed: false, note: '组织类型分类（脂肪/肌肉）' },
  { task: 'tissue_types_mr', license: 'Commercial license required', commercialUseAllowed: false, note: 'MR 组织类型' },
  { task: 'tissue_4_types', license: 'Commercial license required', commercialUseAllowed: false, note: '扩展组织类型（含肌间脂肪）' },
  { task: 'brain_structures', license: 'Commercial license required', commercialUseAllowed: false, note: '精细脑区结构（CT）' },
  { task: 'face', license: 'Commercial license required', commercialUseAllowed: false, note: '面部区域（用于去匿名化）' },
  { task: 'face_mr', license: 'Commercial license required', commercialUseAllowed: false, note: 'MR 面部区域' },
  { task: 'thigh_shoulder_muscles', license: 'Commercial license required', commercialUseAllowed: false, note: '大腿与肩部肌肉' },
  { task: 'thigh_shoulder_muscles_mr', license: 'Commercial license required', commercialUseAllowed: false, note: 'MR 大腿与肩部肌肉' },
  { task: 'coronary_arteries', license: 'Commercial license required', commercialUseAllowed: false, note: '冠状动脉（非增强序列）' },
  { task: 'coronary_arteries_LEGACY', license: 'Commercial license required', commercialUseAllowed: false, note: '旧版冠状动脉' },
  { task: 'aortic_sinuses', license: 'Commercial license required', commercialUseAllowed: false, note: '主动脉窦' },
  {
    task: 'brain_aneurysm',
    license: 'CC BY-NC 4.0',
    commercialUseAllowed: false,
    note: '上游明确标注 CC BY-NC 4.0 且**不提供商业许可**；仅 TOF MRI 图像可用',
  },
];

/**
 * 完整许可登记表（46 个 task）。
 *
 * key 为 task 名，value 为许可信息。用于：
 *   1. 判定某 task 是否可商用（白名单校验）
 *   2. 在 40003 拒绝响应里回显被拒 task 的**真实许可协议**，
 *      供 UIUX-P2 §4.3 的拒绝态展示（「请求模型 + 许可协议 + 错误码 + 可用模型下拉」）
 */
export const MODEL_LICENSE_REGISTRY: ReadonlyMap<string, ModelLicenseEntry> = new Map<
  string,
  ModelLicenseEntry
>([
  ...APACHE_2_0_TASKS.map(
    (task): [string, ModelLicenseEntry] => [
      task,
      {
        task,
        license: 'Apache-2.0',
        commercialUseAllowed: true,
        note: '上游标注 Openly available for any usage (Apache-2.0 license)',
      },
    ]
  ),
  ...LICENSED_TASKS.map(
    (entry): [string, ModelLicenseEntry] => [entry.task, entry]
  ),
]);

/**
 * 契约对外暴露的模型枚举（4 个）。
 *
 * 与 openapi.yaml `SegmentationModel` 枚举逐项一致。
 * 契约只暴露 MVP 需要的 4 个；其余 27 个 Apache-2.0 task 虽许可可用，
 * 但尚未接入本系统的分割流水线与结果映射，因此**不接受提交**
 * （AC-09 的白名单是「许可 + 已接入」双重条件）。
 */
export const API_EXPOSED_MODELS = ['total', 'total_mr', 'liver_segments', 'lung_vessels'] as const;

export type ApiExposedModel = (typeof API_EXPOSED_MODELS)[number];

/** 契约枚举值集合（供校验器使用） */
export const API_EXPOSED_MODEL_SET: ReadonlySet<string> = new Set(API_EXPOSED_MODELS);

/**
 * 可提交任务的完整集合 = 契约枚举 ∩ Apache-2.0 白名单。
 *
 * 用集合交集而非单一列表，是为了让「许可白名单」与「契约枚举」两处约束
 * 在代码里显式汇合：任何人只改其中一处，集合差集会立刻暴露问题。
 */
export const SUBMITTABLE_MODELS: ReadonlySet<string> = new Set(
  API_EXPOSED_MODELS.filter((task) => {
    const entry = MODEL_LICENSE_REGISTRY.get(task);
    return entry?.commercialUseAllowed === true && entry.license === 'Apache-2.0';
  })
);

/**
 * 判定某 task 是否允许提交。
 *
 * @param task 客户端提交的模型 task 名
 */
export function isSubmittableModel(task: string): boolean {
  return SUBMITTABLE_MODELS.has(task);
}

/**
 * 取某 task 的许可信息。未知 task 返回 undefined（调用方按 40003 拒绝）。
 */
export function lookupLicense(task: string): ModelLicenseEntry | undefined {
  return MODEL_LICENSE_REGISTRY.get(task);
}

/**
 * 启动期强校验（AC-09）。
 *
 * 三项断言，任一不成立即**拒绝启动**：
 *   1. 契约枚举的每个 task 都必须在许可登记表里（否则法务未确认许可）
 *   2. 契约枚举的每个 task 都必须是 Apache-2.0 且允许商用
 *   3. 许可登记表的 task 总数与上游一致（46 = 31 + 15），
 *      数量对不上说明本文件与上游版本脱节，必须重新核对
 *
 * 「启动时拒绝」比「运行时拒绝」强得多：前者让不合规的依赖根本进不了生产。
 */
export function assertModelLicenseIntegrity(): void {
  const expectedTotal = APACHE_2_0_TASKS.length + LICENSED_TASKS.length;
  if (MODEL_LICENSE_REGISTRY.size !== expectedTotal) {
    throw new Error(
      `模型许可登记表不完整：期望 ${expectedTotal} 个 task，实际 ${MODEL_LICENSE_REGISTRY.size} 个。` +
        '请对照上游 README 重新核对 model-license-whitelist.ts。'
    );
  }
  for (const task of API_EXPOSED_MODELS) {
    const entry = MODEL_LICENSE_REGISTRY.get(task);
    if (!entry) {
      throw new Error(`模型 ${task} 不在许可登记表中：新增 task 须先经法务确认许可。`);
    }
    if (entry.license !== 'Apache-2.0' || !entry.commercialUseAllowed) {
      throw new Error(`模型 ${task} 的许可为 ${entry.license}，不允许商用，拒绝启动。`);
    }
  }
  // brain_aneurysm 是最典型的陷阱，显式断言它绝不在可提交集合内
  if (SUBMITTABLE_MODELS.has('brain_aneurysm')) {
    throw new Error('brain_aneurysm 为 CC BY-NC 4.0 且不提供商业许可，绝不可进入可提交集合。');
  }
}
