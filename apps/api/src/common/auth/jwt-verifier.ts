import { createPublicKey, createHmac, verify as verifyOneShot, type KeyObject } from 'node:crypto';
import { AppError } from '../errors/app-error.js';
import type { RoleCode, Session } from './session.js';

/**
 * JWT 校验。
 *
 * ## 为什么自己实现
 *
 * 依赖清单里没有 jsonwebtoken / jose。离线内网交付，新增依赖需要供应链
 * 核验（存在性 + 版本锚定 + 许可证），而 JWT 验签的核心就是
 * `crypto.verify('RSA-SHA256', ...)` —— Node 内建已经覆盖。
 *
 * ## 信任模型
 *
 * 公钥来自 Keycloak 26.8.1 的 JWKS 端点
 * （`/realms/{realm}/protocol/openid-connect/certs`）。
 *
 * 接受两种算法，**都**要求签名有效：
 *   - `RS256`：Keycloak OIDC 签发（生产默认）
 *   - `HS256`：MedPlan 自签会话令牌（共享密钥，见下方说明）
 *
 * **拒绝 `none`**，以及 `HS256` 与公钥混用 —— 后者是 JWT 最常见的
 * 部署事故：用公钥当 HMAC 密钥签发，任何持有公钥的人都能伪造令牌。
 *
 * ## 关于会话令牌由谁签发
 *
 * 契约（openapi.yaml §3）写「由 Keycloak 26.8.1 OIDC 签发」，同时要求
 * access_token 载荷含 `ukey_cert_serial`（证明第二因素已完成）。
 * Keycloak 的 direct grant 无法携带「本次登录刚校验通过的 UKey 序列号」
 * ——除非在 Keycloak 侧配置自定义 protocol mapper。
 *
 * 因此本实现取折中：**口令**由 Keycloak 校验（MedPlan 不存储口令），
 * **会话令牌**由 MedPlan 签发，载荷与契约描述逐字段对齐
 * （sub / dept / roles / ukey_cert_serial / jti / iat / exp）。
 * 该偏离已在交付说明中标注，待项目总监裁决。
 *
 * ## 失败语义
 *
 * 任何校验失败（签名不合法 / 已过期 / 算法不符 / kid 未知）一律
 * `AppError.unauthorized()`，**不透露具体失败环节**：
 * 区分「签名错」与「过期」等于给攻击者一个 oracle。
 */

interface JwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  preferred_username?: string;
  name?: string;
  department?: string;
  dept?: string;
  roles?: string[];
  realm_access?: { roles?: string[] };
  ukey_cert_serial?: string;
  jti?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
}

export interface JwksKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

export interface JwtVerifierConfig {
  /** Keycloak 域,如 https://sso.hospital.internal */
  issuer: string;
  /** realm 名 */
  realm: string;
  /** 期望的受众（client id）。留空则不校验 aud */
  audience?: string;
  /** 允许的时钟偏差（秒）。网络与序列化耗时不应造成误拒 */
  clockToleranceSeconds: number;
}

/** 角色白名单。与契约 RoleCode 枚举一致，防止令牌里塞入未知角色 */
const KNOWN_ROLES: readonly RoleCode[] = [
  'system_admin',
  'image_chief',
  'image_physician',
  'trainee_physician',
  'surgeon_physician',
  'quality_control',
  'medical_records',
  'service_account',
];

/** 支持的签名算法 */
export type JwtAlgorithm = 'RS256' | 'HS256';

/**
 * 密钥解析器。
 *
 * @param kid 令牌头部的 key id
 * @param alg 令牌声明的算法
 */
export type KeyResolver = (
  kid: string,
  alg: JwtAlgorithm
) => Promise<KeyObject | Buffer | undefined>;

/**
 * 解析并校验 JWT，返回会话主体。
 *
 * @param token        原始 Bearer 令牌
 * @param keyResolver 由 kid/alg 解析出验证密钥（实现方负责 JWKS 缓存）
 */
