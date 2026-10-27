/**
 * MedPlan 领域服务。
 *
 * 所有端点路径、请求体形状、响应类型都直接取自 `docs/openapi.yaml`
 * （经 `npm run gen:types` 生成到 `@medplan/contracts`）。
 * 这里**不重新定义任何接口形状** —— 手写重复类型会让契约与实现漂移，
 * 而漂移在 TypeScript 里是静默的。
 */

import type { components } from '@medplan/contracts';

import { request } from './api-client';

/** 登录请求体。注意 `ukey_cert` / `ukey_pin_block` 是 snake_case（契约如此）。 */
export type LoginRequest = components['schemas']['LoginRequest'];

/** 登录响应数据。 */
export type LoginData = components['schemas']['LoginResponse']['data'];

/** 检查列表条目。 */
export type StudyListItem = components['schemas']['StudyListItem'];

/** 检查列表响应数据。 */
export type StudyListData = components['schemas']['StudyListResponse']['data'];

/** 序列分组响应数据。 */
export type SeriesGroupedData = components['schemas']['SeriesGroupedResponse']['data'];

/** 报告响应数据。 */
export type ReportData = components['schemas']['ReportResponse']['data'];

/** 报告签名请求体。 */
export type SignReportRequest = components['schemas']['SignReportRequest'];

/** 报告签名响应数据。 */
export type SignReportData = components['schemas']['SignReportResponse']['data'];

/** 检查列表查询参数。 */
export interface StudyQuery {
  page?: number;
  limit?: number;
  status?: string;
  sort?: string;
}

/** 双因素登录。 */
export function login(payload: LoginRequest): Promise<LoginData> {
  return request<LoginData>('/api/v1/auth/login', {
    method: 'POST',
    body: payload,
  });
}

/** 拉取当前用户有权访问的检查列表。 */
export function listStudies(query: StudyQuery = {}): Promise<StudyListData> {
  const params = new URLSearchParams();
  if (query.page !== undefined) {
    params.set('page', String(query.page));
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.status !== undefined) {
    params.set('status', query.status);
  }
  if (query.sort !== undefined) {
    params.set('sort', query.sort);
  }
  const suffix = params.toString();
  return request<StudyListData>(
    `/api/v1/studies${suffix ? `?${suffix}` : ''}`,
  );
}

/** 拉取某检查的序列列表（已按期相自动分组）。 */
export function listSeries(studyUid: string): Promise<SeriesGroupedData> {
  return request<SeriesGroupedData>(
    `/api/v1/studies/${encodeURIComponent(studyUid)}/series`,
  );
}

/** 拉取结构化报告。 */
export function getReport(reportId: string): Promise<ReportData> {
  return request<ReportData>(
    `/api/v1/reports/${encodeURIComponent(reportId)}`,
  );
}

/** 提交电子签名。幂等端点，必须带 Idempotency-Key。 */
export function signReport(
  reportId: string,
  payload: SignReportRequest,
  idempotencyKey: string,
): Promise<SignReportData> {
  return request<SignReportData>(
    `/api/v1/reports/${encodeURIComponent(reportId)}/sign`,
    {
      method: 'POST',
      body: payload,
      idempotencyKey,
    },
  );
}

/** 生成幂等键。签名与提交任务等幂等端点需要。 */
export function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成签名 nonce。
 *
 * 契约要求 `^[0-9a-f]{32}$`，且每次签名唯一（防重放）。
 * 32 个十六进制字符 = 16 字节 = 128 位熵，满足契约格式。
 */
export function createSignatureNonce(): string {
  return createIdempotencyKey();
}
