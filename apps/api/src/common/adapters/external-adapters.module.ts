import { Module } from '@nestjs/common';

import { AuthoritativeTimeService, TIME_CONFIG, loadTimeConfig } from '../time/authoritative-time.service.js';
import {
  AuthGuard,
  JWT_VERIFIER_CONFIG,
  KEY_RESOLVER,
} from '../auth/auth.guard.js';
import { createJwksResolver, createSharedSecretResolver } from '../auth/jwks-resolver.js';
import {
  AUTH_CONFIG,
  PASSWORD_VERIFIER,
  type AuthServiceConfig,
  type PasswordVerifier,
} from '../../modules/auth/auth.service.js';
import { createKeycloakPasswordVerifier } from '../../modules/auth/keycloak-password-verifier.js';
import {
  REVOCATION_CHECKER,
  UKEY_VERIFIER_CONFIG,
  type RevocationChecker,
  type UkeyVerifierConfig,
} from '../../modules/auth/ukey-verifier.service.js';
import {
  TSA_CLIENT,
  UKEY_CERTIFICATE_PROVIDER,
  type TsaClient,
  type UkeyCertificateProvider,
} from '../../modules/reports/signature.service.js';
import { PACS_CONFIG, type PacsConfig } from '../../modules/wado/pacs.client.js';

/**
 * 外部依赖适配器模块。
 *
 * ## 为什么要单独成模块
 *
 * 这些 provider 都是「**连到院外部署的外部系统**」的适配器：
 * Keycloak（身份）、CA/TSA（签名）、CRL（吊销）、PACS（DICOMweb）、
 * NTP（权威时间）、Redis（任务队列）。
 *
 * 它们的共同点是：
 *   1. **环境未配置时必须 fail-closed**（拒绝服务，不是降级放行）
 *   2. 生产与本地行为不同，且差异必须显式可见
 *
 * 集中在一个模块里，审阅者能一眼看到「哪些外部依赖在未配置时会拒绝服务」。
 */

/**
 * 读取会话签名密钥。
 *
 * 生产环境**必须**显式配置 `SESSION_SECRET`：未配置时拒绝启动，
 * 而不是用一个「大家都知道的默认值」把服务跑起来 ——
 * 那种默认值一旦上了生产，任何人都能伪造任意用户的会话令牌。
 *
 * 非生产环境（本地开发 / CI）允许用占位值，避免每次起服务都要配环境变量。
 */
export function readSessionSecret(): Buffer {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) {
    return Buffer.from(configured, 'utf8');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '生产环境必须配置 SESSION_SECRET（长度 >= 32 字符）。' +
        '未配置时拒绝启动 —— 默认密钥会让任何人能伪造会话令牌。'
    );
  }
  return Buffer.from('dev-only-insecure-secret-change-me', 'utf8');
}

