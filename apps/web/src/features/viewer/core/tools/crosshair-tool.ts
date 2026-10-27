/**
 * 十字定位线工具。
 *
 * ## 定位线是灰阶影像上唯一的许可染色层
 *
 * UIUX-P2 §3.2 明确：Canvas 上的十字线用 `--color-overlay-crosshair`，
 * 这是**唯一**允许在灰阶影像上叠加颜色的元素。原因是十字线的作用
 * 就是「指出我在看哪里」，它必须与灰阶影像有最大对比度，灰色会消失。
 *
 * 十字线的颜色因此是整个阅片区唯一一处「在 Canvas 上用颜色表达信息」，
 * 其余标注（测量、箭头）都必须靠形状而非颜色区分。
 */

import { CrosshairsTool } from '@cornerstonejs/tools';

import { createPairedTool, type ViewerTool } from './tool-contract';
import { toCornerstoneBindings } from './tool-bindings';

/** 十字定位工具（快捷键 C）。 */
export const crosshairTool: ViewerTool = createPairedTool(
  {
    id: 'Crosshairs',
    label: '十字定位',
    category: 'navigation',
    shortcut: 'C',
    exclusive: true,
    bindings: [{ kind: 'primary' }],
  },
  (group) => {
    group.setToolActive(
      'Crosshairs',
      toCornerstoneBindings([{ kind: 'primary' }]),
    );
  },
  (group) => {
    group.setToolPassive('Crosshairs');
  },
);

/** 十字工具对应的 Cornerstone 工具类，用于全局注册。 */
export const crosshairToolClasses = [CrosshairsTool];
