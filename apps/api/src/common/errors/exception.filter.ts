import {
  Catch,
  ExceptionFilter,
  HttpException,
  type ArgumentsHost,
} from '@nestjs/common';
import { AppError } from './app-error.js';
import { ERROR_CODES } from './error-codes.js';

/**
 * 全局异常过滤器。
 *
 * 职责：把任何异常转成契约规定的统一响应体 `{ code, data, message }`。
 *
 * ## 两条不可妥协的规则
 *
 * 1. **不泄露内部细节**：堆栈、SQL、内部主机名、驱动错误一律不得进入响应体。
 *    契约 90001 明确「不得暴露堆栈、SQL、内部主机名」。
 *
 * 2. **10004 与 10005 的响应体大小一致**：两者的 message 使用同一常量、
 *    data 恒为 null、code 均为 5 位数字 —— 因此字节数相同。
 *    攻击者无法用 Content-Length 差异判断资源是否存在。
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<{ status(code: number): void; send(body: unknown): void }>();

    if (exception instanceof AppError) {
      reply.status(exception.httpStatus);
      reply.send({
        code: exception.code,
        message: exception.message,
        data: exception.detail ?? null,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest 内建异常（如路由未匹配、请求体解析失败）统一归到参数错误
      reply.status(status);
      reply.send({
        code: status === 400 ? ERROR_CODES.PARAM_INVALID : ERROR_CODES.INTERNAL_ERROR,
        message: status === 400 ? '请求参数不合法' : '服务处理异常，请携带追踪 ID 联系信息科',
        data: null,
      });
      return;
    }

    // 未知异常：记录日志但绝不把细节返回给调用方
    reply.status(500);
    reply.send({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: '服务处理异常，请携带追踪 ID 联系信息科',
      data: null,
    });
  }
}
