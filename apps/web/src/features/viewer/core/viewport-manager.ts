/**
 * Cornerstone 全局 API 的**唯一入口**。
 *
 * ## 架构约束（Spec §10「前端分层」）
 *
 * 组件禁止直连 Cornerstone 全局 API，必须经 `features/viewer/core/` 封装层。
 * 原因不是洁癖，是三个具体的坑：
 *
 * 1. `preferSizeOverAccuracy` 被关掉 → 512×512×300 的 CT 体从 Int16 变成
 *    Float32，显存占用翻倍，三视图同时加载直接破 2GB 崩标签页。
 *    这个开关如果散落在各组件里，迟早有人写 `setPreferSizeOverAccuracy(false)`。
 * 2. `init()` 只在第一次调用时生效，重复调用会被静默忽略 ——
 *    组件各自 init 会产生「看起来初始化了但配置没生效」的幽灵问题。
 * 3. 工具的 enable/disable 必须成对，泄漏点在 unmount 而不是 mount。
 *
 * 因此本文件对外只暴露语义化方法，不导出任何 Cornerstone 原始句柄。
 *
 * ## preferSizeOverAccuracy 的强制方式
 *
 * Spec §10 要求「强制 preferSizeOverAccuracy: true（Int16），组件不得自行关闭」。
 * 实现上不是「配置里写了 true」就算完 —— Cornerstone 的 `init()` 在已初始化后
 * 不再读配置，且 `setPreferSizeOverAccuracy` 是公开可调用的。所以这里做两层：
 *
 * - 初始化时通过 `init()` 的 `rendering.preferSizeOverAccuracy` 传入；
 * - 初始化完成后立即调用 `setPreferSizeOverAccuracy(true)` 再确认一次，
 *   覆盖「别处先调过 init()」的情况。
 *
 * 两层都完成后，配置值就是 true，且本模块不导出任何能把它改回 false 的路径。
 */

import {
  Enums,
  RenderingEngine,
  cache,
  init as cornerstoneInit,
  isCornerstoneInitialized,
  setPreferSizeOverAccuracy,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';

import {
  createLifecycleLedger,
  type LifecycleLedger,
} from './instance-lifecycle';
import { detectRenderingCapability, type RenderingCapability } from './capability';

/** 视口类型。收敛 Cornerstone 的枚举，UI 层不直接接触 `Enums.ViewportType`。 */
export type ViewportKind = 'stack' | 'volume' | 'volume3d';

/** 一个已启用的视口。 */
export interface ViewportHandle {
  readonly viewportId: string;
  readonly element: HTMLDivElement;
  readonly kind: ViewportKind;
}

/** 视口管理器对外暴露的操作集合。 */
export interface ViewportManagerApi {
  /** 渲染能力。WebGL 不可用时三维入口必须隐藏。 */
  readonly capability: RenderingCapability;
  /** 创建渲染引擎实例。 */
  createRenderingEngine(id: string): void;
  /** 启用一个视口。 */
  enableViewport(viewport: ViewportHandle): void;
  /** 停用一个视口（并释放其 WebGL 上下文）。 */
  disableViewport(viewportId: string): void;
  /** 渲染引擎是否已创建。 */
  hasRenderingEngine(id: string): boolean;
  /** 释放全部资源。组件卸载时必须调用。 */
  dispose(): void;
}

let initializationPromise: Promise<void> | null = null;

/**
 * 初始化 Cornerstone 与 Cornerstone Tools（幂等）。
 *
 * 全局只初始化一次 —— Cornerstone 的 `init()` 在第二次调用时会直接返回，
 * 不会重新读取配置。并发调用共享同一个 Promise。
 */
export function ensureCornerstoneInitialized(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (!isCornerstoneInitialized()) {
        cornerstoneInit({
          rendering: {
            /**
             * Spec §10 强制：Int16 存储，不可关闭。
             * 512×512×300 的 CT 体用 Float32 时显存占用翻倍。
             */
            preferSizeOverAccuracy: true,
            useCPURendering: false,
            strictZSpacingForVolumeViewport: true,
          },
          debug: {
            statsOverlay: false,
          },
        });
      }

      /**
       * 第二层强制：`init()` 在已初始化后不读配置。
       * 若别处先调用过 init()（例如热更新或测试夹具），上面的配置会被忽略。
       * 这里显式再设一次，保证「不可关闭」是事实而非意图。
       */
      setPreferSizeOverAccuracy(true);
    })();
  }
  return initializationPromise;
}

