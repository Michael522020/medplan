/**
 * 导航工具：平移、缩放、翻层。
 *
 * ## 滚轮翻层而非缩放
 *
 * UIUX-P2 §3.4.1 明确：滚轮 = 翻层，Ctrl + 滚轮 = 缩放。
 * 理由是「避免误操作」—— 医生在阅片时滚动鼠标的绝大多数意图是翻层，
 * 而缩放是罕见操作。把缩放放到 Ctrl 修饰后面，滚轮就永远不会误缩放。
 *
 * ## 平移用中键
 *
 * 中键拖拽 = 平移。中键在阅片场景里几乎不被用于其他目的，
 * 且它是「不与窗宽窗位冲突」的物理位置 —— 窗宽窗位占用左右键。
 */

import { PanTool, StackScrollTool, ZoomTool } from '@cornerstonejs/tools';

import { createPairedTool, type ViewerTool } from './tool-contract';
import { toCornerstoneBindings } from './tool-bindings';

/** 平移工具（快捷键 V）。 */
export const panTool: ViewerTool = createPairedTool(
  {
    id: 'Pan',
    label: '平移',
    category: 'navigation',
    shortcut: 'V',
    exclusive: false,
    bindings: [{ kind: 'auxiliary' }],
  },
  (group) => {
    group.setToolActive('Pan', toCornerstoneBindings([{ kind: 'auxiliary' }]));
  },
  (group) => {
    group.setToolPassive('Pan');
  },
);

/** 缩放工具（Ctrl + 滚轮）。 */
export const zoomTool: ViewerTool = createPairedTool(
  {
    id: 'Zoom',
    label: '缩放',
    category: 'navigation',
    shortcut: '',
    exclusive: false,
    bindings: [{ kind: 'wheel', ctrl: true }],
  },
  (group) => {
    group.setToolActive(
      'Zoom',
      toCornerstoneBindings([{ kind: 'wheel', ctrl: true }]),
    );
  },
  (group) => {
    group.setToolPassive('Zoom');
  },
);

/** 翻层工具（滚轮）。 */
export const stackScrollTool: ViewerTool = createPairedTool(
  {
    id: 'StackScroll',
    label: '翻层',
    category: 'navigation',
    shortcut: '',
    exclusive: false,
    bindings: [{ kind: 'wheel' }],
  },
  (group) => {
    group.setToolActive('StackScroll', toCornerstoneBindings([{ kind: 'wheel' }]));
  },
  (group) => {
    group.setToolPassive('StackScroll');
  },
);

/** 全部导航工具。 */
export const navigationTools: ViewerTool[] = [
  panTool,
  zoomTool,
  stackScrollTool,
];

/** 导航工具对应的 Cornerstone 工具类，用于全局注册。 */
export const navigationToolClasses = [PanTool, ZoomTool, StackScrollTool];

/** 导航工具的默认配置。 */
export const navigationToolConfigurations: Record<string, object> = {
  Pan: {
    configuration: {
      allowLeftMousePan: false,
    },
  },
  Zoom: {
    configuration: {
      minimumZoomScale: 0.1,
      maximumZoomScale: 20,
      pinchToZoom: true,
      zoomToCenter: true,
    },
  },
  StackScroll: {
    configuration: {
      scrollWheelActive: true,
      invertMouseWheel: false,
    },
  },
};
