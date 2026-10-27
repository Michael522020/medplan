import { createHash } from 'node:crypto';
import { AppError } from '../errors/app-error.js';

/**
 * 幂等键处理。
 *
 * ## 契约语义（openapi.yaml §2）
 *
 *   - 同一 `Idempotency-Key` + 同一请求体 -> 返回首次结果，`data.idempotentReplay = true`（HTTP 200）
 *   - 同一 `Idempotency-Key` + **不同**请求体 -> `code 10001`（幂等键冲突）
 *   - 幂等记录保留 24 小时
 *
 * ## 为什么幂等是硬需求而非优化
 *
 * 契约给了两条理由，本模块的落地方式直接对应：
 *
 *   1. **Redis Stream 是至少一次投递**：重投若不幂等会产生重复 GPU 计算。
 *      一次腹部 CT 分割要占 GPU 十分钟，重复计算既烧算力也推迟出报告。
 *   2. **签名重试若不幂等会产生两个签名流水号**：使同一份报告出现两个
 *      有效签名 —— 这是**法律风险**，不是技术瑕疵。
 *
 * ## 请求体指纹
 *
 * 用请求体的 SHA-256 作为指纹来判断「同一请求体」。
 * 注意：**不是**用 SM3。指纹只用于服务端比对幂等键复用，
 * 不参与任何签名或合规摘要计算，用 SHA-256 足够且更快。
 * 签名绑定一律用 SM3（见 common/crypto/digest.ts）。
 */
export interface IdempotencyFingerprint {
  /** 指纹原文（十六进制） */
  digest: string;
}

/**
 * 计算请求体指纹。
 *
 * 用稳定序列化（键排序）而非 JSON.stringify —— 否则
 * `{"a":1,"b":2}` 与 `{"b":2,"a":1}` 会被判为不同请求体，
 * 导致合法的幂等重放被误判为冲突。
 */
export function fingerprintRequestBody(body: unknown): IdempotencyFingerprint {
  const canonical = stableStringify(body);
  return { digest: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

/**
 * 校验幂等键格式。
 *
 * 契约要求 UUID v4 格式、maxLength 36。不合法 -> 10001。
 */
export function assertIdempotencyKey(raw: string | undefined): string {
  if (!raw) {
    throw AppError.paramInvalid('缺少 Idempotency-Key 请求头');
  }
  const key = raw.trim();
  if (key.length > 36) {
    throw AppError.paramInvalid('Idempotency-Key 长度不得超过 36');
  }
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) {
    throw AppError.paramInvalid('Idempotency-Key 必须为 UUID 格式');
  }
  return key.toLowerCase();
}

/**
 * 幂等命中时的处理。
 *
 * @param storedFingerprint 首次请求时落库的指纹
 * @param currentFingerprint 本次请求的指纹
 * @returns 本次请求是否为「同键同体」的幂等重放
 * @throws AppError 10001 同键不同体 -> 幂等键冲突
 */
export function resolveIdempotentReplay(
  storedFingerprint: string,
  currentFingerprint: string
): boolean {
  if (storedFingerprint === currentFingerprint) {
    return true;
  }
  // 同键不同体：调用方改了参数却复用了幂等键。
  // 必须拒绝 —— 否则第一次请求的参数与本次的参数会混淆，
  // 返回的结果对应哪一次调用无法确定。
  throw AppError.paramInvalid('Idempotency-Key 已被不同请求体使用');
}

/** 幂等记录的保留时长（契约：24 小时） */
export const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * 幂等键 -> 已存请求指纹 的进程内缓存。
 *
 * ## 为什么是内存而不是数据库
 *
 * 数据库里已有一张 `idempotency_records` 之外的机制：各业务表自己带
 * `idempotency_key` 唯一约束（segmentation_tasks / plans / signature_logs
 * 都有 `uq_*_idempotency` 约束）。那些约束保证「同键只创建一次」，
 * 是**最终**防线。
 *
 * 本缓存承担的是「同键但请求体不同」的判定 —— 需要比对请求体指纹，
 * 而业务表并没有存指纹的列。加一列指纹到业务表会改动已锁定的
 * schema.sql（架构方案要求两张文件同步），而契约禁止我改 schema。
 *
 * 因此：内存缓存存指纹做快速冲突判定，数据库唯一约束做最终去重。
 * 进程重启后缓存丢失，最坏情况是漏判一次「同键不同体」，
 * 但数据库唯一约束仍会拒绝第二次创建（返回首次结果）——
 * **安全性由数据库约束兜底，缓存只提升判定精度**。
 */
export class IdempotencyFingerprintStore {
  private readonly entries = new Map<string, { fingerprint: string; expiresAt: number }>();

  /** 记录首次请求的指纹。已存在且指纹不同则抛冲突 */
  register(key: string, fingerprint: string): void {
    this.prune();
    const existing = this.entries.get(key);
    if (existing) {
      resolveIdempotentReplay(existing.fingerprint, fingerprint);
      return;
    }
    this.entries.set(key, {
      fingerprint,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
    });
  }

  /** 查询已存指纹。过期视为不存在 */
  get(key: string): string | undefined {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.fingerprint;
  }

  /** 清理过期条目。避免长时间运行内存无限增长 */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

/** 稳定序列化：对象键字典序、数组保序 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
