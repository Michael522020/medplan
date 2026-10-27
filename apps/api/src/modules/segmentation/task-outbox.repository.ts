import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DB_POOL, query, queryOne, type Queryable } from '../../common/db/pool.js';

/**
 * 任务投递 outbox 的数据访问。
 *
 * SQL 只在本文件（repository 层）。
 */

export interface OutboxRow {
  id: string;
  task_id: string;
  task_type: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  dispatch_status: string;
  stream_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: Date | null;
  created_at: Date;
}

export interface OutboxInsertParams {
  taskId: string;
  taskType: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class TaskOutboxRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * 在事务内写 outbox 行。
   *
   * **必须**与 segmentation_tasks 的 INSERT 在同一事务 ——
   * 否则会出现「任务已落库但没有 outbox 行」= 永远不会被投递的任务。
   */
  async enqueue(client: Queryable, params: OutboxInsertParams): Promise<void> {
    await query(
      client,
      `INSERT INTO task_outbox (
         task_id, task_type, idempotency_key, payload, dispatch_status, next_retry_at
       ) VALUES ($1, $2, $3, $4, 'pending', now())
       ON CONFLICT (task_id) DO NOTHING`,
      [
        params.taskId,
        params.taskType,
        params.idempotencyKey,
        JSON.stringify(params.payload),
      ]
    );
  }

  /**
   * 捞出到期的待投递行。
   *
   * `FOR UPDATE SKIP LOCKED` 是关键：多个投递器实例并行扫描时，
   * 同一行不会被两个实例同时处理（否则会重复投递）。
   *
   * @param limit 单批最多捞多少行
   */
  async claimPending(
    client: Queryable,
    limit: number
  ): Promise<OutboxRow[]> {
    const result = await query<OutboxRow>(
      client,
      `SELECT id,
              task_id,
              task_type,
              idempotency_key,
              payload,
              dispatch_status,
              stream_message_id,
              attempt_count,
              last_error,
              next_retry_at,
              created_at
         FROM task_outbox
        WHERE dispatch_status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    return result.rows;
  }

  /** 标记投递成功 */
  async markDispatched(
    client: Queryable,
    outboxId: string,
    streamMessageId: string
  ): Promise<void> {
    await query(
      client,
      `UPDATE task_outbox
          SET dispatch_status = 'dispatched',
              stream_message_id = $2,
              dispatched_at = now(),
              last_error = NULL
        WHERE id = $1`,
      [outboxId, streamMessageId]
    );
  }

  /**
   * 标记投递失败并安排重试（指数退避）。
   *
   * 退避是必要的：队列侧故障时，不退避的扫描器会**打爆** Redis
   * （每轮全表扫描 + 大量 XADD 失败），故障被放大成雪崩。
   */
  async markFailed(
    client: Queryable,
    outboxId: string,
    error: string,
    attemptCount: number
  ): Promise<void> {
    const backoffSeconds = Math.min(300, 2 ** Math.min(attemptCount, 8));
    await query(
      client,
      `UPDATE task_outbox
          SET attempt_count = attempt_count + 1,
              last_error = $2,
              next_retry_at = now() + ($3 || ' seconds')::interval
        WHERE id = $1`,
      [outboxId, error.slice(0, 500), String(backoffSeconds)]
    );
  }

  /** 按 outbox id 取行（测试与排查用） */
  async findById(id: string): Promise<OutboxRow | undefined> {
    return queryOne<OutboxRow>(
      this.pool,
      `SELECT id,
              task_id,
              task_type,
              idempotency_key,
              payload,
              dispatch_status,
              stream_message_id,
              attempt_count,
              last_error,
              next_retry_at,
              created_at
         FROM task_outbox
        WHERE id = $1`,
      [id]
    );
  }

  /** 按任务 id 取行（测试与排查用） */
  async findByTaskId(taskId: string): Promise<OutboxRow | undefined> {
    return queryOne<OutboxRow>(
      this.pool,
      `SELECT id,
              task_id,
              task_type,
              idempotency_key,
              payload,
              dispatch_status,
              stream_message_id,
              attempt_count,
              last_error,
              next_retry_at,
              created_at
         FROM task_outbox
        WHERE task_id = $1`,
      [taskId]
    );
  }

  /** 统计待投递行数（监控与不变量校验用） */
  async countPending(): Promise<number> {
    const row = await queryOne<{ count: number }>(
      this.pool,
      `SELECT count(*)::int AS count FROM task_outbox WHERE dispatch_status = 'pending'`,
      []
    );
    return row?.count ?? 0;
  }
}

/** 便于测试注入的窄类型 */
export type OutboxClient = PoolClient;
