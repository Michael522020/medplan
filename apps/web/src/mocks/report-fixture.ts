/**
 * 开发期 Mock 的报告数据。
 *
 * 单独成文件的原因：报告是契约里最复杂的结构（受控字段 + AI 分组 +
 * 锁定状态 + 修订历史），与检查列表、序列分组的关注点不同。
 * 混在一个文件里会让「加一个报告字段」变成要翻一个 400 行的文件。
 *
 * 数据取自 openapi.yaml 的 examples，字段名与契约完全一致。
 * 患者姓名一律掩码，本仓库将公开，不放任何真实患者数据。
 */

import type { ReportData } from '@/services/medplan-service';

import { DEMO_STUDY_UID } from './fixtures';

/** 演示用的报告 id（占位）。 */
export const DEMO_REPORT_ID = 'r-demo-0001';

/** 报告。 */
export const mockReport: ReportData = {
  reportId: DEMO_REPORT_ID,
  studyUid: DEMO_STUDY_UID,
  version: 1,
  status: 'draft',
  lockState: {
    state: 'DRAFT',
    editable: true,
    reason: 'NOT_SIGNED_YET',
    signatureValid: false,
    lockedAt: null,
    lockedScope: [],
  },
  templateCode: 'abdomen_liver_ct_v3',
  patient: {
    patientId: 'EMPI0000000001',
    nameMasked: '张*明',
    gender: 'M',
    birthDate: '1968-03-14',
    ageYears: 58,
    idCardMasked: '000***********0001',
  },
  visit: {
    visitId: 'v-demo-0001',
    visitNo: 'MZ00000001',
    visitType: 'outpatient',
    dept: '医学影像科',
    wardDept: null,
    bedNo: null,
    admitDate: '2026-01-01T09:48:00+08:00',
  },
  study: {
    accessionNo: 'ACC00000001',
    modality: 'CT',
    bodyPart: 'ABDOMEN',
    studyDescription: '腹部平扫+三期增强',
    studyDate: '2026-01-01T10:03:36+08:00',
  },
  structuredFields: {
    examBodyPart: '上腹部',
    scanMode: '腹部平扫+三期增强CT',
    findings: [
      {
        key: 'plain',
        label: '平扫',
        windowType: 'abdominal_soft',
        text: '肝右叶后段见约 2.3×1.8cm 类圆形低密度影，边界较清，CT 值约 34HU；肝实质未见弥漫性密度减低。',
        authoredBy: {
          userId: 'u-demo-0001',
          nameMasked: '周*',
          title: '主任医师',
          department: '医学影像科',
        },
      },
      {
        key: 'portal',
        label: '门脉期',
        windowType: 'abdominal_soft',
        text: '肝右叶后段约 2.3×1.8cm 类圆形低密度影，边界较清，增强后动脉期不强化，延迟期轻度强化；门静脉主干及左右分支通畅，肝内血管走行未见异常。',
        authoredBy: {
          userId: 'u-demo-0001',
          nameMasked: '周*',
          title: '主任医师',
          department: '医学影像科',
        },
      },
    ],
    impression: {
      text: '肝右叶占位性病变，性质待定（建议穿刺活检）。',
      authoredBy: {
        userId: 'u-demo-0001',
        nameMasked: '周*',
        title: '主任医师',
        department: '医学影像科',
      },
    },
    followUpRecommendation: {
      text: '建议 3 个月后复查肝脏增强 MRI 或 CT 平扫+三期增强，对比病灶大小与强化特征变化；穿刺活检结果回报后再行评估。',
      authoredBy: {
        userId: 'u-demo-0001',
        nameMasked: '周*',
        title: '主任医师',
        department: '医学影像科',
      },
    },
    aiAssist: {
      disclosure: '本结果为 AI 辅助标记，不构成诊断结论，须经执业医师确认',
      modelName: 'total',
      modelVersion: '2.18.0',
      degraded: false,
      segmentationTaskId: 'seg-demo-0001',
      allItemsConfirmed: false,
      referencedStructures: [
        {
          structureName: 'liver',
          structureLabelZh: '肝脏',
          volumeMl: 1428.6,
          confirmAction: 'confirmed',
          confirmedByMasked: '周*',
          confirmedAt: '2026-01-01T10:58:36+08:00',
        },
        {
          structureName: 'gallbladder',
          structureLabelZh: '胆囊',
          volumeMl: 26.4,
          confirmAction: 'modified',
          confirmedByMasked: '周*',
          confirmedAt: '2026-01-01T10:58:36+08:00',
        },
      ],
    },
  },
  author: {
    userId: 'u-demo-0001',
    nameMasked: '周*',
    title: '主任医师',
    department: '医学影像科',
  },
  reviewer: null,
  reportTime: '2026-01-01T11:41:05+08:00',
  bodyDigestAlgorithm: 'SM3',
  bodyDigest: '7f3a9c1e5b2d8409c9e3f7a1b6d2048e9c5f3a7b1d6e2c94',
  bodySha256:
    '3a7d5b1e9c2f48096a3f1c8e7d5b2a40c9e3f7a1b6d2048e9c5f3a7b1d6e2c94',
  signature: null,
  revisionHistory: [
    {
      version: 1,
      editedByMasked: '周*',
      editedAt: '2026-01-01T11:41:05+08:00',
      changeSummary: '创建报告草稿，录入平扫与三期增强所见',
    },
  ],
  createdAt: '2026-01-01T11:38:20+08:00',
  updatedAt: '2026-01-01T11:41:05+08:00',
};
