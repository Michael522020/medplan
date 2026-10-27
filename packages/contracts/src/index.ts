/**
 * 契约共享入口。
 *
 * 单一数据源：docs/openapi.yaml
 * 生成方式：npm run gen:types（输出到 ./generated/api-types.ts）
 *
 * 禁止在此手写与契约重复的接口定义 —— 类型必须来自生成产物，
 * 否则契约与实现会漂移，而漂移在 TypeScript 里是静默的。
 */

export type {
  components,
  paths,
  operations,
} from './generated/api-types';

/** 契约中的通用响应包裹 */
export type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
  traceId?: string;
};

/** 错误响应 */
export type ApiErrorResponse = ApiResponse<null> & {
  /** 失败时的补充信息，错误码 40003 会带模型许可拒绝详情 */
  detail?: unknown;
};

/** 后端业务错误码（与 docs/Spec.md §5 锁定值一致） */
export const ERROR_CODES = {
  /** 参数错误 */
  PARAM_INVALID: 10001,
  /** 未认证 */
  UNAUTHENTICATED: 10002,
  /** 无权限（角色级） */
  FORBIDDEN_ROLE: 10003,
  /**
   * 越权（数据级）。
   * 与「患者不存在」不可区分：响应时间、状态码、响应体大小三者均须一致。
   * 见 docs/openapi.yaml §4.1
   */
  FORBIDDEN_DATA: 10004,
  /** 资源不存在。仅用于非 PHI 导航资源（UUID v7 不可枚举） */
  NOT_FOUND: 10005,
  /** AI 模型许可不在 Apache-2.0 白名单 */
  MODEL_LICENSE_REJECTED: 40003,
  /** 规划方案版本冲突 */
  PLAN_VERSION_CONFLICT: 20003,
  /** 报告已签名锁定 */
  REPORT_SIGNED_LOCKED: 50003,
  /** 报告已归档，需医务部门批准方可修改 */
  REPORT_ARCHIVED: 50004,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * 报告锁定状态（服务端权威）。
 *
 * 前端不得仅凭本地 state 判断报告能否编辑 —— 那样篡改前端状态
 * 或直接发请求就能改已签名报告，AC-13 / AC-14 会被绕过。
 */
export type ReportLockState = 'DRAFT' | 'PENDING_REVIEW' | 'SIGNED' | 'ARCHIVED';
