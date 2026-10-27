import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { enterAuditContext, isBusinessAuditCommitted } from './audit-context.js';

/**
 * 审计钩子。
 *
 * 设计要点（架构方案 §10.4）：
 *
 * 1. 挂在 **onRequest** ��非业务层。原因：业务代码可能忘记调用审计，
 *    而且**失败路径（越权被拒）同样必须审计** —— 只记成功事件的审计
 *    在等保测评里等于没有。
 *
 * 2. 审计写入走**专用账号 app_audit**（只对 audit_logs 有 INSERT 与 SELECT，
 *    碰不到业务数据）。业务账号即便被攻破也改不了审计。
 *
 * 3. 审计写入失败**不得**放行业务请求 —— 审计丢失是不可接受的，
 *    应当拒绝并告警（fail-closed）。
 *
 * 4. 记录内容：事件时间、操作人、事件类型、是否成功、患者标识、来源 IP、
 *    终端标识 + hash chain（hash_prev / hash_self）。
 *
 * ## 为什么用 onSend 而不是 onRequest 里 hijack
 *
 * 早期实现在 onRequest 里 `reply.hijack()` 并改写 `reply.send`，
 * 但那是**假 fail-closed**：审计写入是 `void writer.append(...)`（即发即忘），
 * 响应早已发出，审计失败时再想改状态码已经来不及 ——
 * 请求实际上被放行了，而审计事件丢失。
 *
 * 现在改为：**onRequest 记录上下文 + onSend 真正写审计**。
 * Fastify 的 onSend 钩子会被 await：
 *   - 审计写成功 -> 正常返回载荷
 *   - 审计写失败 -> 抛异常 -> Fastify 错误处理器返回 500，请求被真正拒绝
 * 失败路径与成功路径走**同一条**代码路径，不存在「只有成功才审计」的漏洞。
 */

export interface AuditEvent {
  actorId: string | null;
  actorRoles: string[];
  eventType: string;
  result: 'success' | 'denied' | 'failure';
  resultCode?: number;
  patientId?: string | null;
  resourceType: string;
  resourceId: string;
  sourceIp?: string | null;
  terminalId?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

/** 去掉查询串。split 的索引结果在 noUncheckedIndexedAccess 下是 string | undefined */
function pathOf(request: FastifyRequest): string {
  const raw = request.url ?? '';
  const withoutQuery = raw.split('?')[0] ?? '';
  return withoutQuery;
}

/**
 * 路由模式 -> 审计事件类型。
 *
 * key 是 Fastify 的**路由模式**（`request.routeOptions.url`），
 * 不是实际 URL —— 实际 URL 含参数值（如 studyUid），
 * 而参数值是 PHI，不能进审计的 key 维度。
 *
 * 之所以用路由模式而不是「资源类型 + 方法」：
 * `GET /studies` 与 `GET /studies/{studyUid}/series` 都是「studies + get」，
 * 但它们对应**不同的**契约事件（STUDY_LIST_VIEWED / STUDY_SERIES_VIEWED）。
 * 粒度太粗会让审计无法区分「看了列表」与「看了序列」，
 * 而这正是质控追溯时最常问的问题。
 */
const ROUTE_EVENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['/api/v1/auth/login', 'auth.login'],
  ['/api/v1/studies', 'studies.list'],
  ['/api/v1/studies/:studyUid/series', 'studies.series'],
  ['/api/v1/wado/instances', 'wado.instances'],
  ['/api/v1/segmentation-tasks', 'segmentation-tasks.submit'],
  ['/api/v1/segmentation-tasks/:taskId', 'segmentation-tasks.read'],
  ['/api/v1/segmentation-tasks/:taskId/confirm', 'segmentation-tasks.confirm'],
  ['/api/v1/plans', 'plans.create'],
  ['/api/v1/plans/:planId', 'plans.update'],
  ['/api/v1/reports/:reportId', 'reports.read'],
  ['/api/v1/reports/:reportId/sign', 'reports.sign'],
  ['/api/v1/audit-logs', 'audit-logs.query'],
]);

/**
 * 从请求路径推断资源类型与 ID。
 *
 * 路径形如 /api/v1/studies/{studyUid}/series
 * 资源类型取第一段，资源 ID 取第一段路径参数。
 */
