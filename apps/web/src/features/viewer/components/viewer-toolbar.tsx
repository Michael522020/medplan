/**
 * 阅片工具条（40px）。
 *
 * ## 浮动于 Canvas 下沿
 *
 * 工具条浮在 Canvas 底部，默认半透明 —— 医生需要看到影像全貌，
 * 工具条不能占用视野。悬浮在 Canvas 上意味着它**不参与** Canvas
 * 高度的计算，因此布局计算里 Canvas 高度是
 * `视口高 - 40(状态栏) - 40(工具条) - 32(序列导航)`。
 *
 * ## 两态图标
 *
 * Tabler 的填充态是**同名独立构件**（IconPlayerPlay / IconPlayerPlayFilled），
 * 不是 `-filled` 后缀。工具激活时切换到填充构件，保持同一几何语言。
 *
 * ## 快捷键提示
 *
 * 每个按钮带 `aria-keyshortcuts`，Tooltip 显示快捷键（--font-mono）。
 * 医生用工具条的频率高于菜单，快捷键提示能显著提升效率。
 */

import { type Icon } from '@/components/icons';

/** 工具条上的一个按钮。 */
export interface ToolbarButtonSpec {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly icon: Icon;
  /** 激活态使用的填充图标。不提供则复用普通图标。 */
  readonly activeIcon?: Icon;
  /** 是否处于激活态。 */
  readonly active?: boolean;
  /** 是否禁用。 */
  readonly disabled?: boolean;
  /** 禁用原因（tooltip）。 */
  readonly disabledReason?: string;
  readonly onClick: () => void;
}

/** 组件属性。 */
export interface ViewerToolbarProps {
  readonly buttons: ReadonlyArray<ToolbarButtonSpec>;
}

/**
 * 阅片工具条。
 */
export function ViewerToolbar({ buttons }: ViewerToolbarProps) {
  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="阅片工具">
      {buttons.map((button) => {
        const IconComponent = button.active
          ? (button.activeIcon ?? button.icon)
          : button.icon;
        return (
          <button
            key={button.id}
            type="button"
            className={[
              'viewer-toolbar__button',
              button.active ? 'viewer-toolbar__button--active' : '',
              button.disabled ? 'viewer-toolbar__button--disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={button.onClick}
            disabled={button.disabled}
            aria-pressed={button.active}
            aria-disabled={button.disabled || undefined}
            aria-keyshortcuts={button.shortcut}
            title={
              button.disabledReason ??
              (button.shortcut
                ? `${button.label}（${button.shortcut}）`
                : button.label)
            }
          >
            <IconComponent size={20} strokeWidth={2} aria-hidden />
            <span className="sr-only">{button.label}</span>
          </button>
        );
      })}
    </div>
  );
}
