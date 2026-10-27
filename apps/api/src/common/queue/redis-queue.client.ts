import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppError } from '../errors/app-error.js';

/**
 * Redis Stream 客户端封装。
 *
 * ## 为什么用 Stream 而不是 List
 *
 * 架构方案 §6.3：AI 任务队列用 Redis Stream。
 * Stream 相对 List 的关键优势是**消费者组（Consumer Group）**：
 *   - 消息在未 ACK 前留在 Pending Entries List，Worker 崩溃后消息**不会丢**
 *   - 可以 XAUTOCLAIM 把超时未处理的消息转交给其他 Worker
 *   - 至少一次投递语义由 Stream 原生提供，不需要自己造
 *
 * ## 许可说明
 *
 * ioredis 是 **MIT** 许可（客户端库，不含 Redis 服务端代码），
 * 可闭源商用。Redis **服务端** 8.x 的 AGPLv3 问题见
 * `docs/licenses/THIRD-PARTY.md` —— 那是服务端的事，本模块只是客户端。
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** 队列配置 */
export interface RedisQueueConfig {
  /** Redis 连接串 */
  url: string;
  /** Stream key */
  streamKey: string;
  /** 消费者组名 */
  consumerGroup: string;
  /** 消费者名（实例标识） */
  consumerName: string;
  /** 单次 XREADGROUP 的阻塞时长（毫秒） */
  blockTimeoutMs: number;
  /** 未 ACK 消息的认领超时（毫秒）。超过则可被其他 Worker 认领 */
  claimIdleMs: number;
}

export function loadRedisQueueConfig(): RedisQueueConfig {
  return {
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:16379',
    streamKey: process.env.AI_TASK_STREAM ?? 'medplan:ai:tasks',
    consumerGroup: process.env.AI_TASK_CONSUMER_GROUP ?? 'ai-workers',
    consumerName: process.env.AI_TASK_CONSUMER_NAME ?? `api-${process.pid}`,
    blockTimeoutMs: Number(process.env.AI_TASK_BLOCK_TIMEOUT_MS ?? 5000),
    claimIdleMs: Number(process.env.AI_TASK_CLAIM_IDLE_MS ?? 300000),
  };
}

/**
 * Redis Stream 客户端。
 *
 * ## 生命周期
 *
 * 连接**惰性**建立：构造时不连，进程启动不因 Redis 不可达而失败。
 * 理由：Redis 不可达时，业务库里的任务仍然安全（outbox 兜底），
 * 服务应该继续提供读接口；只有投递会失败并由扫描器补偿。
 */
@Injectable()
export class RedisQueueClient implements OnModuleDestroy {
  private client: Redis | null = null;
  /** 消费组是否已确保存在 */
  private groupEnsured = false;

  constructor(@Inject(REDIS_CLIENT) private readonly config: RedisQueueConfig) {}

  /** 取得（必要时建立）底层连接 */
  private connection(): Redis {
    if (!this.client) {
      this.client = new Redis(this.config.url, {
        // 连接失败不抛异常打断进程，由调用方决定如何处理
        maxRetriesPerRequest: 2,
        enableOfflineQueue: true,
        lazyConnect: false,
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
      });
    }
    return this.client;
  }

  /**
   * 投递一条任务消息。
   *
   * @returns Redis Stream 消息 ID
   */
  async publish(fields: Record<string, string>): Promise<string> {
    const id = await this.connection().xadd(
      this.config.streamKey,
      '*',
      ...Object.entries(fields).flat()
    );
    if (!id) {
      throw AppError.internal('任务投递失败：Redis 未返回消息 ID');
    }
    return id;
  }

