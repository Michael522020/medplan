import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { AuditService } from './common/audit/audit.service.js';
import { HookAuditWriter } from './common/audit/hook-audit-writer.js';
import { DatabaseModule } from './common/db/database.module.js';
import { ExternalAdaptersModule } from './common/adapters/external-adapters.module.js';
import { QueueModule } from './common/queue/queue.module.js';
import { assertAuditEventTypesAligned } from './common/audit/audit-event-type.js';

import { AuthController } from './modules/auth/auth.controller.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { UkeyVerifier } from './modules/auth/ukey-verifier.service.js';
import { StudiesController } from './modules/studies/studies.controller.js';
import { StudiesRepository } from './modules/studies/studies.repository.js';
import { StudiesService } from './modules/studies/studies.service.js';
import { SeriesRepository } from './modules/studies/series.repository.js';
import { WadoController } from './modules/wado/wado.controller.js';
import { WadoRepository } from './modules/wado/wado.repository.js';
import { WadoService } from './modules/wado/wado.service.js';
import { PacsClient } from './modules/wado/pacs.client.js';
import { SegmentationController } from './modules/segmentation/segmentation.controller.js';
import { SegmentationRepository } from './modules/segmentation/segmentation.repository.js';
import { SegmentationService } from './modules/segmentation/segmentation.service.js';
import { SegmentationConfirmService } from './modules/segmentation/segmentation-confirm.service.js';
import { SegmentationConfirmsRepository } from './modules/segmentation/segmentation-confirms.repository.js';
import { assertModelLicenseIntegrity } from './modules/segmentation/model-license-whitelist.js';
import { PlansController } from './modules/plans/plans.controller.js';
import { PlansRepository } from './modules/plans/plans.repository.js';
import { PlansService } from './modules/plans/plans.service.js';
import { PlanCommandsRepository } from './modules/plans/plan-commands.repository.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { ReportsRepository } from './modules/reports/reports.repository.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { ReportSigningService } from './modules/reports/report-signing.service.js';
import { SignatureLogsRepository } from './modules/reports/signature-logs.repository.js';
import { SignatureService } from './modules/reports/signature.service.js';
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
  imports: [DatabaseModule, ExternalAdaptersModule, QueueModule],
  controllers: [
    HealthController,
    // ---- 12 个契约端点所在的 7 个 controller ----
    AuthController,         // POST /auth/login
    StudiesController,      // GET /studies, GET /studies/{uid}/series
    WadoController,         // POST /wado/instances
    SegmentationController, // POST /segmentation-tasks, GET /{id}, POST /{id}/confirm
    PlansController,        // POST /plans, PUT /plans/{id}
    ReportsController,      // GET /reports/{id}, POST /reports/{id}/sign
    AuditLogsController,    // GET /audit-logs
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

    // ---- 认证 ----
    AuthRepository,
    AuthService,
    UkeyVerifier,

    // ---- 检查 ----
    StudiesRepository,
    SeriesRepository,
    StudiesService,

    // ---- WADO ----
    WadoRepository,
    WadoService,
    PacsClient,

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
