import { Injectable } from '@nestjs/common';
import type { AuditEvent, AuditWriter } from './audit-hook.js';
import { AuditService } from './audit.service.js';

/**
 * 审计钩子的写入器适配。
 *
 * ## 为什么需要适配层
 *
 * `audit-hook.ts` 是**已就位**的工程状态，它的 `AuditWriter` 接口签名为
 * `append(event: AuditEvent)` —— 事件类型是自由字符串（如 `studies.get`）。
 *
 * 而 `AuditService.append(input: AuditRecordInput)` 面向业务调用，
 * 要求**契约枚举**类型（如 `STUDY_LIST_VIEWED`）—— 因为 PG 的
 * `audit_event_type` 是枚举类型，写入非法值会直接让整个 INSERT 失败。
 *
 * 两者不能合并成一个方法（一个要接受任意字符串，一个要强制枚举），
 * 因此用适配层转换：**自由字符串 -> 契约枚举**。
 *
 * 这样既不改已就位的钩子契约，又保证写入 DB 的永远是合法枚举值。
 */
@Injectable()
export class HookAuditWriter implements AuditWriter {
  constructor(private readonly auditService: AuditService) {}

  async append(event: AuditEvent): Promise<void> {
    await this.auditService.appendEvent(event);
  }
}