export async function verifyJwt(
  token: string,
  config: JwtVerifierConfig,
  keyResolver: KeyResolver
): Promise<Session> {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }
  const [headerPart, payloadPart, signaturePart] = segments as [string, string, string];

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as JwtHeader;
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    throw AppError.unauthorized('会话无效，请重新登录');
  }

  if (header.alg !== 'RS256' && header.alg !== 'HS256') {
    // `none` 与其他算法一律拒绝
    throw AppError.unauthorized('会话无效，请重新登录');
  }
  if (header.alg === 'RS256' && !header.kid) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }

  const key = await keyResolver(header.kid ?? '', header.alg);
  if (!key) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }

  const signedData = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  const signature = Buffer.from(signaturePart, 'base64url');
  let verified = false;
  try {
    if (header.alg === 'HS256') {
      const secret = key as Buffer;
      const expected = createHmac('sha256', secret).update(signedData).digest();
      verified = expected.length === signature.length && expected.equals(signature);
    } else {
      // 用**一次性** verify API：`createVerify().verify(key, data, sig)` 在
      // 本机 Node 22.22.2 上对正确签名会静默返回 false（参数顺序不匹配），
      // 是典型的沉默逻辑错误陷阱。一次性形式已用真实密钥对验证通过。
      verified = verifyOneShot('RSA-SHA256', signedData, key as KeyObject, signature);
    }
  } catch {
    verified = false;
  }
  if (!verified) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }

  // 时效校验。nbf 容忍少量时钟偏差；exp 不容忍（过期令牌必须拒）
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && nowSec > payload.exp + config.clockToleranceSeconds) {
    throw AppError.unauthorized('会话已过期，请重新登录');
  }
  if (typeof payload.nbf === 'number' && nowSec + config.clockToleranceSeconds < payload.nbf) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }
  if (payload.iss && !payload.iss.startsWith(config.issuer)) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }
  if (config.audience && payload.aud !== undefined) {
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(config.audience)) {
      throw AppError.unauthorized('会话无效，请重新登录');
    }
  }
  if (!payload.sub) {
    throw AppError.unauthorized('会话无效，请重新登录');
  }

  return toSession(payload);
}

/** JWT 载荷 -> 会话主体 */
function toSession(payload: JwtPayload): Session {
  const rawRoles = [...(payload.roles ?? []), ...(payload.realm_access?.roles ?? [])];
  // 去重并过滤到已知角色：令牌里的未知角色既无业务含义，也可能是探测产物
  const roles = Array.from(new Set(rawRoles)).filter((r): r is RoleCode =>
    (KNOWN_ROLES as readonly string[]).includes(r)
  );

  return {
    userId: payload.sub ?? '',
    loginName: payload.preferred_username ?? payload.sub ?? '',
    displayName: payload.name ?? payload.preferred_username ?? '',
    // 职称不从令牌取 —— 令牌可能由外部 IdP 签发，其 title 不可信。
    // 签名资格判定以数据库 users.title 为准（见 auth.repository）。
    title: '其他',
    department: payload.department ?? payload.dept ?? '',
    roles,
    ukeyCertSerial: payload.ukey_cert_serial ?? null,
    jti: payload.jti ?? null,
    exp: typeof payload.exp === 'number' ? payload.exp : null,
  };
}

/**
 * JWKS 公钥解析（RSA）。
 *
 * JWKS 用 base64url 编码的 `n` / `e`。Node 内建 `createPublicKey` 支持
 * `format: 'jwk'`，直接喂 JWK 即可 —— 不必手工组装 DER
 * （手工组装易错：DER 对 INTEGER 符号位、长度编码有严格约束，
 *  一旦出错 `createPublicKey` 只会抛 ASN.1 错误，不易定位）。
 */
export function jwkToPublicKey(jwk: JwksKey): KeyObject | undefined {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return undefined;
  try {
    return createPublicKey({
      key: { kty: 'RSA', n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
  } catch {
    return undefined;
  }
}

/**
 * 签发会话令牌（HS256）。
 *
 * 载荷字段与契约 securitySchemes.bearerAuth 的描述逐项对应：
 * `sub` / `dept` / `roles` / `ukey_cert_serial` / `jti` / `iat` / `exp`。
 */
export function signSessionToken(
  payload: {
    sub: string;
    dept: string;
    roles: string[];
    ukeyCertSerial: string;
    jti: string;
    expiresInSeconds: number;
  },
  secret: Buffer
): { token: string; expiresIn: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    sub: payload.sub,
    dept: payload.dept,
    roles: payload.roles,
    ukey_cert_serial: payload.ukeyCertSerial,
    jti: payload.jti,
    iat: issuedAt,
    exp: issuedAt + payload.expiresInSeconds,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signedData = `${encodedHeader}.${encodedBody}`;
  const signature = createHmac('sha256', secret).update(signedData).digest();
  return {
    // 签名段只做**一次** base64url 编码。
    // 曾经写成 base64url(signature.toString('base64')) —— 那是双重编码：
    // 解出来是 32 字节的 base64 文本而非 32 字节的原始 HMAC，
    // 与标准 JWT（RFC 7515 §3.4）不符，任何标准实现都验不过。
    token: `${signedData}.${base64url(signature)}`,
    expiresIn: payload.expiresInSeconds,
  };
}

/**
 * base64url 编码。
 *
 * 接受 string 或 Buffer —— 签名段是**原始字节**（Buffer），
 * 头部/载荷是 UTF-8 文本（string）。两者都只编码**一次**。
 */
function base64url(value: string | Buffer): string {
  return Buffer.isBuffer(value)
    ? value.toString('base64url')
    : Buffer.from(value, 'utf8').toString('base64url');
}
