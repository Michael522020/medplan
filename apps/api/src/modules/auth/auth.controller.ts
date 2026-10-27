import { Body, Controller, Post } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { parseOrThrow } from '../../common/validation/schema.js';
import { AuthService } from './auth.service.js';
import { loginRequestSchema } from './auth.schema.js';

/**
 * 认证端点。
 *
 * 只做三件事：参数校验 -> 调 service -> 组装响应。
 * 任何业务判断都不出现在这里（代码组织门禁）。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/login
   *
   * 双因素登录（口令 + UKey SM2 数字证书）。
   *
   * 无需认证（security: []），因此不挂 AuthGuard。
   * 成功与失败**均**写审计 —— 由审计钩子按路径覆盖 /auth/login。
   */
  @Post('login')
  async login(@Body() body: unknown): Promise<components['schemas']['LoginResponse']> {
    const request = parseOrThrow(loginRequestSchema, body, 'login');
    const result = await this.authService.login({
      username: request.username,
      password: request.password,
      ukeyCert: request.ukey_cert,
    });
    return {
      code: 0,
      message: '',
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        ntpOffsetMs: result.ntpOffsetMs,
        user: result.user,
        ukey: result.ukey,
      },
    };
  }
}
