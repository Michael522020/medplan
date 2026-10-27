/**
 * 应用外壳。
 *
 * ## 入口只装配，业务在 feature 里
 *
 * 本文件只做三件事：提供路由上下文、按路由渲染页面、装配全局 chrome。
 * 任何业务判断（数据拉取、权限判定、状态机）都不该出现在这里。
 */

import { useCallback, useEffect, useState } from 'react';

import { AppHeader } from '@/components/layout/app-header';
import { AppStatusBar } from '@/components/layout/app-status-bar';
import { RouterProvider, useRouter } from '@/lib/router';
import { setTokenReader } from '@/services/api-client';
import { readSession, type Session } from '@/services/session';

import { LoginPage } from '@/features/auth/login-page';
import { ReportPage } from '@/features/reports/report-page';
import { LazyViewerPage } from '@/features/viewer/lazy-viewer-page';
import { WorklistPage } from '@/features/worklist/worklist-page';

import { getCurrentTheme, toggleTheme } from '@/theme/theme';

/** 路由表。顺序即匹配优先级。 */
const ROUTES = ['/login', '/worklist', '/viewer/:studyUid', '/reports/:reportId'];

/** 应用版本号。显示在底部状态栏。 */
const APP_VERSION = 'v1.0.0';

/**
 * 应用根组件。
 */
export function App() {
  return (
    <RouterProvider routes={ROUTES}>
      <AppShell />
    </RouterProvider>
  );
}

/**
 * 应用骨架。
 *
 * 负责路由分发与全局 chrome（顶栏、底栏）。
 */
function AppShell() {
  const { match, navigate } = useRouter();
  const [theme, setTheme] = useState(getCurrentTheme);
  const [session, setSession] = useState<Session | null>(readSession);

  /**
   * 把令牌读取器注入 API 客户端。
   *
   * 必须在任何请求之前完成，否则请求不带 Authorization。
   */
  useEffect(() => {
    setTokenReader(() => readSession()?.accessToken ?? null);
  }, []);

  const onToggleTheme = useCallback(() => {
    setTheme(toggleTheme());
  }, []);

  const onLoginSuccess = useCallback(
    (next: Session) => {
      setSession(next);
      navigate('/worklist');
    },
    [navigate],
  );

  // 未登录时只允许停留在登录页。
  useEffect(() => {
    if (!session && match?.pattern !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [match?.pattern, navigate, session]);

  if (match?.pattern === '/login') {
    return (
      <div className="app-root app-root--login">
        <LoginPage onSuccess={onLoginSuccess} />
      </div>
    );
  }

  if (!session) {
    return <div className="app-root" />;
  }

  return (
    <div className="app-root">
      <AppHeader
        theme={theme}
        onToggleTheme={onToggleTheme}
        userName={session.user.displayName}
        breadcrumbs={buildBreadcrumbs(match?.pattern)}
      />

      <main className="app-root__main">
        <RouteView match={match} />
      </main>

      <AppStatusBar
        pacsState="unknown"
        userLabel={`${session.user.displayName} · ${session.user.title}`}
        version={APP_VERSION}
      />
    </div>
  );
}

/** 路由分发。 */
interface RouteViewProps {
  readonly match: ReturnType<typeof useRouter>['match'];
}

/**
 * 路由分发。
 *
 * 每条路由渲染一个 feature 的页面组件。
 */
function RouteView({ match }: RouteViewProps) {
  const { navigate } = useRouter();

  switch (match?.pattern) {
    case '/worklist':
      return (
        <WorklistPage
          onOpenStudy={(studyUid) => navigate(`/viewer/${studyUid}`)}
          onOpenReport={(reportId) => navigate(`/reports/${reportId}`)}
        />
      );
    case '/viewer/:studyUid':
      return (
        /**
         * 阅片页懒加载。Cornerstone 全家桶约 4MB（gzip 1.1MB），
         * 静态引入会让工作台首屏就下载它 —— 而工作台根本不需要阅片能力。
         * 详见 `features/viewer/lazy-viewer-page.tsx`。
         */
        <LazyViewerPage studyUid={match.params.studyUid ?? ''} />
      );
    case '/reports/:reportId':
      return <ReportPage reportId={match.params.reportId ?? ''} />;
    default:
      return (
        <WorklistPage
          onOpenStudy={(studyUid) => navigate(`/viewer/${studyUid}`)}
        />
      );
  }
}

/** 面包屑。 */
function buildBreadcrumbs(
  pattern: string | undefined,
): ReadonlyArray<{ label: string }> {
  switch (pattern) {
    case '/worklist':
      return [{ label: '医学影像科' }, { label: '工作台' }];
    case '/viewer/:studyUid':
      return [{ label: '医学影像科' }, { label: '阅片工作台' }];
    case '/reports/:reportId':
      return [{ label: '医学影像科' }, { label: '报告编辑与签名' }];
    default:
      return [];
  }
}
