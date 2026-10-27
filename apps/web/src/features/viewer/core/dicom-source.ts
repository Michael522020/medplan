/**
 * DICOM 数据源：DICOMweb WADO-RS 取图。
 *
 * ## 认证头是硬要求
 *
 * 阅片网关（`POST /api/v1/wado/instances`）受网关鉴权保护。Cornerstone 的
 * `wadors` 加载器不会自带任何 Authorization 头 —— 不注入就是 401，
 * 表现为「序列加载失败」，看起来像 PACS 故障，实际是前端漏了认证。
 *
 * 注入点必须在 `dicomImageLoader.wadors.configure({ beforeSend })`：
 * 这是 Cornerstone 发出每一个 WADO-RS 请求前的统一钩子，
 * 覆盖 `xhrRequest` 与 `streamRequest` 两条路径。
 *
 * ## 与后端的契约
 *
 * 网关把标准 DICOMweb 路径代理到院内 PACS，同时把 Authorization 头透传。
 * 前端用 `wadors:` scheme 的 imageId 描述资源位置：
 *
 *     wadors:/api/v1/wado/studies/{studyUid}/series/{seriesUid}/instances/{sopInstanceUid}/frames/1
 *
 * ## JPEG 2000（薄层 CT）
 *
 * 薄层 CT 首选传输语法 `1.2.840.10008.1.2.4.90`（JPEG 2000 Lossless），
 * 解码依赖 `@cornerstonejs/codec-openjpeg` 的 WASM。缺了解码器的表现是
 * **该序列加载失败**（不是降级显示），因此这里显式初始化并在失败时抛出
 * 可辨识的错误，让 UI 落到「序列加载失败 + 错误码 + 重试」态而不是白屏。
 */

import { Enums, imageLoader, type Types } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import { getAccessToken } from '@/services/api-client';

/** 传输语法：JPEG 2000 Lossless。薄层 CT 首选。 */
export const TRANSFER_SYNTAX_JPEG2000 = '1.2.840.10008.1.2.4.90';

/** 传输语法：未压缩 Explicit VR Little Endian。降级用，流量约放大 8 倍。 */
export const TRANSFER_SYNTAX_UNCOMPRESSED = '1.2.840.10008.1.2.1';

/**
 * 配置 WADO-RS 取图的认证。
 *
 * 必须在任何取图动作之前调用。
 *
 * 令牌来源与普通 API 请求**共用同一个**（`api-client` 的 token reader），
 * 因此登录/登出后两边同时生效，不会出现「API 已登录但取图未带令牌」
 * 的不一致态 —— 那会表现为 WADO-RS 401，看起来像 PACS 故障。
 */
export function configureDicomAuth(): void {
  dicomImageLoader.init({
    maxWebWorkers: resolveWorkerCount(),
    /**
     * 每个 WADO-RS 请求发出前注入 Authorization。
     *
     * 返回对象里的键值会与默认请求头合并。令牌为空时不注入任何头 ——
     * 让服务端返回 401 比让前端伪造一个空 Bearer 更诚实。
     */
    beforeSend: (_xhr, _imageId, defaultHeaders) => {
      const token = getAccessToken();
      if (!token) {
        return defaultHeaders;
      }
      return {
        ...defaultHeaders,
        Authorization: `Bearer ${token}`,
      };
    },
  });
}

