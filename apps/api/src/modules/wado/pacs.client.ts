import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';

/**
 * DICOMweb (WADO-RS) 客户端。
 *
 * ## 为什么要经阅片网关代理而不直连 PACS
 *
 * 契约给出三条理由：
 *   1. PACS 不可绕过审计（每次取图必须落 audit_logs，AC-17）
 *   2. 可在网关层强制 L3 患者数据权限（直连 PACS 会绕过本系统授权模型）
 *   3. 可隐藏院内 PACS 拓扑（等保 8.1.4.6）
 *
 * 因此本客户端**只由后端调用**，不把 PACS 地址暴露给前端。
 */
export interface PacsConfig {
  /** dcm4chee 的 DICOMweb 基地址 */
  baseUrl: string;
  /** 请求超时（毫秒） */
  timeoutMs: number;
}

export interface PacsInstance {
  sopUid: string;
  instanceNumber: number;
  rows: number;
  columns: number;
  sizeBytes: number | null;
}

/** DICOMweb 传输语法 -> Accept 头 */
const TRANSFER_SYNTAX_ACCEPT: Record<string, string> = {
  '1.2.840.10008.1.2.4.90': 'application/dicom; transfer-syntax=1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.1': 'application/dicom; transfer-syntax=1.2.840.10008.1.2.1',
};

/** DI 令牌。interface 编译后被擦除，不能直接当 Nest 令牌用 */
export const PACS_CONFIG = 'PACS_CONFIG';

@Injectable()
export class PacsClient {
  constructor(@Inject(PACS_CONFIG) private readonly config: PacsConfig) {}

  /**
   * 取实例的 DICOM 二进制流。
   *
   * @param seriesUid DICOM 序列 UID
   * @param sopUids   要取的实例 SOP UID 列表
   * @param transferSyntaxUid 期望的传输语法
   * @returns DICOM Part 10 二进制内容
   */
  async retrieveInstances(
    seriesUid: string,
    sopUids: string[],
    transferSyntaxUid: string
  ): Promise<Buffer> {
    const url = `${this.config.baseUrl}/studies/series/${encodeURIComponent(seriesUid)}/instances`;
    const accept =
      TRANSFER_SYNTAX_ACCEPT[transferSyntaxUid] ??
      'application/dicom; transfer-syntax=1.2.840.10008.1.2.4.90';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: accept,
          // DICOMweb 用标准 HTTP 头表达实例选择
          'X-Instance-UIDs': sopUids.join(','),
        },
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw AppError.pacsObjectNotFound();
      }
      if (!response.ok) {
        // 5xx 视为 PACS 不可达（503），4xx 视为对象缺失
        if (response.status >= 500) {
          throw AppError.pacsUnreachable();
        }
        throw AppError.pacsFetchFailed({
          loadedInstanceCount: 0,
          requestedInstanceCount: sopUids.length,
          retryable: response.status >= 500,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 网络错误 / 超时 -> PACS 不可达
      throw AppError.pacsUnreachable();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 取实例的 DICOM JSON 元数据。
   *
   * `metadataOnly: true` 时用这个 —— 阅片启动流程先取元数据渲染序列结构
   * （几十 KB），再渐进填充像素（AC-05 首帧 ≤3s）。
   */
  async retrieveMetadata(
    seriesUid: string,
    sopUids: string[]
  ): Promise<unknown[]> {
    const url = `${this.config.baseUrl}/studies/series/${encodeURIComponent(seriesUid)}/instances`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/dicom+json',
          'X-Instance-UIDs': sopUids.join(','),
        },
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw AppError.pacsObjectNotFound();
      }
      if (!response.ok) {
        if (response.status >= 500) {
          throw AppError.pacsUnreachable();
        }
        throw AppError.pacsFetchFailed({
          loadedInstanceCount: 0,
          requestedInstanceCount: sopUids.length,
          retryable: false,
        });
      }

      return (await response.json()) as unknown[];
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.pacsUnreachable();
    } finally {
      clearTimeout(timer);
    }
  }
}
