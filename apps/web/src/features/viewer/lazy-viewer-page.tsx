/**
 * 阅片页的懒加载入口。
 *
 * ## 为什么必须懒加载
 *
 * 阅片区要加载 Cornerstone3D 全家桶（约 4MB，gzip 后 1.1MB）。
 * 医生的实际路径是「登录 → 工作台（看待阅队列）→ 点进检查 → 阅片」，
 * **工作台列表页根本不需要 Cornerstone**。
 *
 * 静态引入会让这 1.1MB 在首屏就下载，阻塞工作台的可用时间。
 * 在院内网络（专线、百兆）上，这笔钱本该花在「影像准备」上，
 * 不该由工作台替阅片页预付 —— AC-05 的首帧预算只有 3 秒。
 *
 * ## 懒加载边界放在「页面」而不是「组件」
 *
 * 不对 `viewport-canvas` 等内部组件做懒加载：那会把 Cornerstone 的
 * 初始化时机打散，出现「进了页面但视口还没准备好」的中间态 ——
 * 医生会看到一个空画布，以为是影像加载失败。
 *
 * 页面级懒加载的语义是明确的：**进入阅片页 = 一次性准备好整个阅片环境**。
 *
 * ## 失败要有兜底
 *
 * `Suspense` 只处理 pending。4MB 的 chunk 在院内网络下载失败的概率不低，
 * 没有 ErrorBoundary 时失败形态是整页白屏。
 */

import { lazy, Suspense, useMemo, useState } from 'react';

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { IconAlertTriangle, IconLoader2 } from '@/components/icons';

/**
 * 阅片页（懒加载版）。
 *
 * 由路由层使用。内部包了 Suspense（pending）与 ErrorBoundary（reject）。
 */
export function LazyViewerPage(props: { studyUid: string }) {
  /**
   * 重试计数。
   *
   * ## 为什么重试必须**重建 lazy 实例**，而不能只复位错误边界
   *
   * React 19 的 `lazyInitializer` 会**永久缓存 rejection**：
   *
   * ```
   * _status: -1(未初始化) → 0(加载中) → 2(已失败)
   * ```
   *
   * 一旦 `_status = 2`，后续每次渲染都直接 `throw payload._result` ——
   * 抛出的是**同一个缓存的错误对象**，工厂函数不会被再次调用，
   * `import()` 也不会重新发起下载。
   *
   * 因此只复位错误边界的话，「重试」按钮看起来能点，但会立刻抛出
   * 同一个错误，永远不会真正重试 —— 在瞬时网络抖动下，
   * 医生点重试却永远看到同一个失败，界面看起来像是坏的。
   *
   * 正确做法：重试时**重建 lazy 实例**（新的 `_payload`，
   * `_status` 回到 -1），这样 `import()` 才会真正重新发起下载。
   * 用 `key` 挂到 ErrorBoundary 上，同时让它清空错误状态。
   */
  const [retryKey, setRetryKey] = useState(0);

  /**
   * 每次 retryKey 变化都重建 lazy 实例。
   *
   * `useMemo` 的依赖是 retryKey —— 重试即重建，未重试则复用同一个实例
   * （正常的挂载路径不会反复创建）。
   */
  const ViewerPage = useMemo(
    () => lazy(() => import('./viewer-page')),
    [retryKey],
  );

  return (
    <ErrorBoundary
      key={retryKey}
      fallback={(error) => (
        <ViewerLoadFailed
          error={error}
          onRetry={() => setRetryKey((key) => key + 1)}
        />
      )}
    >
      <Suspense fallback={<ViewerLoadingFallback />}>
        <ViewerPage studyUid={props.studyUid} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * 阅片模块加载失败的兜底。
 *
 * 必须说清「发生了什么」与「怎么办」——
 * 4MB 的 chunk 在院内网络下载失败不是罕见情况，
 * 医生需要知道是网络问题还是系统问题。
 */
function ViewerLoadFailed({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}) {
  return (
    <div className="viewer-loading" role="alert">
      <IconAlertTriangle
        size={32}
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="viewer-loading__title">阅片模块加载失败</p>
      <p className="viewer-loading__detail">
        影像渲染组件未能下载完成（{error.message || '网络中断'}）。
        请检查网络连接后重试；若持续失败，请联系信息科。
      </p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        重新加载阅片模块
      </button>
    </div>
  );
}

/**
 * 阅片页加载中的占位。
 *
 * 文案要说清「在等什么」—— 医生点进检查后等的是影像环境准备，
 * 不是网络卡住了。深色底与阅片页的 Canvas 恒暗视觉一致，
 * 避免加载完成时出现亮度突变造成的不适。
 */
function ViewerLoadingFallback() {
  return (
    <div className="viewer-loading" role="status" aria-live="polite">
      <IconLoader2
        size={32}
        strokeWidth={1.75}
        aria-hidden
        className="spin"
      />
      <p className="viewer-loading__title">正在准备阅片工作台</p>
      <p className="viewer-loading__detail">
        首次进入需加载影像渲染组件（院内网络约需数秒），随后进入检查即可直接阅片。
      </p>
    </div>
  );
}
