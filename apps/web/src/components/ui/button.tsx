/**
 * 按钮。
 *
 * ## 尺寸恒定
 *
 * Spec §10 明确「UI 尺寸恒定，绝不随分辨率放大（医生已形成肌肉记忆）」。
 * 因此这里没有任何基于视口的尺寸计算 —— 尺寸是固定值，
 * 分辨率变化时按钮逐像素相同。
 *
 * ## 触控目标
 *
 * 视觉高度 32px，但点击热区通过 `::after` 伪元素扩展到 44px
 * （--touch-target-min），满足 WCAG 2.5.5 而不改变视觉尺寸。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { Icon } from '@/components/icons';

/** 按钮视觉变体。 */
export type ButtonVariant =
  /** 主操作。全页最多一个。 */
  | 'primary'
  /** 次要操作。 */
  | 'secondary'
  /** 幽灵按钮。工具栏与表格行内操作用。 */
  | 'ghost'
  /** 危险操作。签名、删除等不可逆动作。 */
  | 'danger';

/** 按钮尺寸。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'btn--sm',
  md: 'btn--md',
  lg: 'btn--lg',
};

/** 按钮属性。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 左侧图标。 */
  icon?: Icon;
  /** 右侧图标。 */
  trailingIcon?: Icon;
  /** 加载中。加载时按钮宽度不变（避免布局跳动）。 */
  loading?: boolean;
  /** 禁用原因。存在时按钮转为 aria-disabled 并在 tooltip 中说明。 */
  disabledReason?: string;
  children?: ReactNode;
}

/**
 * 按钮。
 *
 * `disabled` 用原生 disabled 属性；`disabledReason` 存在时用
 * `aria-disabled` + `title`，让「为什么不能点」可见 ——
 * 医生看到灰掉的签名按钮却不知道为什么，是最常见的交互投诉。
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon: IconComponent,
  trailingIcon: TrailingIcon,
  loading = false,
  disabledReason,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isNativeDisabled = disabled || loading;
  const isAriaDisabled = !isNativeDisabled && Boolean(disabledReason);

  const classes = [
    'btn',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    loading ? 'btn--loading' : '',
    isAriaDisabled ? 'btn--aria-disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={isNativeDisabled}
      aria-disabled={isAriaDisabled || undefined}
      aria-busy={loading || undefined}
      title={disabledReason ?? rest.title}
    >
      {IconComponent ? (
        <IconComponent size={16} strokeWidth={2} aria-hidden />
      ) : null}
      {children ? <span className="btn__label">{children}</span> : null}
      {TrailingIcon ? (
        <TrailingIcon size={16} strokeWidth={2} aria-hidden />
      ) : null}
    </button>
  );
}
