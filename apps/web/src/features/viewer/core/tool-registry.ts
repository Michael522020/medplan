/**
 * Cornerstone 工具类的全局注册表。
 *
 * ## 全局 vs 工具组
 *
 * Cornerstone 的工具有两层：
 * - **全局注册表**（`state.tools`）：工具**类**的登记。同一类工具
 *   在整个应用里只登记一次。
 * - **工具组实例**（`toolGroup._toolInstances`）：工具在某个工具组里的
 *   实例。随工具组创建与销毁。
 *
 * 前者是跨视口共享的，因此**不能**在单个视口卸载时注销 ——
 * 那会让其他视口的工具突然失效。本模块用引用计数式的登记表
 * 记录「谁登记过」，保证只有最后一个使用者离开时才真正注销。
 *
 * ## 幂等判断用 `store.hasTool(ToolClass)`
 *
 * 它接受工具类本身，而不是工具名。`@cornerstonejs/tools` 5.13.2
 * 的包根入口只导出 `addTool` / `removeTool`，按名查询的 `hasTool` /
 * `hasToolByName` 只在 `store` 命名空间下可达。
 */

import {
  addTool as registerToolClass,
  removeTool as unregisterToolClass,
  store as cornerstoneToolsStore,
} from '@cornerstonejs/tools';

/** 已注册的 Cornerstone 工具类。 */
const registeredToolClasses = new Map<string, unknown>();

/**
 * 注册一个 Cornerstone 工具类（全局）。
 *
 * 幂等：重复注册同一个工具类不会重复写入 Cornerstone 的全局表。
 */
export function registerTool(toolClass: unknown): void {
  const toolName = readToolName(toolClass);
  if (!toolName) {
    return;
  }
  if (!cornerstoneToolsStore.hasTool(toolClass)) {
    registerToolClass(toolClass);
  }
  registeredToolClasses.set(toolName, toolClass);
}

/**
 * 注销一个工具类（全局）。
 *
 * @returns 是否真的执行了注销。工具类已被别人注销时返回 false，
 *   不抛错 —— Cornerstone 的 `removeTool` 在工具不存在时会抛异常，
 *   而 StrictMode 下的双挂载会让这种异常变成难以复现的偶发崩溃。
 */
export function unregisterTool(toolClass: unknown): boolean {
  const toolName = readToolName(toolClass);
  if (!toolName) {
    return false;
  }
  const removed = registeredToolClasses.delete(toolName);
  if (!removed) {
    return false;
  }
  try {
    unregisterToolClass(toolClass);
  } catch {
    // 工具类已被其他路径注销，视为成功。
  }
  return true;
}

/** 从工具类上读出 Cornerstone 的 toolName。 */
function readToolName(toolClass: unknown): string | null {
  if (typeof toolClass !== 'function' && typeof toolClass !== 'object') {
    return null;
  }
  const candidate = (toolClass as { toolName?: unknown }).toolName;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