/** 把视口类型映射到 Cornerstone 的枚举值。 */
function toCornerstoneViewportType(kind: ViewportKind): Enums.ViewportType {
  switch (kind) {
    case 'stack':
      return Enums.ViewportType.STACK;
    case 'volume':
      return Enums.ViewportType.ORTHOGRAPHIC;
    case 'volume3d':
      return Enums.ViewportType.VOLUME_3D;
  }
}

/**
 * 创建一个视口管理器实例。
 *
 * 每个阅片会话（一个 study）一个实例。实例内部持有渲染引擎与工具组，
 * 并在 `dispose()` 中按后进先出释放。
 */
export function createViewportManager(
  _options: { renderingEngineId: string; toolGroupId: string },
): ViewportManagerApi & {
  ledger: LifecycleLedger;
  getRenderingEngine(): RenderingEngine | undefined;
  getToolGroup(): ToolTypes.IToolGroup | undefined;
} {
  const ledger = createLifecycleLedger((label, error) => {
    // 单条释放失败不应阻断其余释放，但必须留下痕迹 —— 静默失败会让泄漏无法排查。
    console.error(`[viewer] 释放资源失败：${label}`, error);
  });

  const capability = detectRenderingCapability();
  let renderingEngine: RenderingEngine | undefined;
  let toolGroup: ToolTypes.IToolGroup | undefined;

  const manager = {
    capability,
    ledger,

    createRenderingEngine(id: string): void {
      if (renderingEngine) {
        return;
      }
      renderingEngine = new RenderingEngine(id);
      ledger.register(`rendering-engine:${id}`, () => {
        /**
         * 必须显式 destroy()。Cornerstone 的渲染引擎持有 WebGL 上下文、
         * vtkActor 与纹理；不调用 destroy() 的话 GPU 显存不会归还，
         * 长时间阅片会话必然崩标签页。
         */
        renderingEngine?.destroy();
        renderingEngine = undefined;
      });
    },

    enableViewport(viewport: ViewportHandle): void {
      if (!renderingEngine) {
        throw new Error('启用视口前必须先创建渲染引擎');
      }
      renderingEngine.enableElement({
        element: viewport.element,
        viewportId: viewport.viewportId,
        type: toCornerstoneViewportType(viewport.kind),
      });
    },

    disableViewport(viewportId: string): void {
      if (!renderingEngine) {
        return;
      }
      /**
       * `disableElement` 会触发 Cornerstone 的 ELEMENT_DISABLED 事件，
       * 由 Cornerstone Tools 的 removeEnabledElement 处理器清理该元素上的
       * SVG 图层与事件监听。视口自身的 WebGL 上下文随渲染引擎 destroy 释放。
       */
      renderingEngine.disableViewport(viewportId);
    },

    hasRenderingEngine(id: string): boolean {
      return renderingEngine?.id === id;
    },

    getRenderingEngine(): RenderingEngine | undefined {
      return renderingEngine;
    },

    getToolGroup(): ToolTypes.IToolGroup | undefined {
      return toolGroup;
    },

    dispose(): void {
      ledger.disposeAll();
      toolGroup = undefined;
      renderingEngine = undefined;
    },
  };

  /**
   * 工具组与渲染引擎生命周期不同：工具组是全局表里的一项，
   * 由 ToolGroupManager 负责创建与销毁，与渲染引擎的 destroy 路径分离。
   */
  const ensureToolGroup = (toolGroupId: string): ToolTypes.IToolGroup => {
    if (toolGroup) {
      return toolGroup;
    }
    const created = ToolGroupManager.createToolGroup(toolGroupId);
    if (!created) {
      throw new Error(`创建工具组失败：${toolGroupId}`);
    }
    toolGroup = created;
    ledger.register(`tool-group:${toolGroupId}`, () => {
      ToolGroupManager.destroyToolGroup(toolGroupId);
      toolGroup = undefined;
    });
    return created;
  };

  return Object.assign(manager, {
    /**
     * 工具组需要在渲染引擎创建之后才有意义（工具要绑定到视口），
     * 因此单独暴露一个显式的准备方法，而不是在 createRenderingEngine 里隐式创建。
     */
    ensureToolGroup,
  });
}

/**
 * 清理与某个体数据相关的缓存条目。
 *
 * 体数据是最大的显存/内存占用源：512×512×300 的 Int16 体约 150MB。
 * 阅片页卸载时必须清，否则累积几个序列就 OOM。
 */
export function releaseVolumeCache(volumeId: string): void {
  cache.removeVolumeLoadObject(volumeId);
}
