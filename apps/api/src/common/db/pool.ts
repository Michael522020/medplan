import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * 数据库连接池。
 *
 * ## 两套连接、两种账号（等保 8.1.4.2 权限分离）
 *
 * | 账号 | 用途 | 权限 |
 * |------|------|------|
 * | `app_rw` | 业务读写 | 业务表 SELECT/INSERT/UPDATE/DELETE；audit_logs 仅 INSERT/SELECT |
 * | `app_audit` | 审计写入 | **仅** audit_logs 的 INSERT + SELECT，碰不到任何业务表 |
 *
 * 分权理由（架构方案 §10.2）：业务账号即便被攻破，也**改不了审计**；
 * 审计账号即便被攻击，也**碰不到 PHI 业务数据**。
 * 这是审计表物理不可改的第一层保证（第二层是触发器，第三层是 hash chain）。
 *
 * 注意：`audit_logs` 在 schema.sql 里对 `app_rw` 做了
 * `REVOKE UPDATE, DELETE, TRUNCATE`，业务连接**只能追加**。
 */

/** 业务读写池的注入令牌 */
export const DB_POOL = 'DB_POOL';

/** 审计专用池的注入令牌 */
export const AUDIT_POOL = 'AUDIT_POOL';

export interface DbPoolConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 业务读写池配置。
 *
 * 连接串来自环境变量，**不得**硬编码在业务文件中（部署到不同院区时
 * 由 K8s Secret 注入）。
 */
export function businessPoolConfig(): DbPoolConfig {
  return {
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://app_rw@localhost:5432/medplan?schema=medplan',
    max: readInt(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: readInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: readInt(process.env.DB_CONNECT_TIMEOUT_MS, 5_000),
  };
}

/** 审计专用池配置 */
export function auditPoolConfig(): DbPoolConfig {
  return {
    connectionString:
      process.env.AUDIT_DATABASE_URL ??
      'postgresql://app_audit@localhost:5432/medplan?schema=medplan',
    max: readInt(process.env.AUDIT_POOL_MAX, 4),
    idleTimeoutMillis: readInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: readInt(process.env.DB_CONNECT_TIMEOUT_MS, 5_000),
  };
}

export function createPool(config: DbPoolConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    // 应用名便于在 pg_stat_activity 中定位连接归属
    application_name: 'medplan-api',
  });
}

/**
 * 事务执行器。
 *
 * 事务边界放在 **service 层**（架构方案 §5.1）：service 决定「哪几个写操作
 * 必须原子」，repository 只提供单条语句。跨多个 repository 的写操作用本函数
 * 包起来，保证要么全成、要么全回滚。
 *
 * @param pool   连接池
 * @param fn     事务体。抛异常则回滚
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误：原始错误才是根因，
      // 回滚异常只是次生现象，吞掉它会让排查走偏。
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 可执行 SQL 的对象。
 *
 * `Pool` 与 `PoolClient` 都实现了 `query`。
 * 事务内**必须**用 `PoolClient` —— 用 `Pool` 取连接可能拿到**另一个连接**，
 * 那样事务边界就失效了（业务写在事务里、审计写在事务外，
 * 就会出现「业务成功但审计丢失」的中间态）。
 */
export type Queryable = Pool | PoolClient;

/**
 * 参数化查询封装。
 *
 * **禁止**在 service / repository 中用模板字符串拼 SQL ——
 * PHI 数据 + SQL 注入是双重风险。所有取值一律走 `$1, $2, ...` 占位符。
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  executor: Queryable,
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<T>> {
  return executor.query<T>(text, params as unknown[]);
}

/** 取首行，无行返回 undefined */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  executor: Queryable,
  text: string,
  params: readonly unknown[] = []
): Promise<T | undefined> {
  const result = await query<T>(executor, text, params);
  return result.rows[0];
}
