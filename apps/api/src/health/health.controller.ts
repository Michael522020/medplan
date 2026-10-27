import { Controller, Get } from '@nestjs/common';

/**
 * 健康检查。
 *
 * 部署与探针用（架构方案 §11：健康检查是回滚与可观测性的基础）。
 * 不返回任何业务信息，避免成为信息泄露面。
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'medplan-api' };
  }
}
