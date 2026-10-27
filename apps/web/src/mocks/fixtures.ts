/**
 * 开发期 Mock 数据。
 *
 * ## 为什么不用 MSW
 *
 * 项目依赖是锁定的（Spec §4），离线环境不允许 `npm install`，
 * 因此 MSW 无法引入。本模块用**最小自实现**达到同样的目的：
 * 在开发模式下拦截 `fetch`，对 `/api/v1/*` 返回契约形状的响应。
 *
 * 拦截只做「按路径返回固定响应」，不引入 Service Worker、不做路由匹配引擎 ——
 * 这些能力 MSW 提供，但当前只需要四条端点。
 *
 * ## 数据的来源
 *
 * 全部取自 `docs/openapi.yaml` 的 examples，字段名与契约**完全一致**。
 * 因此 Mock 模式下前端走的仍是契约代码路径 —— Mock 换掉的是数据源，
 * 不是类型。契约变更时 Mock 必须同步改，否则 Mock 模式会掩盖类型错误。
 *
 * ## 隐私
 *
 * 患者姓名一律掩码（张*明），检查号为占位符。
 * 本仓库将公开，因此这里不放任何真实患者数据。
 */

import type {
  LoginData,
  SeriesGroupedData,
  StudyListData,
} from '@/services/medplan-service';

/** 演示用的检查 uid（占位，非真实 DICOM UID）。 */
export const DEMO_STUDY_UID = '1.2.840.10008.5.1.4.1.1.2.99990001';

/** 演示用的报告 id（占位）。 */
export const DEMO_REPORT_ID = 'r-demo-0001';

/** 登录响应。 */
export const mockLogin: LoginData = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  tokenType: 'Bearer',
  expiresIn: 28800,
  ntpOffsetMs: 42,
  user: {
    userId: 'u-demo-0001',
    loginName: 'dr.demo',
    displayName: '示例医师',
    title: '主任医师',
    department: '医学影像科',
    licenseNoMasked: '110***********0000',
    roles: ['image_chief'],
  },
  ukey: {
    certSerial: '00000000000000000000000000000000',
    subjectName: 'CN=示例医师, OU=医学影像科, C=CN',
    issuerName: 'CN=示例机构数字证书颁发机构, C=CN',
    validFrom: '2025-01-01T00:00:00+08:00',
    validTo: '2028-01-01T00:00:00+08:00',
    signatureAlgorithm: 'SM2',
  },
};

/** 检查列表。 */
export const mockStudyList: StudyListData = {
  total: 3,
  page: 1,
  limit: 50,
  hasMore: false,
  items: [
    {
      studyUid: DEMO_STUDY_UID,
      accessionNo: 'ACC00000001',
      modality: 'CT',
      bodyPart: 'LIVER',
      studyDescription: '腹部平扫+三期增强',
      studyDate: '2026-01-01T10:03:36+08:00',
      status: 'completed',
      seriesCount: 4,
      readStatus: 'unread',
      readAt: null,
      isEmergency: false,
      queueWaitSeconds: 18720,
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
      },
      reportId: DEMO_REPORT_ID,
      hasSignedReport: false,
      createdAt: '2026-01-01T10:05:12+08:00',
      updatedAt: '2026-01-01T10:05:12+08:00',
    },
    {
      studyUid: '1.2.840.10008.5.1.4.1.1.2.99990002',
      accessionNo: 'ACC00000002',
      modality: 'MR',
      bodyPart: 'LIVER',
      studyDescription: '肝脏MRI 平扫+DWI',
      studyDate: '2026-01-01T11:47:02+08:00',
      status: 'completed',
      seriesCount: 6,
      readStatus: 'in_progress',
      readAt: '2026-01-01T12:03:19+08:00',
      isEmergency: true,
      queueWaitSeconds: 9797,
      patient: {
        patientId: 'EMPI0000000002',
        nameMasked: '李*华',
        gender: 'F',
        birthDate: '1955-11-02',
        ageYears: 70,
        idCardMasked: '000***********0002',
      },
      visit: {
        visitId: 'v-demo-0002',
        visitNo: 'ZY00000002',
        visitType: 'inpatient',
        dept: '消化内科',
        wardDept: '消化内科病区',
        bedNo: '12-3',
      },
      reportId: null,
      hasSignedReport: false,
      createdAt: '2026-01-01T11:52:30+08:00',
      updatedAt: '2026-01-01T12:03:19+08:00',
    },
    {
      studyUid: '1.2.840.10008.5.1.4.1.1.2.99990003',
      accessionNo: 'ACC00000003',
      modality: 'CT',
      bodyPart: 'CHEST',
      studyDescription: '胸部CT 平扫',
      studyDate: '2026-01-01T09:12:00+08:00',
      status: 'completed',
      seriesCount: 2,
      readStatus: 'read',
      readAt: '2026-01-01T09:48:22+08:00',
      isEmergency: false,
      queueWaitSeconds: 3600,
      patient: {
        patientId: 'EMPI0000000003',
        nameMasked: '王*强',
        gender: 'M',
        birthDate: '1972-06-30',
        ageYears: 54,
        idCardMasked: '000***********0003',
      },
      visit: {
        visitId: 'v-demo-0003',
        visitNo: 'MZ00000003',
        visitType: 'outpatient',
        dept: '医学影像科',
        wardDept: null,
        bedNo: null,
      },
      reportId: null,
      hasSignedReport: true,
      createdAt: '2026-01-01T09:20:00+08:00',
      updatedAt: '2026-01-01T09:48:22+08:00',
    },
  ],
};

