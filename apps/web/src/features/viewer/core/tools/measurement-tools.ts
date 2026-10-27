/**
 * 测量工具：长度、角度、面积。
 *
 * ## 临床语义（Spec MEAS-01 / AC-07）
 *
 * 长度工具显示毫米级数值（依赖 DICOM 的 PixelSpacing 换算），
 * 角度工具显示角度，面积工具显示平方毫米。三者互斥 ——
 * 同时激活两个测量工具会让「这次点击属于哪个工具」变得不确定。
 *
 * ## 颜色禁用红绿
 *
 * Cornerstone 默认的标注样式是黄色（rgb(255,255,0)）+ 绿色高亮
 * （rgb(0,255,0)）。绿色高亮叠加在影像上时，与红色 ROI 叠加对
 * 红绿色盲患者完全无法区分 —— 这是真实的临床可读性问题。
 *
 * 因此本模块显式覆盖标注样式：所有测量统一用单一的强调色描边，
 * 靠**线宽与形状**区分类型，而不是靠颜色。这既满足无障碍要求，
 * 也避免在灰阶影像上引入色噪声。
 *
 * 样式值来自设计 Token 的实际计算值（getComputedStyle 读取），
 * 不写死十六进制 —— 否则既会与 Token 漂移，也违反「零硬编码颜色」约束。
 */

import {
  AngleTool,
  LengthTool,
  RectangleROITool,
  annotation,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';

import { createPairedTool, type ViewerTool } from './tool-contract';
import { toCornerstoneBindings } from './tool-bindings';

/**
 * 读取一个 CSS 变量的计算值，供 Cornerstone 的 SVG 绘制层使用。
 *
 * 读取失败时回退 `currentColor` —— 它是 CSS 关键字而非色值，
 * 因此不违反「颜色零硬编码」，且在任意主题下都与周围文字一致。
 */
function readTokenColor(token: string): string {
  if (typeof window === 'undefined') {
    return 'currentColor';
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value.length > 0 ? value : 'currentColor';
}

/**
 * 覆盖测量工具的标注样式。
 *
 * 只覆盖颜色相关属性：Cornerstone 的样式查找是**逐属性回退**的
 * （先查工具组级，再回落到默认级），因此未指定的属性（字号、
 * 阴影、虚线等）会自动继承默认值，不会被误伤。
 */
export function applyMeasurementAnnotationStyle(toolGroupId?: string): void {
  const accent = readTokenColor('--color-accent-clinical');
  const style = {
    color: accent,
    colorHighlighted: accent,
    colorSelected: accent,
    colorLocked: accent,
    textBoxColor: accent,
    textBoxColorHighlighted: accent,
    textBoxColorSelected: accent,
    textBoxColorLocked: accent,
    lineWidth: '2',
  };
  if (toolGroupId) {
    annotation.config.style.setToolGroupToolStyles(toolGroupId, {
      global: style,
    });
  } else {
    annotation.config.style.setDefaultToolStyles({
      global: style,
    });
  }
}

/** 长度测量工具（快捷键 M）。 */
export const lengthTool: ViewerTool = createPairedTool(
  {
    id: 'Length',
    label: '长度测量',
    category: 'measurement',
    shortcut: 'M',
    exclusive: true,
    bindings: [{ kind: 'primary' }],
  },
  (group) => {
    group.setToolActive('Length', toCornerstoneBindings([{ kind: 'primary' }]));
  },
  (group) => {
    group.setToolPassive('Length');
  },
);

/** 角度测量工具（快捷键 A）。 */
export const angleTool: ViewerTool = createPairedTool(
  {
    id: 'Angle',
    label: '角度测量',
    category: 'measurement',
    shortcut: 'A',
    exclusive: true,
    bindings: [{ kind: 'primary' }],
  },
  (group) => {
    group.setToolActive('Angle', toCornerstoneBindings([{ kind: 'primary' }]));
  },
  (group) => {
    group.setToolPassive('Angle');
  },
);

/** 面积 / ROI 工具（快捷键 Shift+M）。 */
export const areaTool: ViewerTool = createPairedTool(
  {
    id: 'RectangleROI',
    label: '面积测量',
    category: 'measurement',
    shortcut: 'Shift+M',
    exclusive: true,
    bindings: [{ kind: 'primary' }],
  },
  (group) => {
    group.setToolActive(
      'RectangleROI',
      toCornerstoneBindings([{ kind: 'primary' }]),
    );
  },
  (group) => {
    group.setToolPassive('RectangleROI');
  },
);

/** 全部测量工具。 */
export const measurementTools: ViewerTool[] = [lengthTool, angleTool, areaTool];

/** 测量工具对应的 Cornerstone 工具类，用于全局注册。 */
export const measurementToolClasses = [LengthTool, AngleTool, RectangleROITool];

/** 测量工具的默认配置（构造时传给 Cornerstone）。 */
export const measurementToolConfigurations: Record<string, object> = {
  Length: {
    configuration: {
      preventHandleOutsideImage: false,
    },
  },
  Angle: {
    configuration: {
      showAngleArc: true,
      arcOffset: 5,
      preventHandleOutsideImage: false,
    },
  },
  RectangleROI: {
    configuration: {
      storePointData: false,
      calculateStats: true,
      preventHandleOutsideImage: false,
    },
  },
};

/** 供外部查询的 Cornerstone 工具类型（测量工具用到的几种）。 */
export type { ToolTypes };