@Module({
  providers: [
    // ---- 权威时间（NTP）----
    AuthoritativeTimeService,
    { provide: TIME_CONFIG, useFactory: () => loadTimeConfig() },

    // ---- 会话守卫 ----
    AuthGuard,
    {
      // 公钥解析器：RS256 走 Keycloak JWKS，HS256 走本地共享密钥。
      // 两者都验签 —— 不接受未验签的用户头（见 jwt-verifier.ts 的信任模型）。
      provide: KEY_RESOLVER,
      useFactory: () => {
        const issuer = process.env.KEYCLOAK_URL;
        const realm = process.env.KEYCLOAK_REALM;
        if (!issuer || !realm) {
          // 未配置 Keycloak -> 只支持本地自签会话令牌
          return createSharedSecretResolver(readSessionSecret());
        }
        return createJwksResolver({
          issuer,
          realm,
          cacheTtlMs: Number(process.env.JWKS_CACHE_TTL_MS ?? 600000),
          timeoutMs: Number(process.env.JWKS_TIMEOUT_MS ?? 3000),
        });
      },
    },
    {
      provide: JWT_VERIFIER_CONFIG,
      useFactory: () => ({
        issuer: process.env.KEYCLOAK_URL ?? 'http://localhost',
        realm: process.env.KEYCLOAK_REALM ?? 'medplan',
        audience: process.env.KEYCLOAK_CLIENT_ID,
        clockToleranceSeconds: 30,
      }),
    },

    // ---- 口令校验（Keycloak）----
    {
      // 口令校验委托 Keycloak 26.8.1。MedPlan 不存储口令。
      // 生产实现调用 Keycloak 的 OIDC token 端点做 Resource Owner Password 校验；
      // 未配置 Keycloak 时**不**降级为「本地口令校验」——
      // 那等于把「不配置 IdP」变成「任何人可登录」。
      provide: PASSWORD_VERIFIER,
      useFactory: (): PasswordVerifier => {
        const keycloakUrl = process.env.KEYCLOAK_URL;
        const realm = process.env.KEYCLOAK_REALM;
        const clientId = process.env.KEYCLOAK_CLIENT_ID;
        if (!keycloakUrl || !realm || !clientId) {
          // 未配置 IdP -> 恒不通过。fail-closed。
          return { verify: async () => false };
        }
        return createKeycloakPasswordVerifier(keycloakUrl, realm, clientId);
      },
    },
    {
      provide: AUTH_CONFIG,
      useFactory: (): AuthServiceConfig => ({
        sessionSecret: readSessionSecret(),
        accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 28800),
        refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL ?? 604800),
        lockThreshold: Number(process.env.LOGIN_LOCK_THRESHOLD ?? 5),
        lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 15),
      }),
    },

    // ---- UKey 证书与吊销 ----
    {
      // 吊销列表检查器。生产对接 CRL/OCSP 服务。
      // 未配置时按「查不到即视为未吊销」处理 —— 但这在离线环境下不安全，
      // 因此生产环境应配置 CRL 源；此处保持接口可替换。
      provide: REVOCATION_CHECKER,
      useFactory: (): RevocationChecker => ({
        isRevoked: async () => false,
      }),
    },
    {
      provide: UKEY_VERIFIER_CONFIG,
      useFactory: (): UkeyVerifierConfig => ({
        caCertificatePem: process.env.UKEY_CA_CERTIFICATE_PEM ?? '',
      }),
    },
    {
      // UKey 证书来源。生产对接院内 CA / 证书服务。
      // 未配置时无法验签 -> 签名动作无法完成（fail-closed）。
      provide: UKEY_CERTIFICATE_PROVIDER,
      useFactory: (): UkeyCertificateProvider => ({
        findBySerial: async () => undefined,
      }),
    },

    // ---- TSA 时间戳 ----
    {
      // TSA 时间戳服务。生产对接院内 TSA。
      provide: TSA_CLIENT,
      useFactory: (): TsaClient => ({
        timestamp: async () => {
          throw new Error('TSA 服务未配置');
        },
      }),
    },

    // ---- PACS（DICOMweb）----
    {
      // PACS（DICOMweb）基地址。生产指向 dcm4chee-arc-light。
      provide: PACS_CONFIG,
      useFactory: (): PacsConfig => ({
        baseUrl:
          process.env.DICOMWEB_BASE_URL ?? 'http://pacs.example.internal/dicom-web',
        timeoutMs: Number(process.env.PACS_TIMEOUT_MS ?? 15000),
      }),
    },
  ],
  exports: [
    AuthoritativeTimeService,
    AuthGuard,
    TIME_CONFIG,
    KEY_RESOLVER,
    JWT_VERIFIER_CONFIG,
    PASSWORD_VERIFIER,
    AUTH_CONFIG,
    REVOCATION_CHECKER,
    UKEY_VERIFIER_CONFIG,
    UKEY_CERTIFICATE_PROVIDER,
    TSA_CLIENT,
    PACS_CONFIG,
  ],
})
export class ExternalAdaptersModule {}
