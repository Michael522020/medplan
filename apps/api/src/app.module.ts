import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { AuditService } from './common/audit/audit.service.js';
import { HookAuditWriter } from './common/audit/hook-audit-writer.js';
import { DatabaseModule } from './common/db/database.module.js';
import { assertAuditEventTypesAligned } from './common/audit/audit-event-type.js';
import { AuthoritativeTimeService, TIME_CONFIG, loadTimeConfig } from './common/time/authoritative-time.service.js';
import {
  AuthGuard,
  JWT_VERIFIER_CONFIG,
  KEY_RESOLVER,
} from './common/auth/auth.guard.js';
import {
  createJwksResolver,
  createSharedSecretResolver,
} from './common/auth/jwks-resolver.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import {
  AUTH_CONFIG,
  AuthService,
  PASSWORD_VERIFIER,
  type AuthServiceConfig,
  type PasswordVerifier,
} from './modules/auth/auth.service.js';
import { createKeycloakPasswordVerifier } from './modules/auth/keycloak-password-verifier.js';
import {
  REVOCATION_CHECKER,
  UKEY_VERIFIER_CONFIG,
  UkeyVerifier,
  type RevocationChecker,
  type UkeyVerifierConfig,
} from './modules/auth/ukey-verifier.service.js';
import { StudiesController } from './modules/studies/studies.controller.js';
import { StudiesRepository } from './modules/studies/studies.repository.js';
import { SeriesRepository } from './modules/studies/series.repository.js';
import { StudiesService } from './modules/studies/studies.service.js';
import { SegmentationController } from './modules/segmentation/segmentation.controller.js';
import { SegmentationRepository } from './modules/segmentation/segmentation.repository.js';
import { SegmentationConfirmsRepository } from './modules/segmentation/segmentation-confirms.repository.js';
import { SegmentationService } from './modules/segmentation/segmentation.service.js';
import { SegmentationConfirmService } from './modules/segmentation/segmentation-confirm.service.js';
import { assertModelLicenseIntegrity } from './modules/segmentation/model-license-whitelist.js';
import { PlansController } from './modules/plans/plans.controller.js';
import { PlansRepository } from './modules/plans/plans.repository.js';
import { PlanCommandsRepository } from './modules/plans/plan-commands.repository.js';
import { PlansService } from './modules/plans/plans.service.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { ReportsRepository } from './modules/reports/reports.repository.js';
import { SignatureLogsRepository } from './modules/reports/signature-logs.repository.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { ReportSigningService } from './modules/reports/report-signing.service.js';
import {
  SignatureService,
  TSA_CLIENT,
  UKEY_CERTIFICATE_PROVIDER,
  type TsaClient,
  type UkeyCertificateProvider,
} from './modules/reports/signature.service.js';
import { WadoController } from './modules/wado/wado.controller.js';
import { WadoRepository } from './modules/wado/wado.repository.js';
import { WadoService } from './modules/wado/wado.service.js';
import { PACS_CONFIG, PacsClient, type PacsConfig } from './modules/wado/pacs.client.js';
import { AuditLogsController } from './modules/audit-logs/audit-logs.controller.js';
import { AuditLogsRepository } from './modules/audit-logs/audit-logs.repository.js';
import { AuditLogsService } from './modules/audit-logs/audit-logs.service.js';

