/**
 * 阅片运行时（Cornerstone 初始化 + GPU 资源生命周期）。
 *
 * ## 这个 Hook 存在的唯一理由
 *
 * GPU 资源的释放必须与申请**成对**，且发生在组件卸载时。
 * 把这段逻辑写在页面组件里，开发者很容易在重构时漏掉 cleanup ——
 * 而漏掉的代价是「长时间阅片会话必然崩标签页」，且**不会**在开发期暴露。
 *
 * 因此它独立成 Hook，语义边界与 React 的生命周期对齐：
 * 建立资源 → 组件卸载时自动释放。
 *
 * ## 释放顺序
 *
 * 由 core 层的登记簿保证后进先出：
 * 渲染引擎的 WebGL 上下文 → 工具组的事件监听 → 体数据缓存。
 * 顺序反了会让渲染引擎析构时仍引用已释放的纹理。
 */

import { useEffect, useRef, useState } from 'react';

import {
  ALL_TOOL_CLASSES,
  applyMeasurementAnnotationStyle,
  configureDicomAuth,
  createViewportManager,
  detectRenderingCapability,
  ensureCornerstoneInitialized,
  initializeJpeg2000Decoder,
  registerTool,
  type ViewportManagerApi,
} from '../core';

/** 运行时 Hook 的返回值。 */
export interface UseViewerRuntimeResult {
  /** 渲染引擎管理器。初始化完成前为 null。 */
  readonly manager: ViewportManagerApi | null;
  /** WebGL 是否可用。false 时必须降级 2D 并隐藏三维入口。 */
  readonly webglAvailable: boolean;
}

/**
 * 初始化阅片运行时。
 *
 * @param studyUid 检查 uid。用于生成唯一的渲染引擎与工具组 id ——
 *   不同检查的视口不能共用同一个渲染引擎，否则切检查时上下文串了。
 *
 * 令牌来源不需要传参：WADO-RS 的认证头与普通 API 请求共用
 * `api-client` 的 token reader，登录/登出后两边同时生效。
 */
export function useViewerRuntime(
  studyUid: string,
): UseViewerRuntimeResult {
  /**
   * 用 state 而不是 ref 持有管理器 ——
   * 视口挂载回调需要读到它，而 ref 的变更不触发重渲染，
   * 首次挂载时会拿到 null（视口永远启用不了）。
   */
  const [manager, setManager] = useState<ViewportManagerApi | null>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);

  /**
   * 持有当前管理器实例，供 cleanup 直接释放。
   *
   * 不用 state 做这件事：cleanup 里的 setState 会在卸载阶段触发一次
   * 无意义的重渲染，且 React 18 的 StrictMode 下 cleanup 会跑两次，
   * 容易把「释放」与「重建」的时序搅乱。
   */
  const managerRef = useRef<ViewportManagerApi | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      /**
       * `configureDicomAuth` 必须在任何取图动作之前调用 ——
       * 否则 WADO-RS 请求不带 Authorization，表现为 401，
       * 看起来像 PACS 故障。
       */
      await ensureCornerstoneInitialized();
      configureDicomAuth();
      await initializeJpeg2000Decoder();
      if (cancelled) {
        return;
      }

      const created = createViewportManager({
        renderingEngineId: `medplan-viewer-${studyUid}`,
        toolGroupId: `medplan-tools-${studyUid}`,
      });
      managerRef.current = created;

      for (const toolClass of ALL_TOOL_CLASSES) {
        registerTool(toolClass);
      }
      applyMeasurementAnnotationStyle(`medplan-tools-${studyUid}`);
      setWebglAvailable(detectRenderingCapability().webglAvailable);
      setManager(created);
    })();

    return () => {
      cancelled = true;
      /**
       * 释放顺序由 core 层的登记簿保证（后进先出）：
       * 渲染引擎的 WebGL 上下文 → 工具组的事件监听 → 体数据缓存。
       */
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, [studyUid]);

  return { manager, webglAvailable };
}