function inferResource(request: FastifyRequest): { type: string; id: string } {
  const segments = pathOf(request).split('/').filter(Boolean);
  // /api/v1/{resource}/...
  const resourceIdx = segments.indexOf('v1');
  const type = resourceIdx >= 0 ? (segments[resourceIdx + 1] ?? 'unknown') : 'unknown';
  const paramValues = request.params ? Object.values(request.params) : [];
  const id = paramValues.length > 0 ? String(paramValues[0]) : '-';
  return { type, id };
}

/** 该路径是否涉及患者数据（PHI），决定是否强制审计 */
function isPhiPath(request: FastifyRequest): boolean {
  const url = pathOf(request);
  return (
    url.includes('/studies') ||
    url.includes('/series') ||
    url.includes('/wado') ||
    url.includes('/plans') ||
    url.includes('/reports') ||
    url.includes('/segmentation-tasks') ||
    url.includes('/audit-logs') ||
    url.includes('/auth')
  );
}

export function registerAuditHook(app: NestFastifyApplication): void {
  const writer = app.get<AuditWriter>('AUDIT_WRITER', { strict: false });
  const fastify = app.getHttpAdapter().getInstance();

  // ---- 第一步：onRequest 记录上下文 ----
  // 此时还不知道最终结果码与 HTTP 状态，只记「谁、访问了什么」。
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // 进入请求级审计上下文。业务层据此判断「审计是否已同事务写入」
    enterAuditContext();

    if (!isPhiPath(request)) return;

    const { type, id } = inferResource(request);
    const session = (request as FastifyRequest & {
      session?: { userId?: string; roles?: string[] };
    }).session;

    const context: AuditContext = {
      actorId: session?.userId ?? null,
      actorRoles: session?.roles ?? [],
      eventType: resolveEventType(request),
      resourceType: type,
      resourceId: id,
      sourceIp: request.ip,
      detail: { method: request.method, path: pathOf(request) },
    };
    (request as FastifyRequest & { auditContext?: AuditContext }).auditContext = context;
  });

  // ---- 第二步：onSend 真正写审计 ----
  // onSend 会被 await：审计写失败时抛异常，Fastify 错误处理器返回 500，
  // 请求**真正**被拒绝（而不是「响应已发出才发现审计丢了」）。
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const context = (request as FastifyRequest & { auditContext?: AuditContext })
        .auditContext;
      if (!context) return payload;

      // 业务层已在同一事务内写入并提交审计（写操作的场景）。
      // 此处不再重复写 —— 否则同一次请求会有两条审计记录。
      //
      // 注意：事务**回滚**时业务层不会设置该标记，
      // 因此失败路径仍会由这里补写一条失败审计（架构方案 §10.4）。
      if (isBusinessAuditCommitted()) return payload;

      const status = reply.statusCode;
      const result: AuditEvent['result'] =
        status === 401 || status === 403 || status === 404
          ? 'denied'
          : status >= 500
            ? 'failure'
            : 'success';

      const codeFromBody =
        payload && typeof payload === 'object' && 'code' in payload
          ? Number((payload as { code: unknown }).code)
          : undefined;

      try {
        await writer.append({
          actorId: context.actorId,
          actorRoles: context.actorRoles,
          eventType: context.eventType,
          result,
          resultCode: codeFromBody,
          resourceType: context.resourceType,
          resourceId: context.resourceId,
          sourceIp: context.sourceIp,
          detail: context.detail,
        });
      } catch (err) {
        // fail-closed：审计写不进去就不能放行。
        // 抛出去由 Fastify 错误处理器转成 500 —— 响应尚未发出，
        // 因此这是真正的「拒绝」，而不是事后补救。
        request.log.error({ err }, '审计写入失败，拒绝该请求');
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          '审计写入失败，请求已拒绝',
          500
        );
      }

      return payload;
    }
  );
}

/** 请求级审计上下文 */
interface AuditContext {
  actorId: string | null;
  actorRoles: string[];
  eventType: string;
  resourceType: string;
  resourceId: string;
  sourceIp: string | null;
  detail: Record<string, unknown>;
}

/**
 * 解析审计事件类型。
 *
 * 优先用路由模式（精确）；取不到时退回到「资源类型.方法」（粗粒度但可用）。
 * 未知路径给一个确定的兜底值 —— 绝不返回空串，
 * 因为空串会让审计记录失去可追溯性。
 */
function resolveEventType(request: FastifyRequest): string {
  const routePattern = request.routeOptions?.url;
  if (routePattern) {
    const mapped = ROUTE_EVENT_TYPES.get(routePattern);
    if (mapped) return mapped;
  }
  const { type } = inferResource(request);
  return `${type}.${request.method.toLowerCase()}`;
}

export { AppError };
