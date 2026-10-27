/**
 * 统一错误码。
 *
 * 契约来源：docs/openapi.yaml §4 的错误码表 + docs/Spec.md §5。
 * 这里是**运行时**的权威定义，与 @medplan/contracts 的 ERROR_CODES 保持一致
 * （后者给前端用，这里给后端用）。
 *
 * 关键安全约束 —— 10004 与 10005 的不可区分性：
 *
 *   越权（数据级）必须返回 10004，且响应时间、状态码、响应体大小三者
 *   都要与「患者不存在」不可区分。攻击者读 code 就能判断患者是否存在，
 *   违反国卫办医发〔2017〕8号第十四条 + 国卫医发〔2013〕31号第十五条。
 *
 *   实现要点（架构方案 §10.1）：
 *   1. PHI 可导航路径（经患者/检查/就诊到达）统一返 10004
 *   2. 非 PHI 导航（主键为 UUID v7，122 bit 熵，不可枚举）才用 10005
 *   3. 命中 10004 前必须先执行一次等价的数据库探测（查询恒定返回同一索引路径），
 *      避免「越权立即返回」与「不存在走完整查询」产生时序差
 *   4. 同一套响应体、同一 message 字面量、同一响应体字节数
 */

export const ERROR_CODES = {
  /** 参数错误 */
  PARAM_INVALID: 10001,
  /** 未认证 */
  UNAUTHENTICATED: 10002,
  /** 无权限（角色级）。用于「会话身份与资源归属不匹配」 */
  FORBIDDEN_ROLE: 10003,
  /** 越权（数据级）。须与「患者不存在」不可区分 */
  FORBIDDEN_DATA: 10004,
  /** 资源不存在。仅用于非 PHI 导航资源 */
  NOT_FOUND: 10005,
  /** 业务校验失败：语义合法但业务不成立 */
  BUSINESS_RULE_FAILED: 20001,
  /** 业务前置不满足：如平扫提交肝胆分割、未完成 AI 确认即提交报告 */
  PRECONDITION_NOT_MET: 20002,
  /** 规划方案版本冲突（乐观锁） */
  PLAN_VERSION_CONFLICT: 20003,
  /** PACS 不可达 */
  PACS_UNREACHABLE: 30001,
  /** 检查/序列不存在于 PACS（业务库有元数据但 PACS 无归档对象） */
  PACS_OBJECT_NOT_FOUND: 30002,
  /** 序列拉取失败 */
  PACS_FETCH_FAILED: 30003,
  /** AI 队列已满 */
  AI_QUEUE_FULL: 40001,
  /** AI 推理失败 */
  AI_INFERENCE_FAILED: 40002,
  /** AI 模型许可不在 Apache-2.0 白名单 */
  MODEL_LICENSE_REJECTED: 40003,
  /** 模型版本不匹配 */
  MODEL_VERSION_MISMATCH: 40004,
  /** 报告未审核不可签名 */
  REPORT_NOT_REVIEWED: 50001,
  /** 签名服务不可达（密码机 / TSA / 权威时间源） */
  SIGNATURE_SERVICE_UNAVAILABLE: 50002,
  /** 报告已签名锁定 */
  REPORT_SIGNED_LOCKED: 50003,
  /** 报告已归档，需医务部门批准方可修改 */
  REPORT_ARCHIVED: 50004,
  /** 内部错误。不得暴露堆栈、SQL、内部主机名 */
  INTERNAL_ERROR: 90001,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * 错误码 -> HTTP 状态码。
 *
 * 与 openapi.yaml §4 的表格逐行对应。前端**禁止**依据 HTTP 状态码做业务分支，
 * 只依据 code；但状态码仍须正确，否则网关 / 监控 / 审计链路会误判。
 */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ERROR_CODES.PARAM_INVALID]: 400,
  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.FORBIDDEN_ROLE]: 403,
  [ERROR_CODES.FORBIDDEN_DATA]: 404,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.BUSINESS_RULE_FAILED]: 422,
  [ERROR_CODES.PRECONDITION_NOT_MET]: 422,
  [ERROR_CODES.PLAN_VERSION_CONFLICT]: 409,
  [ERROR_CODES.PACS_UNREACHABLE]: 503,
  [ERROR_CODES.PACS_OBJECT_NOT_FOUND]: 404,
  [ERROR_CODES.PACS_FETCH_FAILED]: 502,
  [ERROR_CODES.AI_QUEUE_FULL]: 429,
  [ERROR_CODES.AI_INFERENCE_FAILED]: 500,
  [ERROR_CODES.MODEL_LICENSE_REJECTED]: 400,
  [ERROR_CODES.MODEL_VERSION_MISMATCH]: 409,
  [ERROR_CODES.REPORT_NOT_REVIEWED]: 409,
  [ERROR_CODES.SIGNATURE_SERVICE_UNAVAILABLE]: 503,
  [ERROR_CODES.REPORT_SIGNED_LOCKED]: 409,
  [ERROR_CODES.REPORT_ARCHIVED]: 409,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};

/**
 * 按错误码取 HTTP 状态码。
 *
 * 用函数而非直接索引：`ERROR_CODES.XXX` 是**值**（如 10001），
 * 不是 `ERROR_CODES` 的键。用 `HTTP_STATUS_BY_CODE[ERROR_CODES.XXX]` 索引
 * 会得到 `undefined` —— 这正是上面那批 TS2339 报错的根因，
 * 而且在运行时表现为「HTTP 状态码 undefined」，会让 Fastify 抛错。
 */
export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS_BY_CODE[code];
}

/**
 * 越权与不存在必须返回**完全相同**的响应。
 *
 * 这里的常量刻意写成「请求的资源不可用」这样的中性表述 ——
 * 不能出现「无权限」「不存在」「患者」等任何可区分的词。
 */
export const INDISTINGUISHABLE_MESSAGE = '请求的资源不可用';

/** 越权与不存在的统一错误码 */
export const INDISTINGUISHABLE_CODE: ErrorCode = ERROR_CODES.FORBIDDEN_DATA;

/**
 * 不可区分错误响应体。
 *
 * 响应体大小也必须一致 —— 攻击者可通过 Content-Length 差异判断
 * 「资源存在但无权」与「资源不存在」。因此两个场景返回**字节级相同**的体。
 */
export const INDISTINGUISHABLE_BODY = {
  code: INDISTINGUISHABLE_CODE,
  message: INDISTINGUISHABLE_MESSAGE,
  data: null,
} as const;

/**
 * 非 PHI 导航资源的「不存在」消息。
 *
 * 这条只在主键为 UUID v7（122 bit 熵，不可枚举）的资源上使用。
 * 攻击者无法构造有效 UUID，因此 10005 不构成患者存在性预言机。
 */
export const NOT_FOUND_MESSAGE = '请求的资源不可用';
