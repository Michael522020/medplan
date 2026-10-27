/**
 * 空状态 / 错误态的统一呈现。
 *
 * ## 文案规则（UIUX-P2 §2.3）
 *
 * 空态文案必须回答医生的三个问题：
 * **还有没有活？为什么空？接下来做什么？**
 *
 * 「暂无数据」三个问题一个都没回答，因此被明令禁止。
 * 本组件只接受已经过内容审查的文案 —— `title` 与 `description` 都是必填，
 * 开发者无法只写「暂无数据」蒙混过关。
 *
 * ## 图标
 *
 * 空态图标是「状态的一部分」，用 Tabler 图形而非 emoji，
 * 且尺寸 32px（--icon-size-lg）。
 */

import type { ReactNode } from 'react';

import { IconFileOff, IconInbox, IconLockAccess, IconPlugConnectedX, type Icon } from '@/components/icons';

/** 空态的种类。决定默认图标。 */
export type EmptyStateKind =
  /** 数据为空。 */
  | 'empty'
  /** 资源无图像数据。 */
  | 'no-data'
  /** 权限受限。 */
  | 'forbidden'
  /** 服务不可达。 */
  | 'unreachable';

/** 各类别的默认图标。 */
const KIND_ICON: Record<EmptyStateKind, Icon> = {
  empty: IconInbox,
  'no-data': IconFileOff,
  forbidden: IconLockAccess,
  unreachable: IconPlugConnectedX,
};

/** 组件属性。 */
export interface EmptyStateProps {
  kind?: EmptyStateKind;
  /** 主标题。必填 —— 必须说清发生了什么。 */
  title: string;
  /** 补充说明。必填 —— 必须说清为什么与下一步。 */
  description: string;
  /** 自定义图标。 */
  icon?: Icon;
  /** 操作区。 */
  action?: ReactNode;
  className?: string;
}

/**
 * 空状态。
 *
 * @example
 * <EmptyState
 *   title="今日待阅队列已清空"
 *   description="最近一次归档 16:42，新检查到达时会自动出现在待阅列表。"
 *   action={<Button>查看已阅列表</Button>}
 * />
 */
export function EmptyState({
  kind = 'empty',
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  const IconComponent = icon ?? KIND_ICON[kind];

  return (
    <div
      className={['empty-state', `empty-state--${kind}`, className]
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      <IconComponent size={32} strokeWidth={1.75} aria-hidden />
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__description">{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