  /**
   * 确保消费组存在。
   *
   * 用 MKSTREAM 让 Stream 不存在时一并创建。
   * BUSYGROUP 错误说明组已存在 —— 忽略即可（幂等）。
   */
  async ensureConsumerGroup(): Promise<void> {
    if (this.groupEnsured) return;
    try {
      await this.connection().xgroup(
        'CREATE',
        this.config.streamKey,
        this.config.consumerGroup,
        '$',
        'MKSTREAM'
      );
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (!message.includes('BUSYGROUP')) {
        throw err;
      }
    }
    this.groupEnsured = true;
  }

  /**
   * 领取一批消息（阻塞式）。
   *
   * 返回空数组表示本轮没有新消息（阻塞超时）。
   */
  async claimBatch(count: number): Promise<RedisStreamMessage[]> {
    await this.ensureConsumerGroup();
    const response = await this.connection().xreadgroup(
      'GROUP',
      this.config.consumerGroup,
      this.config.consumerName,
      'COUNT',
      count,
      'BLOCK',
      this.config.blockTimeoutMs,
      'STREAMS',
      this.config.streamKey,
      '>'
    );
    return parseXreadgroupResponse(response);
  }

  /**
   * 认领超时未处理的消息（其他 Worker 崩溃后的恢复）。
   *
   * 这是「至少一次投递」不丢消息的关键：崩溃 Worker 的 Pending 消息
   * 会被健康 Worker 接手，而不是永远卡在 Pending Entries List。
   */
  async claimStale(minIdleMs: number, count: number): Promise<RedisStreamMessage[]> {
    await this.ensureConsumerGroup();
    const response = await this.connection().xautoclaim(
      this.config.streamKey,
      this.config.consumerGroup,
      this.config.consumerName,
      minIdleMs,
      '0-0',
      'COUNT',
      count
    );
    // xautoclaim 返回 [nextId, messages, deletedIds]
    const messages = Array.isArray(response) ? (response[1] as unknown) : [];
    return parseMessageArray(messages);
  }

  /** 确认消息已处理（从 Pending Entries List 移除） */
  async acknowledge(messageIds: string[]): Promise<number> {
    if (messageIds.length === 0) return 0;
    return this.connection().xack(
      this.config.streamKey,
      this.config.consumerGroup,
      ...messageIds
    );
  }

  /** 当前 Stream 的消息总数（监控用） */
  async length(): Promise<number> {
    return this.connection().xlen(this.config.streamKey);
  }

  /** 待确认（Pending）消息数（监控用） */
  async pendingCount(): Promise<number> {
    const result = await this.connection().xpending(
      this.config.streamKey,
      this.config.consumerGroup
    );
    return Number(result?.[0] ?? 0);
  }

  /** 关闭连接（进程退出时） */
  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      const client = this.client;
      this.client = null;
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }
}

/** 一条 Stream 消息 */
export interface RedisStreamMessage {
  /** Redis Stream 消息 ID */
  id: string;
  /** 消息字段 */
  fields: Record<string, string>;
}

/** 解析 xreadgroup 的返回结构 */
function parseXreadgroupResponse(response: unknown): RedisStreamMessage[] {
  if (!Array.isArray(response)) return [];
  const out: RedisStreamMessage[] = [];
  for (const stream of response) {
    if (!Array.isArray(stream)) continue;
    const messages = stream[1];
    if (!Array.isArray(messages)) continue;
    out.push(...parseMessageArray(messages));
  }
  return out;
}

/** 解析消息数组（[id, [field, value, ...]] 形式） */
function parseMessageArray(messages: unknown): RedisStreamMessage[] {
  if (!Array.isArray(messages)) return [];
  const out: RedisStreamMessage[] = [];
  for (const entry of messages) {
    if (!Array.isArray(entry)) continue;
    const id = entry[0];
    const flat = entry[1];
    if (typeof id !== 'string' || !Array.isArray(flat)) continue;
    const fields: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const key = flat[i];
      const value = flat[i + 1];
      if (typeof key === 'string' && typeof value === 'string') {
        fields[key] = value;
      }
    }
    out.push({ id, fields });
  }
  return out;
}
