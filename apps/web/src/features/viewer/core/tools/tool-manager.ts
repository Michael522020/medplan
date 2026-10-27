/**
 * 工具管理器：工具组的装配与激活状态机。
 *
 * ## 互斥规则
 *
 * `exclusive: true` 的工具（测量类、十字定位）同一时刻只能有一个激活。
 * 切换时必须**先停用旧的再启用新的** —— 反序会导致两个工具同时
 * 监听同一元素，鼠标按下时两个工具都会响应。
 *
 * ## 非互斥工具
 *
 * 窗宽窗位、缩放、平移、翻层可以同时激活：它们分属不同的鼠标通道
 * （左右键 / Ctrl+滚轮 / 中键 / 滚轮），不会冲突。
 *
 * ## 清理
 *
 * `disposeAll` 把所有**曾激活过**的工具停用一遍。停用是幂等的，
 * 所以多调一次没有副作用 —— 但必须调，否则旧工具会继续监听新视口。
 */

import type { Types as ToolTypes } from '@cornerstonejs/tools';

import type { ViewerTool } from './tool-contract';
import {
  crosshairTool,
  crosshairToolClasses,
} from './crosshair-tool';
import {
  measurementToolClasses,
  measurementToolConfigurations,
  measurementTools,
} from './measurement-tools';
import {
  navigationToolClasses,
  navigationToolConfigurations,
  navigationTools,
} from './navigation-tools';
import { windowLevelTool, windowLevelToolClasses } from './window-level-tool';

/** 全部可用工具。 */
export const ALL_TOOLS: ViewerTool[] = [
  ...navigationTools,
  ...measurementTools,
  crosshairTool,
  windowLevelTool,
];

/** 全部工具类，用于全局注册。 */
export const ALL_TOOL_CLASSES = [
  ...navigationToolClasses,
  ...measurementToolClasses,
  ...crosshairToolClasses,
  ...windowLevelToolClasses,
];

/** 工具的默认配置合并表。 */
export const TOOL_CONFIGURATIONS: Record<string, object> = {
  ...navigationToolConfigurations,
  ...measurementToolConfigurations,
};

/** 工具管理器。 */
export interface ToolManager {
  /** 把工具装配进工具组（只装配，不激活）。 */
  install(group: ToolTypes.IToolGroup): void;
  /** 激活一个工具。会先停用与之互斥的已激活工具。 */
  activate(group: ToolTypes.IToolGroup, toolId: string): void;
  /** 停用全部工具。 */
  deactivateAll(group: ToolTypes.IToolGroup): void;
  /** 当前激活的工具 id 集合。 */
  readonly activeToolIds: ReadonlySet<string>;
}

/**
 * 创建一个工具管理器。
 *
 * @param viewportIds 工具要绑定的视口。Cornerstone 的工具绑定在元素上，
 *   必须在视口启用之后才知道。
 */
export function createToolManager(viewportIds: string[]): ToolManager {
  const activeToolIds = new Set<string>();

  return {
    install(group: ToolTypes.IToolGroup): void {
      for (const tool of ALL_TOOLS) {
        const configuration = TOOL_CONFIGURATIONS[tool.id];
        group.addTool(tool.id, configuration ?? {});
      }
      for (const viewportId of viewportIds) {
        group.addViewport(viewportId);
      }
    },

    activate(group: ToolTypes.IToolGroup, toolId: string): void {
      const target = ALL_TOOLS.find((tool) => tool.id === toolId);
      if (!target) {
        return;
      }

      if (target.exclusive) {
        for (const tool of ALL_TOOLS) {
          if (!tool.exclusive || tool.id === target.id) {
            continue;
          }
          if (!activeToolIds.has(tool.id)) {
            continue;
          }
          tool.disable(group);
          activeToolIds.delete(tool.id);
        }
      }

      if (activeToolIds.has(target.id)) {
        return;
      }
      target.enable(group, viewportIds);
      activeToolIds.add(target.id);
    },

    deactivateAll(group: ToolTypes.IToolGroup): void {
      for (const tool of ALL_TOOLS) {
        if (!activeToolIds.has(tool.id)) {
          continue;
        }
        tool.disable(group);
        activeToolIds.delete(tool.id);
      }
    },

    get activeToolIds(): ReadonlySet<string> {
      return activeToolIds;
    },
  };
}

/** 按快捷键查找工具。找不到返回 null。 */
export function findToolByShortcut(shortcut: string): ViewerTool | null {
  const normalized = shortcut.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    ALL_TOOLS.find((tool) => tool.shortcut.toLowerCase() === normalized) ?? null
  );
}
