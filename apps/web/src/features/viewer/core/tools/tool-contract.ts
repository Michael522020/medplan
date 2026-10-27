/**
 * 阅片工具的公共契约。
 *
 * ## 为什么每个工具都要成对的 enable / disable
 *
 * Cornerstone 的工具绑定在**元素**上（不是视口上）：一个工具组的工具会
 * 监听它所绑定视口元素的鼠标/滚轮/触摸事件。`setToolActive` 挂上监听，
 * `setToolPassive` 摘掉监听。只 enable 不 disable 的后果是：
 * 切到另一个序列后，旧工具仍在监听新视口元素，鼠标一动就触发旧工具的
 * 画线逻辑 —— 表现为「在新序列上画出了旧序列的测量」，这是临床事故级别的
 * 显示错误，不只是卡顿。
 *
 * 因此工具契约强制成对：`enable` 与 `disable` 由同一个工厂函数产生，
 * 共享同一份状态，不存在「enable 改了状态但 disable 用另一份状态」的缝隙。
 */

import type { Types as ToolTypes } from '@cornerstonejs/tools';

/** 鼠标绑定方式。使用 Cornerstone 的枚举值语义。 */
export type MouseBindingKind =
  | 'primary'
  | 'secondary'
  | 'auxiliary'
  | 'primaryAndSecondary'
  | 'wheel';

/** 工具的分类，用于工具栏分组与图标选择。 */
export type ToolCategory = 'navigation' | 'measurement' | 'annotation' | 'system';

/**
 * 一个可注册到工具组的阅片工具。
 *
 * `enable` 与 `disable` 必须成对实现，且 `disable` 必须能安全地重复调用
 * （StrictMode 双挂载会让 enable/disable 序列出现额外的一次）。
 */
export interface ViewerTool {
  /** 工具唯一标识。同时用作 React key 与 Cornerstone toolName。 */
  readonly id: string;
  /** 显示名称。 */
  readonly label: string;
  /** 分类。 */
  readonly category: ToolCategory;
  /** 快捷键（单键）。空串表示无快捷键。 */
  readonly shortcut: string;
  /**
   * 是否为「互斥工具」——同一时刻只能有一个测量类工具处于激活态。
   * 窗宽窗位与平移缩放不互斥（医生常常同时想调窗与平移），
   * 但两个测量工具同时激活会产生歧义的操作。
   */
  readonly exclusive: boolean;
  /** 鼠标绑定。空数组表示该工具不直接绑定鼠标。 */
  readonly bindings: ToolBinding[];
  /** 启用工具。 */
  enable(group: ToolTypes.IToolGroup, viewportIds: string[]): void;
  /** 停用工具。必须幂等。 */
  disable(group: ToolTypes.IToolGroup): void;
}

/** 一个鼠标绑定。 */
export interface ToolBinding {
  readonly kind: MouseBindingKind;
  /** 是否按住 Ctrl。用于「Ctrl + 滚轮 = 缩放」这类区分。 */
  readonly ctrl?: boolean;
}

/**
 * 创建一个「成对工具」工厂。
 *
 * @param setup 激活时执行的动作（通常是 setToolActive）
 * @param teardown 停用时执行的动作（通常是 setToolPassive）
 */
export function createPairedTool(
  descriptor: Omit<ViewerTool, 'enable' | 'disable'>,
  setup: (group: ToolTypes.IToolGroup) => void,
  teardown: (group: ToolTypes.IToolGroup) => void,
): ViewerTool {
  let active = false;
  return {
    ...descriptor,
    enable(group, viewportIds) {
      void viewportIds;
      setup(group);
      active = true;
    },
    disable(group) {
      if (!active) {
        return;
      }
      active = false;
      teardown(group);
    },
  };
}
