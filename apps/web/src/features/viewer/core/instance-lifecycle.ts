/**
 * GPU 资源生命周期登记簿。
 *
 * ## 为什么需要这一层
 *
 * Cornerstone3D 的工具有三种资源，泄漏方式各不相同，但后果一样 ——
 * 长时间阅片会话必然崩标签页：
 *
 * | 资源 | 分配点 | 释放点 | 漏了会怎样 |
 * |------|--------|--------|------------|
 * | WebGL 上下文 / vtkActor | `RenderingEngine.enableElement` | `renderingEngine.destroy()` | GPU 显存耗尽，浏览器回收整个上下文 |
 * | 工具实例与事件监听 | `toolGroup.addTool` + `setToolActive` | `setToolPassive` + `destroyToolGroup` | 每次切阅片多一份事件监听，翻页越来越卡 |
 * | 体数据与图像缓存 | `cache.putVolumeLoadObject` | `cache.removeVolumeLoadObject` | 512×512×300 的 Int16 体约 150MB/序列，几十个序列直接 OOM |
 *
 * 因此本模块提供**单一登记簿**：所有需要在 unmount 时释放的东西，
 * 在申请时登记一份成对的 `dispose`，在组件卸载时统一执行。
 *
 * ## 配对原则（Spec §10「GPU 资源生命周期」）
 *
 * - 每次 `register` 必定对应一次 `dispose`，没有「只申请不释放」的路径。
 * - 释放按**后进先出**执行：后注册的先释放（体数据先于渲染引擎释放，
 *   否则渲染引擎析构时还会引用体数据的纹理）。
 * - `dispose` 幂等：重复调用不抛错，避免 React 严格模式下的双挂载把问题放大。
 */

/** 一条待释放的资源登记。 */
export interface ResourceDisposer {
  /** 仅用于开发期排查的描述，不参与业务逻辑。 */
  readonly label: string;
  /** 真正的释放动作。必须幂等。 */
  readonly dispose: () => void;
}

/** 登记簿的公开接口。 */
export interface LifecycleLedger {
  /**
   * 登记一条待释放资源。
   *
   * @param label 排查用描述，例如 `'rendering-engine:viewer-1'`
   * @param dispose 释放动作。必须自身幂等 —— 框架可能重复调用。
   * @returns 一个注销函数。若在资源已被释放后调用，返回的注销函数是空操作。
   */
  register(label: string, dispose: () => void): () => void;
  /** 释放全部已登记资源（后进先出）。 */
  disposeAll(): void;
  /** 当前仍未释放的登记条数，供自检与调试使用。 */
  readonly pendingCount: number;
}

/**
 * 创建一个生命周期登记簿。
 *
 * @param onError 单条释放失败时的回调。默认吞掉异常 ——
 *   一条资源释放失败不应该阻断其余资源的释放，否则后续泄漏会被掩盖。
 */
export function createLifecycleLedger(
  onError?: (label: string, error: unknown) => void,
): LifecycleLedger {
  const entries: ResourceDisposer[] = [];
  let disposed = false;

  const report = (label: string, error: unknown): void => {
    if (onError) {
      onError(label, error);
    }
  };

  return {
    register(label: string, dispose: () => void): () => void {
      if (disposed) {
        // 登记簿已整体释放：立即释放本次资源，避免新登记的资源永久滞留。
        try {
          dispose();
        } catch (error) {
          report(label, error);
        }
        return () => undefined;
      }

      const entry: ResourceDisposer = { label, dispose };
      entries.push(entry);

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const index = entries.indexOf(entry);
        if (index >= 0) {
          entries.splice(index, 1);
        }
        try {
          dispose();
        } catch (error) {
          report(label, error);
        }
      };
    },

    disposeAll(): void {
      disposed = true;
      // 后进先出：后申请的资源先释放。
      while (entries.length > 0) {
        const entry = entries.pop();
        if (!entry) {
          continue;
        }
        try {
          entry.dispose();
        } catch (error) {
          report(entry.label, error);
        }
      }
    },

    get pendingCount(): number {
      return entries.length;
    },
  };
}