/**
 * 应用模块。
 *
 * 分层规则（代码组织门禁）：
 *   controllers -> services -> repositories，依赖只向下。
 *   入口文件只装配，零业务逻辑。
 *
 * ## 启动期强校验
 *
 * 两项断言在模块加载时执行，不通过则**拒绝启动**：
 *   1. `assertAuditEventTypesAligned()` —— 审计事件类型契约与 DB 枚举逐项一致
 *   2. `assertModelLicenseIntegrity()` —— 模型许可白名单完整性（AC-09）
 *
 * 「启动即拒绝」比「运行时拒绝」强得多：不合规的依赖根本进不了生产。
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    // ---- 12 个契约端点所在的 7 个 controller ----
    AuthController,        // POST /auth/login
    StudiesController,     // GET /studies, GET /studies/{uid}/series
    WadoController,        // POST /wado/instances
    SegmentationController,// POST /segmentation-tasks, GET /{id}, POST /{id}/confirm
    PlansController,       // POST /plans, PUT /plans/{id}
    ReportsController,     // GET /reports/{id}, POST /reports/{id}/sign
    AuditLogsController,   // GET /audit-logs
  ],
  providers: [
    // ---- 审计 ----
    // 审计写入走**独立的 app_audit 账号**（只对 audit_logs 有 INSERT/SELECT，
    // 碰不到任何业务表）。见 docs/db/schema.sql 的角色与权限段。
    AuditService,
    HookAuditWriter,
    {
      // 审计钩子通过这个**字符串**令牌拿写入器。
      //
      // 注意两点：
      // 1. `AuditWriter` 是 interface（类型擦除后不存在），不能直接当 DI
      //    令牌用 —— 那样 token 会是 undefined。
      // 2. `useExisting` 要求目标**已注册为 provider**，
      //    否则报 "can't resolve dependencies of the AUDIT_WRITER"。
      provide: 'AUDIT_WRITER',
      useExisting: HookAuditWriter,
    },

    // ---- 基础设施 ----
    AuthoritativeTimeService,
    {
      provide: TIME_CONFIG,
      useFactory: () => loadTimeConfig(),
    },

    // ---- 认证 ----
    AuthRepository,
    AuthService,
    UkeyVerifier,
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
        sessionSecret: Buffer.from(
          process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me',
          'utf8'
        ),
        accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 28800),
        refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL ?? 604800),
        lockThreshold: Number(process.env.LOGIN_LOCK_THRESHOLD ?? 5),
        lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 15),
      }),
    },
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
    {
      // TSA 时间戳服务。生产对接院内 TSA。
      provide: TSA_CLIENT,
      useFactory: (): TsaClient => ({
        timestamp: async () => {
          throw new Error('TSA 服务未配置');
        },
      }),
    },
    {
      // PACS（DICOMweb）基地址。生产指向 dcm4chee-arc-light。
      provide: PACS_CONFIG,
      useFactory: (): PacsConfig => ({
        baseUrl:
          process.env.DICOMWEB_BASE_URL ?? 'http://pacs.example.internal/dicom-web',
        timeoutMs: Number(process.env.PACS_TIMEOUT_MS ?? 15000),
      }),
    },
    // ---- 会话守卫 ----
    AuthGuard,
    {
      // 公钥解析器：RS256 走 Keycloak JWKS，HS256 走本地共享密钥。
      // 两者都验签 —— 不接受未验签的用户头（见 jwt-verifier.ts 的信任模型）。
      provide: KEY_RESOLVER,
      useFactory: () => {
        const sessionSecret = Buffer.from(
          process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me',
          'utf8'
        );
        const issuer = process.env.KEYCLOAK_URL;
        const realm = process.env.KEYCLOAK_REALM;
        if (!issuer || !realm) {
          // 未配置 Keycloak -> 只支持本地自签会话令牌
          return createSharedSecretResolver(sessionSecret);
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
    // ---- 检查 ----
    StudiesRepository,
    SeriesRepository,
    StudiesService,

    // ---- AI 分割 ----
    SegmentationRepository,
    SegmentationConfirmsRepository,
    SegmentationService,
    SegmentationConfirmService,

    // ---- 规划 ----
    PlansRepository,
    PlanCommandsRepository,
    PlansService,

    // ---- 报告 ----
    ReportsRepository,
    SignatureLogsRepository,
    ReportsService,
    ReportSigningService,
    SignatureService,

    // ---- WADO ----
    WadoRepository,
    WadoService,
    PacsClient,

    // ---- 审计查询 ----
    AuditLogsRepository,
    AuditLogsService,
  ],
})
export class AppModule {
  constructor() {
    // 启动期强校验：审计事件类型契约与 DB 枚举必须逐项一致
    assertAuditEventTypesAligned();
    // 启动期强校验：模型许可白名单完整性（AC-09）
    assertModelLicenseIntegrity();
  }
}