/** 序列分组（含四期相 + 一个期相未识别组，用于验证阈值行为）。 */
export const mockSeriesGrouped: SeriesGroupedData = {
  studyUid: DEMO_STUDY_UID,
  accessionNo: 'ACC00000001',
  modality: 'CT',
  studyDescription: '腹部平扫+三期增强',
  totalSeries: 5,
  totalInstances: 1042,
  phaseGroups: [
    {
      phase: 'plain',
      phaseLabel: '平扫',
      confidence: 0.97,
      series: [
        {
          seriesUid: `${DEMO_STUDY_UID}.1`,
          seriesNumber: 1,
          description: 'Axial 5.0mm',
          instanceCount: 148,
          sliceThicknessMm: 5.0,
          rows: 512,
          columns: 512,
          pixelSpacingMm: [0.703, 0.703],
          transferSyntaxUid: '1.2.840.10008.1.2.4.90',
          windowCenter: 40,
          windowWidth: 400,
          isDefaultWindow: true,
        },
      ],
    },
    {
      phase: 'arterial',
      phaseLabel: '动脉期',
      confidence: 0.94,
      series: [
        {
          seriesUid: `${DEMO_STUDY_UID}.2`,
          seriesNumber: 2,
          description: 'Axial 0.5mm 动脉期',
          instanceCount: 306,
          sliceThicknessMm: 0.5,
          rows: 512,
          columns: 512,
          pixelSpacingMm: [0.351, 0.351],
          transferSyntaxUid: '1.2.840.10008.1.2.4.90',
          windowCenter: 120,
          windowWidth: 350,
          isDefaultWindow: true,
        },
      ],
    },
    {
      phase: 'portal',
      phaseLabel: '门脉期',
      confidence: 0.96,
      series: [
        {
          seriesUid: `${DEMO_STUDY_UID}.3`,
          seriesNumber: 3,
          description: 'Axial 0.5mm 门静脉期',
          instanceCount: 306,
          sliceThicknessMm: 0.5,
          rows: 512,
          columns: 512,
          pixelSpacingMm: [0.351, 0.351],
          transferSyntaxUid: '1.2.840.10008.1.2.4.90',
          windowCenter: 100,
          windowWidth: 350,
          isDefaultWindow: false,
        },
      ],
    },
    {
      phase: 'delayed',
      phaseLabel: '延迟期',
      confidence: 0.91,
      series: [
        {
          seriesUid: `${DEMO_STUDY_UID}.4`,
          seriesNumber: 4,
          description: 'Axial 0.5mm 延迟期',
          instanceCount: 282,
          sliceThicknessMm: 0.5,
          rows: 512,
          columns: 512,
          pixelSpacingMm: [0.351, 0.351],
          transferSyntaxUid: '1.2.840.10008.1.2.4.90',
          windowCenter: 60,
          windowWidth: 350,
          isDefaultWindow: false,
        },
      ],
    },
    {
      /**
       * 置信度低于 0.70 —— 用于验证「期相待人工确认」的 UI 行为：
       * 该组不得默认选中，组头显示琥珀色提示。
       */
      phase: 'unknown',
      phaseLabel: '期相待确认',
      confidence: 0.62,
      series: [
        {
          seriesUid: `${DEMO_STUDY_UID}.5`,
          seriesNumber: 5,
          description: 'Axial 1.0mm 增强序列（期相未识别）',
          instanceCount: 120,
          sliceThicknessMm: 1.0,
          rows: 512,
          columns: 512,
          pixelSpacingMm: [0.586, 0.586],
          transferSyntaxUid: '1.2.840.10008.1.2.4.90',
          windowCenter: 40,
          windowWidth: 400,
          isDefaultWindow: false,
        },
      ],
    },
  ],
};
