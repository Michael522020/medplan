/**
 * 会话管理。
 *
 * ## 令牌存哪里
 *
 * 存 `sessionStorage` 而不是 `localStorage`：
 * 关闭标签页即失效，符合「工作站是共用设备」的院内现实 ——
 * 医生下班后忘记退出，下一位医生不该在他的会话里操作。
 *
 * ## 角色决定可见功能
 *
 * `report_signer` 是签名的必要条件（架构方案 §10.1 权限矩阵），
 * 实习/试用期医师没有这个角色。UI 层据此隐藏签名入口，
 * 而不是让用户点了才被服务端拒绝。
 */

import type { components } from '@medplan/contracts';

/** 登录响应中的用户信息。 */
export type SessionUser = components['schemas']['SessionUser'];

/** 登录响应。 */
export type LoginResult = components['schemas']['LoginResponse']['data'];

/** UKey 绑定信息。 */
export type UKeyInfo = components['schemas']['UKeyInfo'];

/** 会话状态。 */
export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: SessionUser;
  readonly ukey: UKeyInfo | null;
  /** 本机时间与院内标准时的偏移（毫秒）。 */
  readonly ntpOffsetMs: number;
}

const STORAGE_KEY = 'medplan.session';

/** 会话变更订阅。 */
type Listener = (session: Session | null) => void;

const listeners = new Set<Listener>();

/** 读取当前会话。无会话返回 null。 */
export function readSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Session;
    return parsed.accessToken ? parsed : null;
  } catch {
    // 隐私模式或存储被禁用时按未登录处理。
    return null;
  }
}

/** 写入会话并通知订阅者。 */
export function writeSession(session: Session): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 存储失败不影响本次会话在内存中的可用性。
  }
  notify();
}

/** 清除会话并通知订阅者。 */
export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略：清除失败不改变「当前视为已登出」的结论。
  }
  notify();
}

/** 订阅会话变化。返回取消订阅函数。 */
export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 通知所有订阅者。 */
function notify(): void {
  const session = readSession();
  for (const listener of listeners) {
    listener(session);
  }
}

/**
 * 签名权限角色码。
 *
 * `report_signer` 是签名的**独立角色**，不是 `image_physician` 的隐含属性 ——
 * 实习/试用期医师有 `image_physician` 但无 `report_signer`，不得签名
 * （架构方案 §10.1 权限矩阵）。
 *
 * 契约历史：`RoleCode` 枚举一度遗漏此值（description 引用了它、
 * `SessionUser.roles` 示例里也有它，但枚举里没有），前端当时只能用
 * 字面量 + 类型放宽兜底。契约已修正，此处恢复为类型安全的枚举判断。
 */
const REPORT_SIGNER_ROLE = 'report_signer';

/** 当前用户是否有签名权限。 */
export function canSignReport(session: Session | null): boolean {
  if (!session) {
    return false;
  }
  return session.user.roles.includes(REPORT_SIGNER_ROLE);
}

/** 当前用户是否有审计查询权限（质控科 / 审计管理员）。 */
export function canQueryAudit(session: Session | null): boolean {
  if (!session) {
    return false;
  }
  return (
    session.user.roles.includes('quality_control') ||
    session.user.roles.includes('system_admin')
  );
}

/**
 * NTP 偏移的提示等级。
 *
 * | 偏移 | 等级 | 依据 |
 * |------|------|------|
 * | ≤ 1000ms | 正常，不提示 | 契约给出的提示阈值 |
 * | 1000ms < 偏移 ≤ 60000ms | 提示校时 | 契约提示阈值 |
 * | > 60000ms | 警示：签名将被拒绝 | AC-15 的拒绝阈值 |
 */
export type ClockOffsetLevel = 'ok' | 'notice' | 'blocking';

/** 按契约阈值判定 NTP 偏移等级。 */
export function classifyClockOffset(offsetMs: number): ClockOffsetLevel {
  const absolute = Math.abs(offsetMs);
  if (absolute <= 1000) {
    return 'ok';
  }
  if (absolute <= 60000) {
    return 'notice';
  }
  return 'blocking';
}

/** 把偏移毫秒格式化为「2.3 秒」这类可读文案。 */
export function formatClockOffset(offsetMs: number): string {
  return `${(Math.abs(offsetMs) / 1000).toFixed(1)} 秒`;
}
