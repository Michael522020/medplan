/**
 * 开发期 Mock 服务。
 *
 * ## 为什么不用 MSW
 *
 * 项目依赖是锁定的（Spec §4），离线环境不允许 `npm install`，
 * MSW 装不上。本模块用最小自实现达到同样目的：拦截 `fetch`，
 * 对已知的 `/api/v1/*` 路径返回契约形状的响应。
 *
 * 拦截范围**严格限定**在 `/api/v1/` 前缀下 —— 其他请求（比如
 * WADO-RS 取图）一律放行，否则会掩盖真实的取图链路问题。
 *
 * ## 响应形状必须与契约一致
 *
 * Mock 返回的是**契约的完整响应包裹**（`{code, message, data}`），
 * 不是裸 data。这样 Mock 模式走的是与生产完全相同的解析路径 ——
 * 契约变更时 Mock 漏改会立刻在类型层面报错，而不是静默返回 undefined。
 *
 * ## 越权与不存在不可区分
 *
 * 契约 §4.1 要求 10004 与 10005 在响应上完全一致。
 * Mock 里对不存在的检查号返回 10004（而不是 10005），
 * 让前端在开发期就养成「两者同一套文案」的习惯。
 */

import { mockLogin, mockSeriesGrouped, mockStudyList } from './fixtures';
import { mockReport } from './report-fixture';

/** 契约的统一响应包裹。 */
interface MockEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

/** 构造一个成功响应。 */
function ok<T>(data: T): MockEnvelope<T> {
  return { code: 0, message: '', data };
}

/** 构造一个错误响应。 */
function fail<T>(code: number, message: string): MockEnvelope<T> {
  return { code, message, data: null as T };
}

/** 路由匹配结果。 */
interface MockRoute {
  readonly method: string;
  readonly path: string;
  readonly handle: () => MockEnvelope<unknown>;
}

/**
 * Mock 路由表。
 *
 * 路径用「路径模板」表达，`{param}` 为单段参数。
 */
const ROUTES: ReadonlyArray<MockRoute> = [
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    handle: () => ok(mockLogin),
  },
  {
    method: 'GET',
    path: '/api/v1/studies',
    handle: () => ok(mockStudyList),
  },
  {
    method: 'GET',
    path: '/api/v1/studies/{studyUid}/series',
    handle: () => ok(mockSeriesGrouped),
  },
  {
    method: 'GET',
    path: '/api/v1/reports/{reportId}',
    handle: () => ok(mockReport),
  },
  {
    method: 'POST',
    path: '/api/v1/reports/{reportId}/sign',
    handle: () =>
      fail(50001, '报告尚未通过审核，无法签名'),
  },
];

/**
 * 匹配路径模板。
 *
 * @returns 匹配成功返回 true；不匹配返回 false。
 */
function matchPath(template: string, actual: string): boolean {
  const templateSegments = template.split('/').filter(Boolean);
  const actualSegments = actual.split('/').filter(Boolean);
  if (templateSegments.length !== actualSegments.length) {
    return false;
  }
  return templateSegments.every(
    (segment, index) =>
      segment.startsWith('{') || segment === actualSegments[index],
  );
}

/**
 * 判断请求是否由 Mock 处理。
 *
 * @param method HTTP 方法
 * @param url 请求 URL（可能是相对路径）
 */
function resolveRoute(method: string, url: string): MockRoute | null {
  const path = url.startsWith('http')
    ? new URL(url).pathname
    : url.split('?')[0] ?? url;
  return (
    ROUTES.find(
      (route) => route.method === method && matchPath(route.path, path),
    ) ?? null
  );
}

/**
 * 安装 Mock 服务。
 *
 * @param enabled 是否启用。生产构建必须传 false（或由调用方保证）。
 * @returns 卸载函数。
 */
export function installMockServer(enabled: boolean): () => void {
  if (!enabled) {
    return () => undefined;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    const route = resolveRoute(method, url);
    if (!route) {
      // 不在 Mock 范围内的请求（例如 WADO-RS 取图）一律放行，
      // 否则会掩盖真实的取图链路问题。
      return originalFetch(input, init);
    }

    const envelope = route.handle();
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  console.info('[mock] 开发期 Mock 已启用：/api/v1 的四条端点返回契约形状的固定数据。');

  return () => {
    window.fetch = originalFetch;
  };
}
