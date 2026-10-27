/**
 * 错误边界。
 *
 * ## 为什么必须有
 *
 * `Suspense` 只处理 **pending**，不处理 **reject**。
 * 阅片区要下载 4MB 的 Cornerstone chunk（gzip 后 1.1MB），
 * 在院内网络上失败的概率不低。没有错误边界的失败形态是：
 * 整个 React 树白屏，医生看到一片空白，
 * 既不知道发生了什么，也没有重试的入口 —— 这是最坏的失败形态。
 *
 * 有了错误边界，失败会变成一个可读的卡片：
 * 说清「阅片模块加载失败」、给出「重试」按钮、给出联系信息科的入口。
 *
 * ## 为什么必须是 class
 *
 * React 的错误边界只能用 class 组件实现（没有 hook 版本）。
 * 这不是为了兼容旧代码，是 React 的硬约束。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconRefresh } from '@/components/icons';

/** 错误边界的属性。 */
export interface ErrorBoundaryProps {
  /** 出错时展示的内容。默认给出通用的加载失败提示。 */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 错误回调。用于上报。 */
  readonly onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children: ReactNode;
}

/** 错误边界的内部状态。 */
interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * 错误边界。
 *
 * @example
 * <ErrorBoundary fallback={(error, reset) => <LoadFailed error={error} onRetry={reset} />}>
 *   <LazyViewerPage />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    console.error('[ui] 渲染失败', error, errorInfo.componentStack);
  }

  /** 重置错误状态，让子树重新渲染（并触发懒加载组件重新请求 chunk）。 */
  readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <EmptyState
        kind="unreachable"
        title="阅片模块加载失败"
        description="请检查网络连接后重试；若持续失败，请联系信息科。"
        action={
          <Button icon={IconRefresh} onClick={this.reset}>
            重试
          </Button>
        }
      />
    );
  }
}
