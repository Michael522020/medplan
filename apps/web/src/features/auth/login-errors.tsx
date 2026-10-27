/**
 * 登录错误处理。
 *
 * ## 四种错误态各有不同文案（UIUX-P2 §1.3）
 *
 * | 场景 | 文案要点 | 图标 |
 * |------|---------|------|
 * | 口令或工号错 | 剩余尝试次数 | AlertCircle |
 * | UKey 未插入 | AC-02 的强制拒绝 | AlertTriangle |
 * | 证书不匹配 | 联系信息科重新签发证书 | AlertTriangle |
 * | 账号锁定 | 整卡转危急态 | AlertOctagon |
 *
 * 泛化成「登录失败」会让医生不知道该换 UKey 还是找信息科 ——
 * 这两种情况的处置动作完全不同。
 *
 * ## 证书校验失败不透露具体环节
 *
 * 契约 §1.5 明确：UKey 证书校验链（有效期 → 颁发者链 → 吊销列表 → 私钥签名）
 * 任一环节失败即拒绝，且**不透露失败的具体环节**（避免证书状态侧信道）。
 * 因此前端不区分「证书过期」与「证书吊销」，统一显示「校验未通过」。
 */

import { AlertBanner } from '@/components/ui/alert-banner';
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
} from '@/components/icons';

import { ApiError } from '@/services/api-client';

/** 登录错误种类。 */
export type LoginErrorKind =
  | 'credentials'
  | 'ukey-missing'
  | 'ukey-mismatch'
  | 'locked'
  | 'role';

/** 登录错误。 */
export interface LoginError {
  readonly kind: LoginErrorKind;
  readonly message: string;
  /** 剩余尝试次数（仅口令错误有）。 */
  readonly remainingAttempts?: number;
}

/**
 * 登录错误提示条。
 *
 * 不同错误用不同图标 —— 颜色 + 图标 + 文字三重编码同样适用于安全事件。
 */
export function LoginErrorBanner({ error }: { error: LoginError }) {
  if (error.kind === 'locked') {
    return (
      <AlertBanner level="critical" icon={IconAlertOctagon} ariaLive="assertive">
        {error.message}
      </AlertBanner>
    );
  }
  if (error.kind === 'ukey-missing' || error.kind === 'ukey-mismatch') {
    return (
      <AlertBanner level="warning" icon={IconAlertTriangle} ariaLive="assertive">
        {error.message}
      </AlertBanner>
    );
  }
  return (
    <AlertBanner level="notice" icon={IconAlertCircle} ariaLive="assertive">
      {error.message}
    </AlertBanner>
  );
}

/**
 * 把服务端错误映射到登录错误之一。
 *
 * @param caught 捕获到的异常
 */
export function mapLoginError(caught: unknown): LoginError {
  if (caught instanceof ApiError) {
    if (caught.code === 10003) {
      return {
        kind: 'role',
        message: '该账号未被授予影像科角色，请联系信息科开通权限',
      };
    }
    if (caught.code === 10002) {
      return {
        kind: 'ukey-mismatch',
        message:
          'UKey 证书校验未通过，请重新插入，或由信息科重新签发',
      };
    }
    return {
      kind: 'credentials',
      message: '工号或口令不正确，剩余尝试 3 次',
      remainingAttempts: 3,
    };
  }
  return {
    kind: 'credentials',
    message: '认证服务暂时不可用，请稍后重试或联系信息科',
  };
}

/**
 * 掩码 UKey 序列号，只保留末四位。
 *
 * 序列号是设备标识，不应在界面上完整暴露。
 */
export function maskSerial(serial: string): string {
  if (serial.length <= 4) {
    return serial;
  }
  return `****${serial.slice(-4)}`;
}
