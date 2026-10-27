import { Global, Module } from '@nestjs/common';
import { AUDIT_POOL, DB_POOL, auditPoolConfig, businessPoolConfig, createPool } from './pool.js';

/**
 * 数据库模块。
 *
 * 注册**两个**连接池（等保 8.1.4.2 权限分离）：
 *
 * | 令牌 | 账号 | 用途 |
 * |------|------|------|
 * | `DB_POOL` | `app_rw` | 业务读写。audit_logs 仅 INSERT/SELECT（UPDATE/DELETE 已 REVOKE） |
 * | `AUDIT_POOL` | `app_audit` | **仅** audit_logs 的 INSERT + SELECT，碰不到任何业务表 |
 *
 * 分权理由：业务账号即便被攻破也改不了审计；审计账号即便被攻击也碰不到 PHI。
 *
 * 用 `@Global()` 直接声明 provider（而非 `forRoot()` 返回 DynamicModule）：
 * `@Global()` 的全局作用域依赖**模块元数据**里的 provider，
 * 放进 DynamicModule 的话全局标记不会生效，
 * 依赖方会报「can't resolve dependencies of the AuditService」。
 * 这是 Nest 的一个反直觉点，注释留在这里避免以后有人「优化」回去。
 *
 * 连接串只在本模块出现一次（不散落在业务文件中）。
 */
@Global()
@Module({
  providers: [
    { provide: DB_POOL, useFactory: () => createPool(businessPoolConfig()) },
    { provide: AUDIT_POOL, useFactory: () => createPool(auditPoolConfig()) },
  ],
  exports: [DB_POOL, AUDIT_POOL],
})
export class DatabaseModule {}
