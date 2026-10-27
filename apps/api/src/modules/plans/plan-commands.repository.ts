import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne, type Queryable } from '../../common/db/pool.js';

/**
 * 规划方案操作日志的数据访问。
 *
 * 单独成文件：`plan_commands` 是**可读操作日志**（契约：
 * 「所有写操作经 PlanCommandService，产生可读操作日志」），
 * 它与方案主表是两件事 —— 主表是「当前状态」，日志是「变更史」。
 * 混在一个 repository 里会让「append-only 的历史」看起来像「可变的当前态」。
 */
export interface PlanCommandRow {
  id: string;
  command_type: string;
  before_value: unknown;
  after_value: unknown;
  version_before: number | null;
  version_after: number | null;
  created_at: Date;
}

@Injectable()
export class PlanCommandsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 追加操作日志（append-only）。
   *
   * 契约要求「所有写操作经 PlanCommandService，产生可读操作日志」——
   * 这是审计友好的关键（CRDT 内部状态不可读，ADR-006）。
   */
  async append(
    client: Queryable,
    params: {
      planId: string;
      commandType: string;
      beforeValue: unknown | null;
      afterValue: unknown | null;
      actorId: string;
      versionBefore: number | null;
      versionAfter: number | null;
    }
  ): Promise<void> {
    await query(
      client,
      `INSERT INTO plan_commands (
         plan_id, command_type, before_value, after_value, actor_id,
         version_before, version_after, retention_class
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'plan_15y')`,
      [
        params.planId,
        params.commandType,
        params.beforeValue === null ? null : JSON.stringify(params.beforeValue),
        params.afterValue === null ? null : JSON.stringify(params.afterValue),
        params.actorId,
        params.versionBefore,
        params.versionAfter,
      ]
    );
  }

  /** 取方案的操作日志（按版本倒序） */
  async findCommands(planId: string, limit = 50): Promise<PlanCommandRow[]> {
    const result = await query<PlanCommandRow>(
      this.pool,
      `SELECT id,
              command_type,
              before_value,
              after_value,
              version_before,
              version_after,
              created_at
         FROM plan_commands
        WHERE plan_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [planId, limit]
    );
    return result.rows;
  }

  /**
   * 按幂等键查「已执行过的写操作」。
   *
   * ## 为什么幂等键存在 plan_commands 而不是 plans
   *
   * `plans.idempotency_key` 上有唯一约束 `uq_plans_idempotency`，
   * 一个方案行只能存一个幂等键 —— 那是**创建**用的。
   * 更新操作需要各自的幂等键（同一方案可能被多次更新，每次重试都要能
   * 识别出「这次重试」），因此把幂等键记在 `plan_commands.after_value` 里。
   *
   * `plan_commands` 是 append-only 的操作日志，天然适合承载这类元信息，
   * 且不需要改动已锁定的 schema.sql。
   *
   * 创建与更新统一走这里：创建命令的 after_value 同样存幂等键与指纹，
   * 于是**两条路径的幂等语义完全一致**（同键同体 -> 重放；同键异体 -> 冲突）。
   *
   * ## 返回值带请求指纹
   *
   * 契约要求「同一幂等键 + **不同**请求体 -> 10001（幂等键冲突）」。
   * 因此必须能把**首次请求的请求体**与**本次请求的请求体**比对 ——
   * 指纹（SHA-256）就是为此存的。
   */
  async findCommandByIdempotencyKey(
    planId: string,
    idempotencyKey: string
  ): Promise<{ versionAfter: number | null; requestFingerprint: string | null } | undefined> {
    const row = await queryOne<{ version_after: number | null; request_fingerprint: string | null }>(
      this.pool,
      `SELECT version_after,
              after_value->>'requestFingerprint' AS request_fingerprint
         FROM plan_commands
        WHERE plan_id = $1
          AND after_value->>'idempotencyKey' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [planId, idempotencyKey]
    );
    return row
      ? { versionAfter: row.version_after, requestFingerprint: row.request_fingerprint }
      : undefined;
  }
}
