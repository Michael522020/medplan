import type { Session } from '../auth/session.js';
import type { AccessContext } from '../db/access-scope.repository.js';

/**
 * 会话 -> 数据权限上下文。
 *
 * 集中在此，避免每个 service 各写一份判定逻辑 ——
 * 判定分散最容易出的错是「某处漏了 trainee 特例」，
 * 那会让实习医师看到不该看的患者，且很难在测试里发现。
 */

/**
 * 是否拥有全院数据可见性（schema.sql 规则 1）。
 *
 * 拥有全院可见性的角色**仍需全量审计** —— 角色不是免审计通行证。
 */
export function hasGlobalScope(session: Session): boolean {
  return (
    session.roles.includes('quality_control') ||
    session.roles.includes('medical_records') ||
    session.roles.includes('system_admin')
  );
}

/** 是否为实习/试用期医师（规则 5 的额外约束） */
export function isTrainee(session: Session): boolean {
  return session.roles.includes('trainee_physician');
}

/**
 * 是否可读取患者姓名明文。
 *
 * 契约 Deidentify 参数说明：
 *   > 置 `false` 时后端可返回完整姓名，但**仅**质控科与病案管理角色可用，
 *   > 且该路径强制写审计事件 `DEIDENTIFICATION_OVERRIDE`。
 *
 * 身份证**任何情况下都只返回掩码** —— 本函数只管姓名。
 */
export function canReadPlainText(session: Session): boolean {
  return (
    session.roles.includes('quality_control') ||
    session.roles.includes('medical_records')
  );
}

/** 会话 -> SQL 判定用的访问上下文 */
export function toAccessContext(session: Session): AccessContext {
  return {
    userId: session.userId,
    departmentCode: session.department,
    globalScope: hasGlobalScope(session),
    isTrainee: isTrainee(session),
  };
}
