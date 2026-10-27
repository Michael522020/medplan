/**
 * 阅片工具条的内置按钮构造器。
 *
 * 单独成文件的原因：按钮清单是**数据**（哪些工具、快捷键、图标），
 * 与按钮的**渲染**（怎么画、什么状态样式）是两件事。
 * 混在一个文件里会让「加一个工具」变成要改渲染逻辑。
 */

import {
  IconAdjustments,
  IconBox,
  IconCrosshair,
  IconHandGrab,
  IconMaximize,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconRepeat,
  IconRuler,
  IconSquare,
  IconStack2,
  IconStack2Filled,
} from '@/components/icons';

import type { ToolbarButtonSpec } from './viewer-toolbar';

export function createToolbarButtons(options: {
  readonly activeToolId: string | null;
  readonly cinePlaying: boolean;
  readonly canRender3d: boolean;
  readonly canRender3dReason: string | undefined;
  readonly onSelectTool: (toolId: string) => void;
  readonly onToggleCine: () => void;
  readonly onToggleFullscreen: () => void;
}): ToolbarButtonSpec[] {
  return [
    {
      id: 'Pan',
      label: '窗口 / 平移',
      shortcut: 'V',
      icon: IconHandGrab,
      active: options.activeToolId === 'Pan',
      onClick: () => options.onSelectTool('Pan'),
    },
    {
      id: 'WindowLevel',
      label: '窗宽窗位',
      shortcut: 'W',
      icon: IconAdjustments,
      active: options.activeToolId === 'WindowLevel',
      onClick: () => options.onSelectTool('WindowLevel'),
    },
    {
      id: 'Crosshairs',
      label: '十字定位线',
      shortcut: 'C',
      icon: IconCrosshair,
      active: options.activeToolId === 'Crosshairs',
      onClick: () => options.onSelectTool('Crosshairs'),
    },
    {
      id: 'Length',
      label: '长度测量',
      shortcut: 'M',
      icon: IconRuler,
      active: options.activeToolId === 'Length',
      onClick: () => options.onSelectTool('Length'),
    },
    {
      id: 'RectangleROI',
      label: '面积测量',
      shortcut: 'Shift+M',
      icon: IconSquare,
      active: options.activeToolId === 'RectangleROI',
      onClick: () => options.onSelectTool('RectangleROI'),
    },
    {
      id: 'StackScroll',
      label: '翻层',
      icon: IconStack2,
      activeIcon: IconStack2Filled,
      active: options.activeToolId === 'StackScroll',
      onClick: () => options.onSelectTool('StackScroll'),
    },
    {
      id: 'Cine',
      label: '电影回放',
      shortcut: 'Space',
      icon: IconPlayerPlay,
      activeIcon: IconPlayerPlayFilled,
      active: options.cinePlaying,
      onClick: options.onToggleCine,
    },
    {
      id: 'Layout',
      label: '布局切换',
      shortcut: '1',
      icon: IconRepeat,
      onClick: options.onToggleFullscreen,
    },
    {
      id: '3d',
      label: '三维重建',
      icon: IconBox,
      disabled: !options.canRender3d,
      disabledReason: options.canRender3dReason,
      onClick: () => undefined,
    },
    {
      id: 'Fullscreen',
      label: '全屏 Canvas',
      shortcut: 'F',
      icon: IconMaximize,
      onClick: options.onToggleFullscreen,
    },
  ];
}
