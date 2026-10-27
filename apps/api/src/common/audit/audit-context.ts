import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求级审计上下文。
 *
 * ## 为什么需要它
 *
 * 审计写入有两个时机，二者的原子性要求不同：
 *
 * | 场景 | 审计时机 | 原子性要求 |
 * |------|---------|-----------|
 * | 只读访问（列表/序列/取图/查报告） | 响应发出前（onSend） | 无业务写入，无需同事务 |
 * | 写操作（提交任务/建方案/签名） | **业务写入的同一事务内** | 必须同事务 |
 *
 * 写操作用户体验上更致命：若业务行已提交而审计行未写入，
 * 就出现「业务成功但无审计」的窗口 —— 进程崩溃即永久丢失审计事件，
 * 违反等保 8.1.4.3。
 *
 * ## 怎么做到同事务
 *
 * `schema.sql` 明确授予了 `app_rw` 对 audit_logs 的 INSERT 权限：
 *
 *   > GRANT INSERT ON audit_logs TO app_rw;   -- 业务服务可写审计（经审计拦截器）
 *
 * 因此业务层可以用**业务连接**（同一事务）写审计行 ——
 * 业务行与审计行要么一起提交、要么一起回滚，不存在中间态。
 *
 * 同时 `app_rw` 对 audit_logs 只有 INSERT，**没有** UPDATE/DELETE
 * （`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw`），
 * 因此「能写审计」不等于「能改审计」，防篡改的第一层保证不变。
 *
 * ## 如何避免重复写
 *
 * 业务层在事务内写完审计并提交后，通过 `markBusinessAuditCommitted()`
 * 标记本次请求已审计。审计钩子在 onSend 时检查该标记，
 * 避免同一次请求写两条审计。
 *
 * 若事务**回滚**（业务失败），标记不会被设置 ——
 * 钩子仍会写一条失败审计。这正是架构方案 §10.4 要求的：
 * 「失败路径同样必须审计」。
 *
 * ## 为什么用 AsyncLocalStorage
 *
 * 业务层（service）**不应**接触 HTTP 对象（`req`/`res`），
 * 否则违反分层铁律。ALS 传递的是上下文而非 HTTP 对象，
 * 既让 service 能参与审计协调，又不产生对 HTTP 层的依赖。
 *
 * Fastify 的 hook -> handler -> onSend 处于同一异步上下文，
 * ALS 的值在整条链路上可见（已实测验证）。
 */
interface AuditRequestState {
  /** 业务层已在同一事务内写入审计并提交，钩子无需重复写 */
  businessAuditCommitted: boolean;
}

const storage = new AsyncLocalStorage<AuditRequestState>();

/** 进入请求级审计上下文（由审计钩子在 onRequest 调用） */
export function enterAuditContext(): void {
  storage.enterWith({ businessAuditCommitted: false });
}

/**
 * 标记本次请求的业务审计已在事务内提交。
 *
 * **必须在事务提交成功之后调用** —— 事务回滚时审计行也没了，
 * 这时仍需由钩子写一条失败审计。
 */
export function markBusinessAuditCommitted(): void {
  const state = storage.getStore();
  if (state) {
    state.businessAuditCommitted = true;
  }
}

/** 本次请求的业务审计是否已在事务内提交 */
export function isBusinessAuditCommitted(): boolean {
  return storage.getStore()?.businessAuditCommitted === true;
}
