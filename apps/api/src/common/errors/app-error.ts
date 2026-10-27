import {
  ERROR_CODES,
  httpStatusFor,
  INDISTINGUISHABLE_BODY,
  INDISTINGUISHABLE_CODE,
  INDISTINGUISHABLE_MESSAGE,
  NOT_FOUND_MESSAGE,
  type ErrorCode,
} from './error-codes.js';

/**
 * 业务异常。
 *
 * 与 HTTP 状态码解耦：错误码是业务语义（10004 等），HTTP 状态是传输语义。
 * 契约里 10004 与 10005 都映射到 HTTP 404 —— 因为要让「越权」与「不存在」
 * 在传输层也完全一致。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus?: number, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus ?? httpStatusFor(code);
    this.detail = detail;
  }

  /**
   * 越权 / 资源不可用的统一异常。
   *
   * **必须**用这个工厂方法，不要自己 new AppError(10004, '患者不存在')
   * —— 消息里带任何可区分的信息都会泄露患者存在性。
   */
  static inaccessible(): AppError {
    return new AppError(
      INDISTINGUISHABLE_CODE,
      INDISTINGUISHABLE_MESSAGE,
      httpStatusFor(INDISTINGUISHABLE_CODE),
      undefined
    );
  }

  static unauthorized(message = '请先登录'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, message, httpStatusFor(ERROR_CODES.UNAUTHENTICATED));
  }

  static forbiddenRole(reason = '当前角色无权执行该操作'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN_ROLE, reason, httpStatusFor(ERROR_CODES.FORBIDDEN_ROLE));
  }

  static paramInvalid(message: string, detail?: unknown): AppError {
    return new AppError(ERROR_CODES.PARAM_INVALID, message, httpStatusFor(ERROR_CODES.PARAM_INVALID), detail);
  }

  /**
   * 仅用于**非 PHI 导航**资源（主键 UUID v7，不可枚举）。
   *
   * message 与 10004 完全一致、data 恒为 null —— 这样 10004 与 10005 的
   * 响应体**字节数相同**、HTTP 状态码相同，攻击者无法用 Content-Length
   * 或状态码区分「无权」与「不存在」。
   */
  static notFound(): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, NOT_FOUND_MESSAGE, httpStatusFor(ERROR_CODES.NOT_FOUND), undefined);
  }

  static modelLicenseRejected(detail: {
    requestedModel: string;
    requestedLicense: string;
    rejectionReason: string;
    allowedModels: string[];
    auditRecorded: boolean;
    auditEventType: string;
  }): AppError {
    return new AppError(
      ERROR_CODES.MODEL_LICENSE_REJECTED,
      '所请求的 AI 模型不在可商用许可白名单内',
      httpStatusFor(ERROR_CODES.MODEL_LICENSE_REJECTED),
      detail
    );
  }

  static planVersionConflict(current: number, extra?: {
    conflictingEditorId?: string;
    conflictingEditorMasked?: string;
    updatedAt?: string;
  }): AppError {
    return new AppError(
      ERROR_CODES.PLAN_VERSION_CONFLICT,
      '规划方案已被他人修改，请刷新后重试',
      httpStatusFor(ERROR_CODES.PLAN_VERSION_CONFLICT),
      { currentVersion: current, ...extra }
    );
  }

  static reportSignedLocked(): AppError {
    return new AppError(
      ERROR_CODES.REPORT_SIGNED_LOCKED,
      '报告已签名锁定，不可修改',
      httpStatusFor(ERROR_CODES.REPORT_SIGNED_LOCKED)
    );
  }

  static reportArchived(): AppError {
    return new AppError(
      ERROR_CODES.REPORT_ARCHIVED,
      '报告已归档，修改需医务部门批准',
      httpStatusFor(ERROR_CODES.REPORT_ARCHIVED)
    );
  }

  static reportNotReviewed(): AppError {
    return new AppError(
      ERROR_CODES.REPORT_NOT_REVIEWED,
      '报告尚未通过上级医师审核，不可签名',
      httpStatusFor(ERROR_CODES.REPORT_NOT_REVIEWED)
    );
  }

  static preconditionNotMet(message: string, detail?: unknown): AppError {
    return new AppError(
      ERROR_CODES.PRECONDITION_NOT_MET,
      message,
      httpStatusFor(ERROR_CODES.PRECONDITION_NOT_MET),
      detail
    );
  }

  static businessRuleFailed(message: string, detail?: unknown): AppError {
    return new AppError(
      ERROR_CODES.BUSINESS_RULE_FAILED,
      message,
      httpStatusFor(ERROR_CODES.BUSINESS_RULE_FAILED),
      detail
    );
  }

  static pacsUnreachable(message = '影像归档服务暂时不可用，请稍后重试或联系信息科'): AppError {
    return new AppError(ERROR_CODES.PACS_UNREACHABLE, message, httpStatusFor(ERROR_CODES.PACS_UNREACHABLE));
  }

  static pacsObjectNotFound(): AppError {
    return new AppError(
      ERROR_CODES.PACS_OBJECT_NOT_FOUND,
      '影像归档中不存在该对象',
      httpStatusFor(ERROR_CODES.PACS_OBJECT_NOT_FOUND)
    );
  }

  static pacsFetchFailed(detail: {
    loadedInstanceCount: number;
    requestedInstanceCount: number;
    failedSliceRange?: number[];
    retryable: boolean;
  }): AppError {
    return new AppError(
      ERROR_CODES.PACS_FETCH_FAILED,
      '影像数据拉取中断，已加载部分层',
      httpStatusFor(ERROR_CODES.PACS_FETCH_FAILED),
      detail
    );
  }

  static aiQueueFull(queueDepth: number): AppError {
    return new AppError(
      ERROR_CODES.AI_QUEUE_FULL,
      `AI 任务队列已满，当前排队 ${queueDepth} 个任务，请稍后重试`,
      httpStatusFor(ERROR_CODES.AI_QUEUE_FULL)
    );
  }

  static signatureServiceUnavailable(
    message = '签名服务暂时不可用，未产生任何签名数据，请稍后重试',
    detail?: unknown
  ): AppError {
    return new AppError(
      ERROR_CODES.SIGNATURE_SERVICE_UNAVAILABLE,
      message,
      httpStatusFor(ERROR_CODES.SIGNATURE_SERVICE_UNAVAILABLE),
      detail
    );
  }

  /** 时间偏移超阈值（AC-15）。**不得用本地时间兜底** */
  static clockDrift(driftSeconds: number, thresholdSeconds: number): AppError {
    return new AppError(
      ERROR_CODES.SIGNATURE_SERVICE_UNAVAILABLE,
      '本机时间与权威时间源偏差过大，已拒绝签名，请联系信息科校准系统时间',
      httpStatusFor(ERROR_CODES.SIGNATURE_SERVICE_UNAVAILABLE),
      { driftSeconds, thresholdSeconds }
    );
  }

  static internal(message = '服务处理异常，请携带追踪 ID 联系信息科'): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, message, httpStatusFor(ERROR_CODES.INTERNAL_ERROR));
  }
}

/**
 * 统一的不可区分响应体。
 *
 * 越权与不存在场景必须返回**字节级相同**的响应体，
 * 否则攻击者可通过 Content-Length 差异判断资源是否存在。
 */
export function indistinguishableBody(): typeof INDISTINGUISHABLE_BODY {
  return { ...INDISTINGUISHABLE_BODY };
}
