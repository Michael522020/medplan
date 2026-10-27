/**
 * API 客户端。
 *
 * ## 业务分支一律看 `code`，不看 HTTP 状态码
 *
 * openapi.yaml §1 明确：所有端点（成功与失败）返回同一结构
 * `{ code, message, data }`。HTTP 409 在本系统有三种完全不同的语义
 * （20003 乐观锁冲突 / 50003 报告已签名 / 50004 已归档），
 * 仅凭状态码无法区分。因此本客户端**始终**解析响应体并以 `code` 分支，
 * HTTP 状态码只用于「响应体不是合法 JSON」这种传输层故障的兜底。
 *
 * ## 越权与不存在不可区分
 *
 * openapi.yaml §4.1：PHI 可导航路径上 10004（越权）与 10005（不存在）
 * 必须返回完全一致的状态码、message 字面量与响应体大小。
 * 本客户端**不会**为它们生成不同的错误文案 —— UI 层拿到的是同一个
 * 错误码，走同一条渲染路径，从机制上杜绝「是否存在」的信息泄露。
 */

import { ERROR_CODES, type ErrorCode } from '@medplan/contracts';

/** 契约里的统一响应包裹。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  traceId?: string;
}

/** 业务错误。UI 层依据 `code` 分支，不依据 HTTP 状态码。 */
export class ApiError extends Error {
  readonly code: number;
  readonly traceId: string | undefined;

  constructor(code: number, message: string, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
  }

  /**
   * 是否为「越权 / 不存在」的不可区分错误。
   *
   * UI 层对这个错误**必须**显示统一文案（UIUX.md §9.9），
   * 绝不能出现「该患者不存在」或「您无权访问该患者」。
   */
  get isScopeHidden(): boolean {
    return (
      this.code === ERROR_CODES.FORBIDDEN_DATA ||
      this.code === ERROR_CODES.NOT_FOUND
    );
  }

  /** 是否为未认证。会话失效时应跳回登录页。 */
  get isUnauthenticated(): boolean {
    return this.code === ERROR_CODES.UNAUTHENTICATED;
  }
}

/** 令牌读取器。 */
export type TokenReader = () => string | null;

/** 令牌读取器，由会话层注入。 */
let readToken: TokenReader = () => null;

/** 设置令牌读取器。 */
export function setTokenReader(reader: TokenReader): void {
  readToken = reader;
}

/**
 * 读取当前访问令牌。
 *
 * 供**非 API 通道**的认证注入使用 —— 目前只有 WADO-RS 取图
 * （阅片区的 `beforeSend` 钩子）。它与普通 API 请求走的是同一个
 * 令牌来源，因此登录/登出后两边同时生效，不存在「API 已登录但
 * 取图未带令牌」的不一致态。
 */
export function getAccessToken(): string | null {
  return readToken();
}

/** 请求选项。 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** 幂等键。幂等端点必填。 */
  idempotencyKey?: string;
  /** 额外的请求头。 */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** 传输层故障（网络中断、响应体非法）。与业务错误区分开。 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/** 发起一次 API 请求并解析契约包裹。 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, idempotencyKey, headers = {}, signal } = options;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  const token = readToken();
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  if (idempotencyKey) {
    requestHeaders['Idempotency-Key'] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: requestHeaders,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new TransportError('网络连接失败，请检查院内网络与 PACS 链路');
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // 响应体不是 JSON：网关错误页或代理超时。
    throw new TransportError(
      `服务返回了非预期内容（HTTP ${response.status}），请稍后重试或联系信息科`,
    );
  }

  if (envelope.code !== 0) {
    throw new ApiError(envelope.code, envelope.message, envelope.traceId);
  }

  return envelope.data;
}

/** 已知错误码的窄化类型，便于 UI 精确分支。 */
export type KnownErrorCode = ErrorCode;
