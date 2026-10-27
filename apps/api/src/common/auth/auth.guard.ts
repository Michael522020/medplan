import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { verifyJwt, type JwtAlgorithm, type KeyResolver } from './jwt-verifier.js';
import type { Session } from './session.js';

/**
 * 会话守卫。
 *
 * ## 职责
 *
 * 1. 从 `Authorization: Bearer <token>` 取出令牌
 * 2. **验签**（不接受未验签的用户头 —— 见 jwt-verifier.ts 的信任模型说明）
 * 3. 把会话主体挂到 `request.session`
 *
 * ## 为什么用守卫而不是中间件
 *
 * Nest 的 Guard 跑在路由处理之前，能在**任何**业务代码之前拒绝未认证请求。
 * 关键点：审计钩子（audit-hook.ts）也读 `request.session`，
 * 因此守卫必须**先于**审计落库执行 —— 否则未认证的越权尝试会丢失 actor 信息。
 */

/** 挂载会话主体的请求扩展 */
export interface SessionAwareRequest extends FastifyRequest {
  session?: Session;
}

/** 注入会话主体 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Session => {
    const request = context.switchToHttp().getRequest<SessionAwareRequest>();
    const session = request.session;
    if (!session) {
      // 理论上不该发生（守卫已保证），但显式抛错优于返回 undefined 后
      // 在业务层触发「undefined 访问」这种难以定位的异常。
      throw AppError.unauthorized();
    }
    return session;
  }
);

/** DI 令牌。interface / 匿名对象类型编译后被擦除，不能直接当 Nest 令牌用 */
export const KEY_RESOLVER = 'KEY_RESOLVER';
export const JWT_VERIFIER_CONFIG = 'JWT_VERIFIER_CONFIG';

/** JWT 校验配置 */
export interface JwtVerifierConfig {
  issuer: string;
  realm: string;
  audience?: string;
  clockToleranceSeconds: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(KEY_RESOLVER) private readonly keyResolver: KeyResolver,
    @Inject(JWT_VERIFIER_CONFIG) private readonly config: JwtVerifierConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionAwareRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const session = await verifyJwt(token, this.config, this.keyResolver);
    request.session = session;
    return true;
  }
}

/**
 * 取出 Bearer 令牌。
 *
 * 缺失或格式不对 -> 10002（未认证）。**不区分**「缺失」与「格式错误」
 * 的具体原因，避免给攻击者反馈面。
 */
export function extractBearerToken(header: string | undefined): string {
  if (!header) {
    throw AppError.unauthorized();
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !match[1]) {
    throw AppError.unauthorized();
  }
  return match[1];
}

/**
 * 构造一个固定算法的 KeyResolver（用于测试与本地自签场景）。
 */
export function staticKeyResolver(key: Buffer | import('node:crypto').KeyObject): KeyResolver {
  return async (_kid: string, _alg: JwtAlgorithm) => key;
}
