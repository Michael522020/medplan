/**
 * 阅片页快捷键 Hook。
 *
 * ## 焦点在输入框内时全部单键失效（UIUX-P2 §3.7.3）
 *
 * 医生在报告编辑器里打字时，如果 `W`（窗宽窗位）仍然触发工具切换，
 * 就会打出「窗宽窗位」三个字。这是 UIUX-P2 点名的**最常见无障碍事故源**。
 *
 * 因此：焦点在 `input` / `textarea` / `contenteditable` 内时，
 * 除 `Esc` 外所有单键快捷键一律失效。Ctrl / Meta / Alt 组合键也不处理
 * （浏览器与操作系统已占用那些组合）。
 *
 * ## Esc 的两级语义
 *
 * UIUX-P2 §3.4.3：`Esc` 先退出当前工具，再退出全屏。
 * 本 Hook 只负责「退出当前工具与回放」，全屏退出由页面处理。
 */

import { useEffect } from 'react';

import { findToolByShortcut } from '../core';

/** 快捷键 Hook 的参数。 */
export interface UseViewerShortcutsOptions {
  /** 选中一个工具。传空串表示「退出当前工具」。 */
  readonly onSelectTool: (toolId: string) => void;
  /** 切换电影回放。 */
  readonly onToggleCine: () => void;
}

/**
 * 注册阅片页的键盘快捷键。
 */
export function useViewerShortcuts(options: UseViewerShortcutsOptions): void {
  const { onSelectTool, onToggleCine } = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onSelectTool('');
        onToggleCine();
        return;
      }

      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (inEditable || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        onToggleCine();
        return;
      }

      const tool = findToolByShortcut(event.key);
      if (tool) {
        event.preventDefault();
        onSelectTool(tool.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onSelectTool, onToggleCine]);
}
