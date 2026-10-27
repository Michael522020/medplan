/**
 * 常驻提示条。
 *
 * ## 什么时候必须用
 *
 * - 降级态（WebGL 不可用、几何 Tag 缺失）—— Spec PIT-02「不得静默降级」
 * - NTP 时钟偏移提示 —— 必须在登录时出现，不能等到签名失败才暴露
 * - 无权限态 —— UIUX §9.9，越权与不存在必须**完全一致**
 * - 合规声明 —— AI 分割页的固定声明串
 *
 * ## 不允许折叠
 *
 * 承载安全或合规信息的提示条不允许提供「收起」按钮 ——
 * 「展开才能看到」在合规场景下等于没有。
 */

import type { ReactNode } from 'react';

import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconInfoCircle,
  type Icon,
} from '@/components/icons';

/** 提示条级别。 */
export type AlertLevel =
  /** 危急 / 阻断。 */
  | 'critical'
  /** 警示。降级、精度损失。 */
  | 'warning'
  /** 提示。时钟偏移、常规说明。 */
  | 'notice'
  /** 中性信息。合规声明。 */
  | 'info';

const LEVEL_ICON: Record<AlertLevel, Icon> = {
  critical: IconAlertOctagon,
  warning: IconAlertTriangle,
  notice: IconAlertCircle,
  info: IconInfoCircle,
};

const LEVEL_CLASS: Record<AlertLevel, string> = {
  critical: 'alert-banner--critical',
  warning: 'alert-banner--warning',
  notice: 'alert-banner--notice',
  info: 'alert-banner--info',
};

/** 组件属性。 */
export interface AlertBannerProps {
  level?: AlertLevel;
  /** 主文案。 */
  children: ReactNode;
  /** 右侧操作区。 */
  action?: ReactNode;
  /** 自定义图标。 */
  icon?: Icon;
  /**
   * 播报级别。
   * - `assertive`：安全事件（危急值、签名失效），立即打断
   * - `polite`：常规提示
   * - `off`：不播报（内容已由其他途径播报时用）
   */
  ariaLive?: 'assertive' | 'polite' | 'off';
  className?: string;
}

/**
 * 常驻提示条。
 *
 * @example
 * <AlertBanner level="warning" ariaLive="assertive">
 *   本机时间与院内标准时相差 47 秒，电子签名将被拒绝，请先校准系统时间。
 * </AlertBanner>
 */
export function AlertBanner({
  level = 'notice',
  children,
  action,
  icon,
  ariaLive = 'polite',
  className,
}: AlertBannerProps) {
  const IconComponent = icon ?? LEVEL_ICON[level];

  return (
    <div
      className={['alert-banner', LEVEL_CLASS[level], className]
        .filter(Boolean)
        .join(' ')}
      role={level === 'critical' ? 'alert' : 'status'}
      aria-live={ariaLive}
    >
      <IconComponent size={16} strokeWidth={2} aria-hidden />
      <div className="alert-banner__body">{children}</div>
      {action ? <div className="alert-banner__action">{action}</div> : null}
    </div>
  );
}
