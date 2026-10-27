/**
 * 极简路由。
 *
 * ## 为什么自己写
 *
 * 项目依赖是锁定的（Spec §4），没有引入 react-router —— 这不是遗漏，
 * 而是「不为一个路由表引入 20KB 运行时」的取舍。阅片工作台的性能预算
 * 全部留给 Canvas（AC-05 首帧 ≤3s），路由层不该分走注意力。
 *
 * 实现范围刻意收窄到本项目需要的四类路由：
 * - 静态路由（`/login`、`/worklist`）
 * - 单参数路由（`/viewer/:studyUid`、`/reports/:reportId`）
 * - 404 兜底
 *
 * 使用 History API 而非 hash 路由：hash 会出现在病历截图与打印件里，
 * 且与阅片网关的 URL 前缀冲突风险更高。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** 路由参数。 */
export type RouteParams = Readonly<Record<string, string>>;

/** 路由匹配结果。 */
export interface RouteMatch {
  /** 匹配到的路径模式。 */
  readonly pattern: string;
  /** 路径参数。 */
  readonly params: RouteParams;
}

/** 路由上下文值。 */
export interface RouterContextValue {
  /** 当前 URL 路径（不含 query 与 hash）。 */
  readonly pathname: string;
  /** 匹配结果。null 表示未匹配到任何路由。 */
  readonly match: RouteMatch | null;
  /** 导航。 */
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

/** 读取路由上下文。必须在 RouterProvider 内部使用。 */
export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter 必须在 RouterProvider 内部使用');
  }
  return context;
}

/**
 * 把路径模式与实际路径做匹配。
 *
 * 支持 `:param` 形式的单段参数。模式 `/viewer/:studyUid` 匹配
 * `/viewer/1.2.840.10008...`，参数 `studyUid` 取实际路径段。
 *
 * @returns 匹配结果；不匹配返回 null。
 */
export function matchPath(pattern: string, pathname: string): RouteMatch | null {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];
    if (patternSegment === undefined || pathSegment === undefined) {
      return null;
    }
    if (patternSegment.startsWith(':')) {
      const name = patternSegment.slice(1);
      if (pathSegment.length === 0) {
        return null;
      }
      params[name] = decodeURIComponent(pathSegment);
      continue;
    }
    if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return { pattern, params };
}

/** 去掉首尾斜杠并按 `/` 切分。 */
function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** 路由提供者属性。 */
export interface RouterProviderProps {
  /** 路由模式列表。按顺序匹配，第一个命中者生效。 */
  readonly routes: ReadonlyArray<string>;
  children: ReactNode;
}

/**
 * 路由提供者。
 *
 * 监听 `popstate` 处理浏览器前进/后退。
 */
export function RouterProvider({ routes, children }: RouterProviderProps) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      if (options?.replace) {
        window.history.replaceState({}, '', to);
      } else {
        window.history.pushState({}, '', to);
      }
      setPathname(window.location.pathname);
    },
    [],
  );

  const match = useMemo(() => {
    for (const route of routes) {
      const result = matchPath(route, pathname);
      if (result) {
        return result;
      }
    }
    return null;
  }, [routes, pathname]);

  const value = useMemo<RouterContextValue>(
    () => ({ pathname, match, navigate }),
    [pathname, match, navigate],
  );

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

/**
 * 声明式导航。
 *
 * 用真实的 `<a href>` 而不是 `<div onClick>`：中键点击新标签页、
 * 右键复制链接地址这些浏览器原生行为必须保留 —— 阅片工作台的
 * 「查看影像」链接经常被贴进病历讨论。
 */
export interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onNavigate?: () => void;
}

/**
 * 导航链接。
 */
export function Link({
  to,
  children,
  className,
  title,
  'aria-label': ariaLabel,
  onNavigate,
}: LinkProps) {
  const { navigate } = useRouter();

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // 允许浏览器处理新标签页与下载等修饰键操作。
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
    onNavigate?.();
  };

  return (
    <a
      href={to}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
