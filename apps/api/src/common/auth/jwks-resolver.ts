import { createSecretKey, type KeyObject } from 'node:crypto';
import {
  jwkToPublicKey,
  type JwksKey,
  type KeyResolver,
} from './jwt-verifier.js';

/**
 * Keycloak JWKS 公钥解析器。
 *
 * ## 为什么需要缓存
 *
 * JWKS 端点在 Keycloak 侧是**准静态**的（密钥轮换时换 kid）。
 * 每个请求都去拉一次会让每个 API 调用多一次网络往返 ——
 * 在阅片场景（首帧 ≤3s，AC-05）下这是不可接受的开销。
 *
 * 因此按 TTL 缓存。缓存过期后遇到**未命中**的 kid 会强制刷新一次
 * （而不是直接失败）—— 否则密钥轮换的那几分钟内所有令牌都会被拒。
 */
export interface JwksResolverConfig {
  /** Keycloak 域，如 https://sso.hospital.internal */
  issuer: string;
  /** realm 名 */
  realm: string;
  /** 缓存 TTL（毫秒） */
  cacheTtlMs: number;
  /** 单次拉取超时（毫秒） */
  timeoutMs: number;
}

/**
 * 构造 JWKS 解析器。
 */
export function createJwksResolver(config: JwksResolverConfig): KeyResolver {
  let cached = new Map<string, KeyObject>();
  let fetchedAt = 0;
  let inFlight: Promise<void> | null = null;

  const jwksUrl = `${config.issuer.replace(/\/+$/, '')}/realms/${config.realm}/protocol/openid-connect/certs`;

  async function refresh(): Promise<void> {
    if (inFlight) {
      await inFlight;
      return;
    }
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(jwksUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`JWKS 拉取失败：HTTP ${response.status}`);
        }
        const body = (await response.json()) as { keys?: JwksKey[] };
        const next = new Map<string, KeyObject>();
        for (const jwk of body.keys ?? []) {
          const key = jwkToPublicKey(jwk);
          if (key) next.set(jwk.kid, key);
        }
        cached = next;
        fetchedAt = Date.now();
      } finally {
        clearTimeout(timer);
        inFlight = null;
      }
    })();
    await inFlight;
  }

  return async (kid: string, alg: string): Promise<KeyObject | undefined> => {
    // 只支持 RS256 的 JWKS 解析；HS256 用本地共享密钥，不走 JWKS
    if (alg !== 'RS256') {
      return undefined;
    }

    const expired = Date.now() - fetchedAt > config.cacheTtlMs;
    if (expired || cached.size === 0) {
      try {
        await refresh();
      } catch {
        // 拉取失败时退回已有缓存（若刚好有该 kid）。
        // 宁可让「密钥轮换窗口内的令牌」暂时不可用，
        // 也不能让整个认证在 JWKS 抖动时全挂。
        return cached.get(kid);
      }
    }

    const hit = cached.get(kid);
    if (hit) return hit;

    // 未命中：可能是刚轮换了密钥，强制刷新一次再试
    try {
      await refresh();
    } catch {
      return undefined;
    }
    return cached.get(kid);
  };
}

/**
 * 本地共享密钥解析器（HS256）。
 *
 * MedPlan 自签会话令牌用。生产应通过 K8s Secret 注入 `SESSION_SECRET`。
 */
export function createSharedSecretResolver(secret: Buffer): KeyResolver {
  return async (_kid: string, alg: string): Promise<KeyObject | undefined> => {
    if (alg !== 'HS256') return undefined;
    return createSecretKey(secret);
  };
}