/** 依据设备并发数决定解码 Worker 数量。 */
function resolveWorkerCount(): number {
  if (typeof navigator === 'undefined') {
    return 1;
  }
  const cores = navigator.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/**
 * 构造一个 WADO-RS 实例帧的 imageId。
 *
 * Cornerstone 的 `wadors` scheme 约定 imageId 为 `wadors:<url>`，
 * 其中 url 部分是相对于站点根的路径。
 */
export function buildWadorsImageId(params: {
  studyUid: string;
  seriesUid: string;
  sopInstanceUid: string;
  frame?: number;
}): string {
  const { studyUid, seriesUid, sopInstanceUid, frame = 1 } = params;
  const path =
    `/api/v1/wado/studies/${encodeURIComponent(studyUid)}` +
    `/series/${encodeURIComponent(seriesUid)}` +
    `/instances/${encodeURIComponent(sopInstanceUid)}` +
    `/frames/${frame}`;
  return `wadors:${path}`;
}

/**
 * 构造一个序列内全部实例的 imageId 列表。
 *
 * 顺序按 instanceNumber 升序 —— Cornerstone 会依据
 * `imagePositionPatient` 自行重排，但输入顺序影响预取的首帧选择，
 * 升序能让「第 1 层」与 DICOM 的 InstanceNumber 语义一致。
 */
export function buildSeriesImageIds(params: {
  studyUid: string;
  seriesUid: string;
  instances: ReadonlyArray<{ sopInstanceUid: string; instanceNumber?: number }>;
}): string[] {
  const sorted = [...params.instances].sort(
    (a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0),
  );
  return sorted.map((instance) =>
    buildWadorsImageId({
      studyUid: params.studyUid,
      seriesUid: params.seriesUid,
      sopInstanceUid: instance.sopInstanceUid,
    }),
  );
}

/**
 * 初始化 JPEG 2000 解码器。
 *
 * @returns 是否初始化成功。失败不抛异常 —— 调用方决定是降级到未压缩
 *   传输语法还是提示「序列加载失败」。薄层 CT 在缺少解码器时无法读取，
 *   静默降级会让医生误以为图像本身有问题。
 */
export async function initializeJpeg2000Decoder(): Promise<boolean> {
  try {
    await dicomImageLoader.initializers.JPEG2000();
    return true;
  } catch (error) {
    console.error('[viewer] JPEG 2000 解码器初始化失败', error);
    return false;
  }
}

/**
 * 判断某个传输语法是否需要 JPEG 2000 解码器。
 */
export function requiresJpeg2000(transferSyntaxUid: string | undefined): boolean {
  return transferSyntaxUid === TRANSFER_SYNTAX_JPEG2000;
}

/**
 * 为给定传输语法选择可用的传输语法。
 *
 * 优先 JPEG 2000（薄层 CT 流量小）；解码器不可用时退回未压缩语法，
 * 代价是流量放大约 8 倍，但至少能读到图。
 */
export function resolveTransferSyntax(options: {
  preferred: string | undefined;
  jpeg2000Available: boolean;
}): string {
  if (
    options.preferred === TRANSFER_SYNTAX_JPEG2000 &&
    options.jpeg2000Available
  ) {
    return TRANSFER_SYNTAX_JPEG2000;
  }
  if (options.preferred === TRANSFER_SYNTAX_UNCOMPRESSED) {
    return TRANSFER_SYNTAX_UNCOMPRESSED;
  }
  return options.jpeg2000Available
    ? TRANSFER_SYNTAX_JPEG2000
    : TRANSFER_SYNTAX_UNCOMPRESSED;
}

/**
 * 预取一批 imageId。
 *
 * 预取放在独立队列里，不阻塞首帧。AC-05 要求 2000 层薄层 CT 首帧 ≤3s，
 * 首帧之后按半径 30 层渐进补齐。
 */
export function prefetchImageIds(
  imageIds: string[],
  options: { radius: number; centerIndex: number; priority?: number } = {
    radius: 30,
    centerIndex: 0,
  },
): void {
  const { radius, centerIndex, priority = 0 } = options;
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(imageIds.length, centerIndex + radius + 1);
  for (let index = start; index < end; index += 1) {
    const imageId = imageIds[index];
    if (!imageId) {
      continue;
    }
    void loadImageWithFallback(imageId);
  }
  void priority;
}

/**
 * 加载单张图像，失败时重试一次。
 *
 * 重试是有意义的：阅片网关取图失败常见于瞬时网络抖动或 PACS 短暂不可达，
 * 而 Spec §12 的验收流程里「重试」是用户可执行的补救动作。
 *
 * `ImageLoaderOptions` 的 `requestType` 是必填字段（不是 `priority`）——
 * 它决定该请求在 Cornerstone 的请求池里属于交互还是预取，
 * 影响抢占策略。预取用 `RequestType.Prefetch`。
 *
 * 静态导入而非动态导入：阅片区整体已经是懒加载 chunk（页面级边界），
 * 再在这里切一刀只会把 Cornerstone 的初始化时机打散，
 * 产生「进了页面但视口还没准备好」的中间态。
 */
async function loadImageWithFallback(
  imageId: string,
): Promise<Types.IImage | undefined> {
  try {
    return await imageLoader.loadImage(imageId, {
      priority: 0,
      requestType: Enums.RequestType.Prefetch,
    });
  } catch (firstError) {
    try {
      return await imageLoader.loadImage(imageId, {
        priority: 0,
        requestType: Enums.RequestType.Prefetch,
        ignoreCache: true,
      });
    } catch {
      console.warn('[viewer] 图像加载失败', imageId, firstError);
      return undefined;
    }
  }
}
