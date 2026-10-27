/**
 * Canvas 区与视口。
 *
 * ## Canvas 恒暗（Spec §8 硬约束 1）
 *
 * 背景恒为 `--color-surface-canvas`（亮色主题下也是 `#1A1A1A`），
 * **不随主题切换**。灰阶影像在白底上会丧失诊断对比 ——
 * 这是 AAPM TG-18 诊断阅片站环境照度要求（2–10 lx）推导出的专业约束，
 * 不是审美偏好。
 *
 * ## 角标文字用 text-on-canvas（Spec §8 硬约束 2）
 *
 * Canvas 上的所有文字（序列描述、层号、窗宽窗位、患者标识）
 * 一律用 `--color-text-on-canvas`（双主题恒为浅色）。
 * 用 `--color-text-primary` 会在亮色主题下变成深色，叠在近黑 Canvas 上不可见。
 *
 * ## 临床数值用 .numeric
 *
 * 窗宽窗位、层号、HU 值在拖动时必须**不跳动** —— 医生盯着这些数字读，
 * 跳动会造成误读。因此一律加 `.numeric` 类（tabular-nums 等宽）。
 */

import { useEffect, useRef } from 'react';

import { IconLoader2 } from '@/components/icons';

/** 视口的平面标识。 */
export type ViewportPlane = 'axial' | 'sagittal' | 'coronal' | '3d';

/** 视口角标数据。 */
export interface ViewportOverlayData {
  /** 平面标识。 */
  readonly plane: ViewportPlane;
  /** 左上：序列描述 + 模态。 */
  readonly seriesDescription: string;
  /** 右上：当前层 / 总层数。 */
  readonly sliceIndex: number;
  readonly sliceTotal: number;
  /** 右上：窗宽窗位。 */
  readonly windowWidth: number;
  readonly windowLevel: number;
  /** 左下：患者标识（DICOM 强制，防左右误读）。 */
  readonly patientLabel: string;
  /** 右下：层厚与重建间距。 */
  readonly sliceThickness: string;
  /** 当前 HU 值。十字定位激活时显示。 */
  readonly huValue: number | null;
  /** 加载进度（0–1）。null 表示不显示进度。 */
  readonly loadProgress: number | null;
  /** 加载中的层数描述。 */
  readonly loadProgressLabel: string | null;
}

/** 平面标识的中文名。 */
const PLANE_LABEL: Record<ViewportPlane, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
  '3d': '3D',
};

/** 视口组件属性。 */
export interface ViewportCanvasProps {
  readonly viewportId: string;
  readonly plane: ViewportPlane;
  readonly data: ViewportOverlayData;
  /** 挂载视口 DOM 节点的回调。 */
  readonly onElementReady: (element: HTMLDivElement) => void;
  /** 元素卸载通知。 */
  readonly onElementRelease: (viewportId: string) => void;
}

/**
 * 单个视口。
 *
 * DOM 结构刻意保持简单：一个定位容器（Cornerstone 挂 canvas）+ 一个
 * overlay 层（角标）。overlay 用 `pointer-events: none` ——
 * 角标不响应点击，避免误触遮挡影像（UIUX-P2 §3.4.4）。
 */
export function ViewportCanvas({
  viewportId,
  plane,
  data,
  onElementReady,
  onElementRelease,
}: ViewportCanvasProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    onElementReady(element);
    return () => {
      onElementRelease(viewportId);
    };
  }, [onElementReady, onElementRelease, viewportId]);

  return (
    <div className="viewport">
      <div
        ref={elementRef}
        className="viewport__canvas"
        data-viewport-id={viewportId}
      />

      <div className="viewport__overlay" aria-hidden>
        <div className="viewport__corner viewport__corner--tl">
          <span className="viewport__plane">{PLANE_LABEL[plane]}</span>
          <span className="viewport__series">{data.seriesDescription}</span>
        </div>

        <div className="viewport__corner viewport__corner--tr">
          <span className="numeric">
            {data.sliceIndex}/{data.sliceTotal}
          </span>
          <span className="numeric">
            W:{data.windowWidth} L:{data.windowLevel}
          </span>
        </div>

        <div className="viewport__corner viewport__corner--bl">
          <span className="numeric">{data.patientLabel}</span>
        </div>

        <div className="viewport__corner viewport__corner--br">
          <span className="numeric">{data.sliceThickness}</span>
        </div>

        {data.huValue !== null ? (
          <div className="viewport__hu numeric">HU:{data.huValue}</div>
        ) : null}
      </div>

      {data.loadProgress !== null ? (
        <div className="viewport__loading" role="status">
          <IconLoader2 size={32} strokeWidth={1.75} aria-hidden className="spin" />
          <p className="viewport__loading-title">
            正在加载序列 {data.seriesDescription}
          </p>
          {data.loadProgressLabel ? (
            <p className="viewport__loading-detail numeric">
              {data.loadProgressLabel}
            </p>
          ) : null}
          <div className="viewport__progress">
            <div
              className="viewport__progress-fill"
              style={{ width: `${Math.round(data.loadProgress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
