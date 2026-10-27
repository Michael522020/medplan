import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { registerAuditHook } from './common/audit/audit-hook.js';
import { AppExceptionFilter } from './common/errors/exception.filter.js';

/**
 * 服务入口。
 *
 * 原则：**入口文件只做装配，零业务逻辑**（代码组织门禁）。
 * 任何业务判断都不该出现在这里。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      // 院内网络仍需防低速攻击，等保 2.0 三级要求
      bodyLimit: 2 * 1024 * 1024,
      trustProxy: true,
    })
  );

  // 全局前缀与契约一致：/api/v1
  app.setGlobalPrefix('api/v1');

  // 全局异常过滤器：把任何异常转成契约规定的统一响应体。
  // 10004 与 10005 的响应体字节数相同（防 Content-Length 侧信道）。
  app.useGlobalFilters(new AppExceptionFilter());

  // 审计钩子：每一次 PHI 访问都必须留痕。
  // 挂在 onRequest 而非业务层 —— 业务代码可能忘记调用，且失败路径
  // （越权被拒）同样必须审计（架构方案 §10.4）。
  registerAuditHook(app);

  // CORS：院内部署通常同源，此处仅放开开发期需要
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  // 优雅停机：让在途请求完成，避免审计写入被截断
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`MedPlan API 已启动，监听 :${port}`);
}

void bootstrap();
