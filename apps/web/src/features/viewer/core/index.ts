/**
 * 阅片区封装层的公开出口。
 *
 * ## 边界规则
 *
 * **只有本目录（及其子目录）允许 import `@cornerstonejs/*`。**
 * 组件一律通过这里的语义化 API 访问阅片能力，不接触 Cornerstone 原始句柄。
 *
 * 理由在 `viewport-manager.ts` 顶部有完整说明：三个具体的坑
 * （preferSizeOverAccuracy 被误关、init 幂等导致的幽灵问题、
 * 工具 enable/diside 不成对导致在新序列上画出旧测量）。
 *
 * 这个边界靠 lint 守护而非靠自觉 —— 见 `scripts/lint_viewer_boundary.js`。
 */

export {
  createViewportManager,
  ensureCornerstoneInitialized,
  releaseVolumeCache,
  type ViewportHandle,
  type ViewportKind,
  type ViewportManagerApi,
} from './viewport-manager';

export { registerTool, unregisterTool } from './tool-registry';

export {
  createLifecycleLedger,
  type LifecycleLedger,
  type ResourceDisposer,
} from './instance-lifecycle';

export {
  detectRenderingCapability,
  shouldHide3dEntry,
  type RenderingCapability,
} from './capability';

export {
  buildSeriesImageIds,
  buildWadorsImageId,
  configureDicomAuth,
  initializeJpeg2000Decoder,
  prefetchImageIds,
  requiresJpeg2000,
  resolveTransferSyntax,
  TRANSFER_SYNTAX_JPEG2000,
  TRANSFER_SYNTAX_UNCOMPRESSED,
} from './dicom-source';

export {
  ALL_TOOLS,
  ALL_TOOL_CLASSES,
  createToolManager,
  findToolByShortcut,
  type ToolManager,
} from './tools/tool-manager';

export {
  applyMeasurementAnnotationStyle,
  measurementTools,
} from './tools/measurement-tools';

export { crosshairTool } from './tools/crosshair-tool';

export {
  applyWindowPreset,
  WINDOW_PRESETS,
  windowLevelTool,
} from './tools/window-level-tool';

export {
  navigationTools,
  panTool,
  stackScrollTool,
  zoomTool,
} from './tools/navigation-tools';

export type {
  MouseBindingKind,
  ToolBinding,
  ToolCategory,
  ViewerTool,
} from './tools/tool-contract';
