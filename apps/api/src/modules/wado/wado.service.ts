import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { PacsClient } from './pacs.client.js';
import { WadoRepository } from './wado.repository.js';

/**
 * DICOM 取图服务。
 */
@Injectable()
export class WadoService {
  constructor(
    private readonly repository: WadoRepository,
    private readonly pacsClient: PacsClient
  ) {}

  /**
   * POST /api/v1/wado/instances
   *
   * 取图代理。
   *
   * ## 权限
   *
   * 取图是 PHI 访问，必须先过 L3 数据权限。
   * 「检查不存在」与「无权限」都表现为可见性谓词过滤后 0 行 ->
   * 同一个 10004，响应体字节数相同。
   *
   * ## 性能（AC-05）
   *
   * - `metadataOnly: true` 只返回 DICOM JSON 元数据（几十 KB），
   *   前端先渲染序列结构再渐进填充像素
   * - `maxInstances` 限制单次批量上限，防止一次请求拖垮首帧
   */
  async retrieveInstances(
    session: Session,
    request: {
      studyUid: string;
      seriesUid: string;
      instanceNumbers?: number[];
      sopInstanceUids?: string[];
      transferSyntaxUid: string;
      maxInstances?: number;
      metadataOnly?: boolean;
    }
  ): Promise<{
    metadataOnly: boolean;
    metadata?: unknown[];
    binary?: Buffer;
    instanceCount: number;
  }> {
    const access = toAccessContext(session);

    // 恒定索引路径的探测查询
    await this.repository.probeSeries(request.seriesUid);

    const series = await this.repository.findSeries(
      request.studyUid,
      request.seriesUid,
      access
    );
    if (!series) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    // 确定要取哪些实例
    const maxInstances = request.maxInstances ?? 64;
    let instances;
    if (request.sopInstanceUids && request.sopInstanceUids.length > 0) {
      instances = await this.repository.findInstancesBySopUids(
        request.seriesUid,
        request.sopInstanceUids
      );
    } else {
      instances = await this.repository.findInstances(
        request.seriesUid,
        request.instanceNumbers
      );
    }

    if (instances.length === 0) {
      throw AppError.pacsObjectNotFound();
    }
    if (instances.length > maxInstances) {
      throw AppError.paramInvalid(
        `单次请求的实例数不得超过 ${maxInstances}，请缩小取图窗口`
      );
    }

    const sopUids = instances.map((item) => item.sop_uid);

    // 元数据模式：只回 DICOM JSON，不取像素
    if (request.metadataOnly === true) {
      const metadata = await this.pacsClient.retrieveMetadata(
        request.seriesUid,
        sopUids
      );
      return { metadataOnly: true, metadata, instanceCount: instances.length };
    }

    // 二进制模式
    const binary = await this.pacsClient.retrieveInstances(
      request.seriesUid,
      sopUids,
      request.transferSyntaxUid
    );
    return { metadataOnly: false, binary, instanceCount: instances.length };
  }
}
