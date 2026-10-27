/**
 * 契约有效性验证：证明 openapi.yaml 生成的类型在**编译期**强制合规边界。
 *
 * 这不是运行时测试，而是用 @ts-expect-error 做「负向断言」：
 * 如果哪天有人往契约里加了 nature 字段，或把 authoredBy 改成可选，
 * 下面这些 @ts-expect-error 会变成「未被使用」而使 tsc 报错 —— 合规边界被静默削弱时，
 * CI 会立刻发现。
 *
 * 运行：npx tsc --noEmit --strict verify-types.ts
 */
import type { components, paths } from './packages/contracts/src/generated/api-types';

type SegmentationStructure = components['schemas']['SegmentationStructure'];
type SignedImpression = components['schemas']['SignedImpression'];
type AiAssist = components['schemas']['AiAssist'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/* 负向断言 1：AI 结构不得承载结论性字段。
   additionalProperties:false 使多余属性在对象字面量赋值时直接报错。*/
const s: SegmentationStructure = {
  structureName: 'liver',
  structureLabelZh: '肝脏',
  volumeMl: 1428.6,
  confirmed: false,
};
// @ts-expect-error AI 输出不得含 nature（病灶性质判定违反医疗安全底线）
const withNature: SegmentationStructure = { ...s, nature: 'benign' };
// @ts-expect-error AI 输出不得含 malignancy（良恶性判定）
const withMalignancy: SegmentationStructure = { ...s, malignancy: 0.8 };
// @ts-expect-error AI 输出不得含 impression（诊断意见必须执业医师署名）
const withImpression: SegmentationStructure = { ...s, impression: '肝占位' };

/* 负向断言 2：诊断意见必须执业医师署名 */
const imp: SignedImpression = {
  text: '肝右叶占位性病变，性质待定（建议穿刺活检）。',
  authoredBy: {
    userId: 'u-1-0a82f1a9',
    nameMasked: '周*',
    title: '主任医师',
    department: '医学影像科',
  },
};
// @ts-expect-error authoredBy 为必填，无AI 作者分支
const noAuthor: SignedImpression = { text: '肝右叶占位性病变' };

/* 负向断言 3：AI 参与声明不可省略（PRD COM-08）
   直接对 StructuredFields 做字面量赋值，aiAssist 缺失应报错 */
type StructuredFields = components['schemas']['StructuredFields'];
// @ts-expect-error aiAssist 为必填：AI 参与声明不得从报告中省略
const fieldsWithoutAi: StructuredFields = {
  examBodyPart: '上腹部',
  scanMode: '腹部平扫+三期增强CT',
  findings: [
    {
      key: 'portal',
      label: '门脉期',
      text: '肝右叶后段约 2.3×1.8cm 类圆形低密度影，边界较清，增强后动脉期不强化，延迟期轻度强化。',
      authoredBy: {
        userId: 'u-1-0a82f1a9',
        nameMasked: '周*',
        title: '主任医师',
        department: '医学影像科',
      },
    },
  ],
  impression: imp,
  followUpRecommendation: {
    text: '建议 3 个月后复查肝脏增强 MRI 或 CT 平扫+三期增强，对比病灶大小与强化特征变化。',
    authoredBy: {
      userId: 'u-1-0a82f1a9',
      nameMasked: '周*',
      title: '主任医师',
      department: '医学影像科',
    },
  },
};

/* 负向断言 4：plans PUT 必须带 version（乐观锁，冲突返 409） */
type UpdatePlanBody = paths['/api/v1/plans/{planId}']['put']['requestBody']['content']['application/json'];
// @ts-expect-error version 必填，否则乐观锁失效
const noVersion: UpdatePlanBody = {
  title: '肝右叶后段病灶楔形切除入路规划（修订）',
};

/* 依赖 1（安全）负向断言：锁定标志由服务端下发，前端不得推断。
   若有人把 lockState 从 required 移除、或改成可选，下面的断言会失效而使 tsc 报错。 */
type ReportData = paths['/api/v1/reports/{reportId}']['get']['responses']['200']['content']['application/json']['data'];
declare const anyReport: Omit<ReportData, 'lockState'> & { lockState: ReportData['lockState'] };
// 锁定态报告可正常构造（正向）
const lockedReport = {
  ...anyReport,
  lockState: {
    state: 'SIGNED',
    editable: false,
    reason: 'SIGNED_LOCKED',
    signatureValid: true,
    lockedAt: '2026-10-22T11:56:30+08:00',
    lockedScope: ['report_body', 'plan_payload'],
  },
} satisfies ReportData;
declare const aState: ReportData['lockState'];
// @ts-expect-error editable 为必填布尔，前端直接据此禁用编辑控件，不自行推导
const lockNoEditable = { state: 'SIGNED', reason: 'SIGNED_LOCKED', signatureValid: true } satisfies typeof aState;
// @ts-expect-error signatureValid 必填（签名失效检测，AC-14 篡改信号）
const lockNoSigValid = { state: 'SIGNED', editable: false, reason: 'SIGNED_LOCKED' } satisfies typeof aState;
// @ts-expect-error state 枚举不含 UNKNOWN/EDITABLE 等自造值，锁定态只能由服务端判定
const lockBadState = { state: 'UNKNOWN', editable: true, reason: 'NOT_SIGNED_YET', signatureValid: false } satisfies typeof aState;

/* 依赖 2（安全）负向断言：确认请求体不得含确认人/确认时间。
   注意：@ts-expect-error 必须紧贴产生错误的那一行（对象字面量的多余属性行）。 */
type ConfirmBody = paths['/api/v1/segmentation-tasks/{taskId}/confirm']['post']['requestBody']['content']['application/json'];
const confirmWithAuthor: NonNullable<ConfirmBody> = {
  items: [
    {
      structureName: 'liver',
      action: 'confirmed',
      // @ts-expect-error 请求体不含 confirmedBy —— 确认人由服务端从会话取，前端传即代签
      confirmedBy: 'u-1-0a82f1a9',
    },
  ],
};
const confirmWithTime: NonNullable<ConfirmBody> = {
  items: [
    {
      structureName: 'liver',
      action: 'confirmed',
      // @ts-expect-error 请求体不含 confirmedAt —— 确认时间必须服务端权威时间，不可伪造
      confirmedAt: '2026-10-22T10:58:36+08:00',
    },
  ],
};
// 正向：合法确认请求只需结构名 + 动作
const validConfirm: NonNullable<ConfirmBody> = {
  items: [{ structureName: 'liver', action: 'confirmed' }],
};

/* 依赖 4：派生值由服务端下发，前端不重算。 */
type StudyItem = components['schemas']['StudyListItem'];
declare const someStudy: StudyItem;
const studyRow = { ...someStudy, readStatus: 'in_progress', isEmergency: false, queueWaitSeconds: 18720 } satisfies StudyItem;
// @ts-expect-error readStatus 枚举不含自造值
const badReadStatus = { ...someStudy, readStatus: 'done' } satisfies StudyItem;

/* 断言 5：规划 payload 按 ADR-004 保持松散，允许科室自定义几何扩展键。
   骨科场景（screws[]）必须能通过 —— 设计师的规划页按科室场景定义结构，
   后端只存储不解析语义。
   注意：这不是「AI 合规边界被放开」—— 结论性字段的禁止由应用层 zod 白名单校验，
   契约层以 description + lint 断言固化该要求。 */
type PlanPayload = components['schemas']['PlanPayload'];
const hepaticPayload: PlanPayload = {
  entry: { patientXYZmm: [-62.4, 118.7, -34.2], orientation: 'posterolateral_right' },
  target: { patientXYZmm: [-28.1, 86.3, -12.5], structureName: 'liver_right_lobe' },
  approachAngleDeg: 32.5,
  avoidanceStructures: ['portal_vein', 'inferior_vena_cava'],
};
const orthopedicPayload: PlanPayload = {
  entry: { patientXYZmm: [12.4, -88.7, 34.2], label: 'L1 入钉点' },
  target: { patientXYZmm: [28.1, -86.3, 12.5], structureName: 'spine' },
  entry_points: [{ patientXYZmm: [12.4, -88.7, 34.2] }],
  screws: [{ diameterMm: 6.5, lengthMm: 45, angleDeg: 12 }],
  path: [{ patientXYZmm: [20.0, -87.0, 22.0] }],
  measurements: [{ label: '椎弓根间距', valueMm: 28.4 }],
};

/* 正向断言：12 端点与关键响应码在类型层可见 */
type Studies200 = paths['/api/v1/studies']['get']['responses']['200'];
type Series200 = paths['/api/v1/studies/{studyUid}/series']['get']['responses']['200'];
type SegPost201 = paths['/api/v1/segmentation-tasks']['post']['responses']['201'];
type SegPost200 = paths['/api/v1/segmentation-tasks']['post']['responses']['200'];
type PlanPut409 = paths['/api/v1/plans/{planId}']['put']['responses']['409'];
type SignPost400 = paths['/api/v1/reports/{reportId}/sign']['post']['responses']['400'];
type Audit200 = paths['/api/v1/audit-logs']['get']['responses']['200'];

const err: ErrorResponse = { code: 10004, message: '请求的资源不可用', traceId: '01JB' };

export {
  s, withNature, withMalignancy, withImpression,
  imp, noAuthor, fieldsWithoutAi,
  noVersion, hepaticPayload, orthopedicPayload, err,
  lockedReport, lockNoEditable, lockNoSigValid, lockBadState,
  confirmWithAuthor, confirmWithTime, validConfirm,
  studyRow, badReadStatus,
};
export type { Studies200, Series200, SegPost201, SegPost200, PlanPut409, SignPost400, Audit200 };
