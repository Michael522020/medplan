/**
 * 状态徽章 —— 危急值三重编码的唯一实现。
 *
 * ## 三重编码（Spec AC-22 / UIUX P3）
 *
 * 任何状态色使用处必须同时有：
 * 1. **颜色**（来自 design-tokens 的 status 色）
 * 2. **图标**（Tabler 图形，颜色之外的可辨形状）
 * 3. **文字**（「危急值」/「正常」这类明确词汇）
 *
 * 只用颜色区分状态，红绿色盲患者（约 8% 男性）完全无法判读 ——
 * 而读错「危急值」是临床事故。因此本组件**不接受「只有颜色」的用法**：
 * 图标与文字是必填参数，缺一在类型层面就编译不过。
 *
 * ## 为什么不用纯色圆点
 *
 * UIUX-P2 §2.3 明确「无纯色圆点」。圆点没有形状差异，
 * 在色觉障碍下与纯色文字无差别。
 */

import type { ReactNode } from 'react';

import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconInfoCircle,
  type Icon,
} from '@/components/icons';

/** 状态语义。 */
export type StatusTone =
  /** 危急值 / 失败 / 拒绝。 */
  | 'critical'
  /** 异常 / 警告 / 降级。 */
  | 'warning'
  /** 正常 / 成功。 */
  | 'normal'
  /** 进行中 / 待处理。 */
  | 'pending'
  /** 中性信息。 */
  | 'info';

/** 状态对应的图标。每个语义有且只有一个图形。 */
const TONE_ICON: Record<StatusTone, Icon> = {
  critical: IconAlertTriangle,
  warning: IconAlertTriangle,
  normal: IconCircleCheck,
  pending: IconCircleDashed,
  info: IconInfoCircle,
};

/** 状态对应的 CSS 类名（颜色由 global.css / tokens 决定）。 */
const TONE_CLASS: Record<StatusTone, string> = {
  critical: 'status-badge--critical',
  warning: 'status-badge--warning',
  normal: 'status-badge--normal',
  pending: 'status-badge--pending',
  info: 'status-badge--info',
};

/** 状态徽章的属性。 */
export interface StatusBadgeProps {
  /** 状态语义。决定颜色与图标。 */
  tone: StatusTone;
  /**
   * 状态文字。**必填** —— 三重编码的第三重。
   * 例如「危急值」「正常」「急诊」「已阅」。
   */
  children: ReactNode;
  /**
   * 自定义图标。默认按 tone 取。
   *
   * 允许覆盖是为了区分同一 tone 下的不同语义（例如 warning 既用于
   * 「期相待人工确认」也用于「降级」），但**文字仍是必填** ——
   * 覆盖图标不能把三重编码降级成两重。
   */
  icon?: Icon;
  /** 是否用填充态图标（强调当前状态）。 */
  filled?: boolean;
  /** 附加类名。 */
  className?: string;
}

/**
 * 状态徽章。
 *
 * @example
 * <StatusBadge tone="critical">危急值</StatusBadge>
 * <StatusBadge tone="normal">正常</StatusBadge>
 */
export function StatusBadge({
  tone,
  children,
  icon,
  filled = false,
  className,
}: StatusBadgeProps) {
  const IconComponent = icon ?? TONE_ICON[tone];
  const iconClassName = filled ? `${TONE_CLASS[tone]}__icon--filled` : undefined;

  return (
    <span
      className={['status-badge', TONE_CLASS[tone], className]
        .filter(Boolean)
        .join(' ')}
    >
      <IconComponent
        size={14}
        strokeWidth={2}
        aria-hidden
        className={iconClassName}
      />
      <span className="status-badge__text">{children}</span>
    </span>
  );
}

/** 失败态图标。审计与错误列表里「失败」需要独立的图形。 */
export function FailureIcon() {
  return <IconCircleX size={14} strokeWidth={2} aria-hidden />;
}

/** 进行中图标。AI 任务状态用。 */
export function PendingIcon() {
  return <IconClock size={14} strokeWidth={2} aria-hidden />;
}
