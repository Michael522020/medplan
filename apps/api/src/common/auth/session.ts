import type { components } from '@medplan/contracts/generated';

/**
 * 会话上下文。
 *
 * 契约说明（openapi.yaml §3 + securitySchemes.bearerAuth）：
 *   Keycloak 26.8.1 签发的访问令牌，载荷含
 *   `sub`（用户 ID）、`dept`（科室）、`roles`（角色数组）、
 *   `ukey_cert_serial`（UKey 证书序列号，证明第二因素已完成）、
 *   `jti`（令牌 ID，用于登出吊销）。
 *
 * ## 为什么后端要自己解 JWT 而不是直接信任网关
 *
 * 等保 8.1.4.1 要求鉴别信息不可伪造。若后端不验签而是信任上游注入的
 * 用户头，任何能直连后端的人都可以伪造 `X-User-Id` 越权。
 * 因此本模块**必须**验签（公钥来自 Keycloak JWKS）。
 *
 * 验签失败一律按「未认证」(10002) 处理，且不透露失败原因。
 */

/** 契约定义的角色编码 */
export type RoleCode = components['schemas']['RoleCode'];

/** 契约定义的专业技术职称 */
export type ProfessionalTitle = components['schemas']['SessionUser']['title'];

/** 契约定义的用户 ID 形态（示例 `u-1-0a82f1a9`） */
export type UserId = string;

/**
 * 会话主体。
 *
 * 由 JWT 载荷构造，**只包含服务端从签名令牌中解出的内容**，
 * 不含任何来自请求头/请求体的字段。
 */
export interface Session {
  userId: UserId;
  loginName: string;
  displayName: string;
  title: ProfessionalTitle;
  department: string;
  roles: RoleCode[];
  /**
   * UKey 证书序列号。会话已绑定 UKey 即证明双因素第二因素已完成。
   * 签名动作仍需**再次**出示 UKey（见 reports 模块）。
   */
  ukeyCertSerial: string | null;
  /** 令牌 ID。登出时吊销 */
  jti: string | null;
  /** 令牌过期时间（epoch 秒） */
  exp: number | null;
}

/**
 * 角色能力判定。
 *
 * 架构方案 §10.1 权限矩阵：
 *   - `report_signer` 是签名的必要条件（实习/试用期医师无此角色）
 *   - `quality_control` / `medical_records` 可读审计
 *   - `system_admin` 拥有全量可见性（但**仍需全量审计**，角色不是免审计通行证）
 */
export function hasRole(session: Session, role: RoleCode): boolean {
  return session.roles.includes(role);
}

/** 是否具备报告签名权限 */
export function canSignReport(session: Session): boolean {
  return hasRole(session, 'image_chief') || hasRole(session, 'system_admin');
}

/** 是否为签名候选医师（主任/副主任/主治医师）——数据库 CHECK 约束同规则 */
export function isSignCapableTitle(title: string): boolean {
  return title === '主任医师' || title === '副主任医师' || title === '主治医师';
}

/** 是否可查询审计日志（管理员 / 质控科只读） */
export function canReadAuditLog(session: Session): boolean {
  return (
    hasRole(session, 'system_admin') ||
    hasRole(session, 'quality_control') ||
    hasRole(session, 'medical_records')
  );
}

/**
 * 是否拥有全院数据可见性（规则 1）。
 *
 * 注意：即便命中，也**不豁免审计**。
 */
export function hasGlobalDataScope(session: Session): boolean {
  return (
    hasRole(session, 'quality_control') ||
    hasRole(session, 'medical_records') ||
    hasRole(session, 'system_admin')
  );
}

/**
 * 是否为实习/试用期医师（规则 5：额外约束）。
 */
export function isTrainee(session: Session): boolean {
  return hasRole(session, 'trainee_physician');
}
