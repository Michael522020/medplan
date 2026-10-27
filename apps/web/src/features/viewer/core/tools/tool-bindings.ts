/**
 * 鼠标绑定到 Cornerstone 绑定配置的转换。
 *
 * Cornerstone 的 `setToolActive(toolName, { bindings })` 接受一个绑定数组，
 * 每项形如 `{ mouseButton: MouseBindings.Primary }`。
 *
 * ## 交互约定（UIUX-P2 §3.4.1）
 *
 * | 操作 | 行为 | 绑定 |
 * |------|------|------|
 * | 左键拖拽 | 窗宽窗位（水平=W，垂直=C） | Primary |
 * | 右键拖拽 | 同左键（为惯用右手医生保留的并行路径） | Secondary |
 * | 中键拖拽 | 平移 | Auxiliary |
 * | 滚轮 | 翻层（而非缩放，避免误操作） | Wheel |
 * | Ctrl + 滚轮 | 缩放 | Wheel + Ctrl |
 *
 * 右键拖拽必须屏蔽浏览器右键菜单 —— 否则每次调窗都要先关菜单，
 * 这是调窗交互中最实际的点击陷阱。屏蔽由视口容器统一处理，不在工具层做。
 */

import { Enums } from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';

import type { MouseBindingKind, ToolBinding } from './tool-contract';

/** 把本层的绑定描述转换为 Cornerstone 的绑定配置。 */
export function toCornerstoneBindings(
  bindings: ReadonlyArray<ToolBinding>,
): ToolTypes.SetToolBindingsType {
  return {
    bindings: bindings.map((binding) => {
      const converted: ToolTypes.IToolBinding = {
        mouseButton: toMouseButton(binding.kind),
      };
      if (binding.ctrl) {
        converted.modifierKey = Enums.KeyboardBindings.Ctrl;
      }
      return converted;
    }),
  };
}

/** 绑定类型到 Cornerstone 鼠标枚举的映射。 */
function toMouseButton(kind: MouseBindingKind): ToolTypes.IToolBinding['mouseButton'] {
  switch (kind) {
    case 'primary':
      return Enums.MouseBindings.Primary;
    case 'secondary':
      return Enums.MouseBindings.Secondary;
    case 'auxiliary':
      return Enums.MouseBindings.Auxiliary;
    case 'primaryAndSecondary':
      return Enums.MouseBindings.Primary_And_Secondary;
    case 'wheel':
      return Enums.MouseBindings.Wheel;
  }
}
