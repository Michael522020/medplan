/**
 * 阅片工作台的中央舞台（Canvas 区 + 序列导航条 + 浮动工具条）。
 *
 * ## Canvas 恒暗（Spec §8 硬约束 1）
 *
 * 背景恒为 `--color-surface-canvas`（亮色主题下也是 `#1A1A1A`），
 * **不随主题切换**。灰阶影像在白底上会丧失诊断对比 ——
 * 这是 AAPM TG-18 诊断阅片站环境照度要求（2–10 lx）推导出的专业约束。
 *
 * ## Canvas 角标用 text-on-canvas（Spec §8 硬约束 2）
 *
 * 角标文字由 `ViewportCanvas` 组件负责，样式在 viewport.css 里，
 * 颜色取 `--color-text-on-canvas`（双主题恒为浅色）。
 * 用 `--color-text-primary` 会在亮色主题下变成深色，叠在近黑 Canvas 上不可见。
 */

import { AlertBanner } from '@/components/ui/alert-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { IconLockAccess } from '@/components/icons';

import { SeriesNavBar } from './series-nav-bar';
import { ViewportCanvas, type ViewportOverlayData, type ViewportPlane } from './viewport-canvas';
import { ViewerToolbar } from './viewer-toolbar';
import type { ToolbarButtonSpec } from './viewer-toolbar';

/** 视口平面。四宫格。 */
const PLANES: ViewportPlane[] = ['axial', 'sagittal', 'coronal', '3d'];

/** 舞台属性。 */
export interface ViewerStageProps {
  /** Canvas 区域尺寸（像素）。由布局计算得出。 */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Canvas 面积是否满足 70% 约束。 */
  readonly meetsCanvasRatio: boolean;
  /** WebGL 是否可用。false 时必须降级 2D 并隐藏三维入口。 */
  readonly webglAvailable: boolean;
  /** 是否为越权态。 */
  readonly forbidden: boolean;
  /** 角标数据。 */
  readonly overlayData: ViewportOverlayData;
  /** 当前层索引。 */
  readonly sliceIndex: number;
  /** 总层数。 */
  readonly totalSlices: number;
  /** 电影回放是否进行中。 */
  readonly cinePlaying: boolean;
  /** 工具条按钮。 */
  readonly toolbarButtons: ReadonlyArray<ToolbarButtonSpec>;
  /** 视口元素就绪回调。 */
  readonly onElementReady: (element: HTMLDivElement, viewportId: string) => void;
  /** 视口元素卸载回调。 */
  readonly onElementRelease: (viewportId: string) => void;
  /** 翻层。 */
  readonly onStep: (delta: number) => void;
  /** 跳转到指定层。 */
  readonly onJump: (index: number) => void;
  /** 切换电影回放。 */
  readonly onToggleCine: () => void;
}

/**
 * 中央舞台。
 */
export function ViewerStage({
  canvasWidth,
  canvasHeight,
  meetsCanvasRatio,
  webglAvailable,
  forbidden,
  overlayData,
  sliceIndex,
  totalSlices,
  cinePlaying,
  toolbarButtons,
  onElementReady,
  onElementRelease,
  onStep,
  onJump,
  onToggleCine,
}: ViewerStageProps) {
  return (
    <div className="viewer__stage">
      {!meetsCanvasRatio ? (
        <AlertBanner level="warning" ariaLive="polite">
          窗口宽度不足，Canvas 占比已低于 70%。
          请折叠右侧栏或使用 1920 及以上分辨率的显示器。
        </AlertBanner>
      ) : null}

      {!webglAvailable ? (
        <AlertBanner level="warning" ariaLive="assertive">
          当前浏览器未启用 WebGL 加速，已降级为 2D 单视图模式。
          三维重建、MPR 多视图与体绘制功能不可用，请使用院内标准浏览器
          （Chrome 113+ / Edge 113+）。
        </AlertBanner>
      ) : null}

      {forbidden ? (
        <div className="viewer__forbidden">
          <EmptyState
            kind="forbidden"
            icon={IconLockAccess}
            title="无法访问该检查"
            description="当前账号无该检查的访问权限。如需授权，请联系影像科管理员。"
          />
        </div>
      ) : (
        <div
          className="viewer__canvas-area"
          style={{
            width: `${canvasWidth}px`,
            height: `${canvasHeight}px`,
          }}
        >
          {PLANES.map((plane) => (
            <ViewportCanvas
              key={plane}
              viewportId={`medplan-vp-${plane}`}
              plane={plane}
              data={{ ...overlayData, plane }}
              onElementReady={(element) =>
                onElementReady(element, `medplan-vp-${plane}`)
              }
              onElementRelease={onElementRelease}
            />
          ))}
        </div>
      )}

      <SeriesNavBar
        currentIndex={sliceIndex}
        total={totalSlices}
        cinePlaying={cinePlaying}
        onStep={onStep}
        onJump={onJump}
        onToggleCine={onToggleCine}
      />

      <div className="viewer__toolbar-float">
        <ViewerToolbar buttons={toolbarButtons} />
      </div>
    </div>
  );
}
