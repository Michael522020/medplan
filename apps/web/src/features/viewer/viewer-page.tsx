/**
 * 阅片工作台 `/viewer/:studyUid`。
 *
 * ## 本页的三条硬约束
 *
 * 1. **Canvas 恒暗** —— 背景用 `--color-surface-canvas`，不随主题切换。
 * 2. **Canvas 角标用 `--color-text-on-canvas`** —— 不得用 text-primary。
 * 3. **Canvas 面积 ≥ 70%** —— 1920 下左栏默认折叠为 64px 图标栏。
 *
 * ## GPU 生命周期
 *
 * 组件卸载时必须释放：渲染引擎（WebGL 上下文）、工具组（事件监听）、
 * 体数据缓存。这三样都在 `features/viewer/core` 的登记簿里登记，
 * 卸载时统一后进先出释放。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ViewerStage } from './components/viewer-stage';
import { createToolbarButtons } from './components/toolbar-buttons';
import type { ViewportOverlayData } from './components/viewport-canvas';
import { ViewerSidebarLeft, ViewerSidebarRight } from './components/viewer-sidebars';
import { useSeriesList } from './hooks/use-series-list';
import { useViewerRuntime } from './hooks/use-viewer-runtime';
import { useViewerShortcuts } from './hooks/use-viewer-shortcuts';
import {
  computeViewerLayout,
  deriveDefaultLeftCollapsed,
  persistLeftCollapsed,
  readPersistedLeftCollapsed,
} from './viewer-layout';

/** 组件属性。 */
export interface ViewerPageProps {
  readonly studyUid: string;
}

/**
 * 阅片工作台。
 */
export function ViewerPage({ studyUid }: ViewerPageProps) {
  const {
    series,
    loading,
    loadError,
    selectedSeriesUid,
    selectSeries,
  } = useSeriesList(studyUid);

  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [cinePlaying, setCinePlaying] = useState(false);
  const [sliceIndex, setSliceIndex] = useState(0);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  /**
   * 左栏折叠状态。持久化优先于按分辨率推导的默认值 ——
   * 医生展开过一次就记住，避免每次进阅片页都要重新展开。
   */
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    const persisted = readPersistedLeftCollapsed();
    return persisted ?? deriveDefaultLeftCollapsed(window.innerWidth);
  });
  const [rightCollapsed] = useState(false);

  /**
   * 渲染运行时。GPU 资源的申请与释放在这里成对 ——
   * 卸载时自动释放 WebGL 上下文与工具组监听。
   */
  const { manager, webglAvailable } = useViewerRuntime(studyUid);

  // 视口尺寸监听。UI 尺寸恒定，只有 Canvas 随屏扩大。
  useEffect(() => {
    const onResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const layout = useMemo(
    () =>
      computeViewerLayout({
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        leftCollapsed,
        rightCollapsed,
      }),
    [leftCollapsed, rightCollapsed, viewportSize],
  );

  const selectedSeries = useMemo(() => {
    if (!series) {
      return null;
    }
    for (const group of series.phaseGroups) {
      const found = group.series.find(
        (item) => item.seriesUid === selectedSeriesUid,
      );
      if (found) {
        return found;
      }
    }
    return null;
  }, [selectedSeriesUid, series]);

  const totalSlices = selectedSeries?.instanceCount ?? 0;

  const onElementReady = useCallback(
    (element: HTMLDivElement, viewportId: string) => {
      if (!manager) {
        return;
      }
      try {
        manager.enableViewport({
          viewportId,
          element,
          kind: 'volume',
        });
      } catch (error) {
        console.error('[viewer] 启用视口失败', viewportId, error);
      }
    },
    [manager],
  );

  const onElementRelease = useCallback(
    (viewportId: string) => {
      manager?.disableViewport(viewportId);
    },
    [manager],
  );

  const onSelectTool = useCallback((toolId: string) => {
    setActiveToolId((current) =>
      toolId === '' ? null : current === toolId ? null : toolId,
    );
  }, []);

  const onToggleCine = useCallback(() => {
    setCinePlaying((playing) => !playing);
  }, []);

  useViewerShortcuts({ onSelectTool, onToggleCine });

  const onStep = useCallback(
    (delta: number) => {
      setSliceIndex((current) =>
        Math.min(Math.max(current + delta, 0), Math.max(totalSlices - 1, 0)),
      );
    },
    [totalSlices],
  );

  const toggleLeftCollapsed = useCallback(() => {
    setLeftCollapsed((collapsed) => {
      const next = !collapsed;
      persistLeftCollapsed(next);
      return next;
    });
  }, []);

  const overlayData = useMemo<ViewportOverlayData>(
    () => ({
      plane: 'axial',
      seriesDescription: selectedSeries?.description ?? '序列加载中',
      sliceIndex,
      sliceTotal: totalSlices,
      windowWidth: selectedSeries?.windowWidth ?? 0,
      windowLevel: selectedSeries?.windowCenter ?? 0,
      patientLabel: '患者标识待载入',
      sliceThickness: `${selectedSeries?.sliceThicknessMm ?? '—'}mm`,
      huValue: null,
      loadProgress: loading ? 0.3 : null,
      loadProgressLabel: loading ? '已加载 0/0 层 0%' : null,
    }),
    [loading, selectedSeries, sliceIndex, totalSlices],
  );

  const toolbarButtons = useMemo(
    () =>
      createToolbarButtons({
        activeToolId,
        cinePlaying,
        canRender3d: webglAvailable,
        canRender3dReason: webglAvailable
          ? undefined
          : 'WebGL 不可用，三维重建功能已降级关闭',
        onSelectTool,
        onToggleCine,
        onToggleFullscreen: () => undefined,
      }),
    [activeToolId, cinePlaying, onSelectTool, onToggleCine, webglAvailable],
  );

  const forbidden = Boolean(loadError && loadError.includes('权限'));

  return (
    <div className="viewer">
      <div
        className="viewer__left"
        style={{ width: `${layout.leftWidth}px` }}
        data-collapsed={leftCollapsed}
      >
        <ViewerSidebarLeft
          collapsed={leftCollapsed}
          onToggleCollapsed={toggleLeftCollapsed}
          loading={loading}
          loadError={loadError}
          series={series}
          selectedSeriesUid={selectedSeriesUid}
          studyUid={studyUid}
          onSelectSeries={(uid) => {
            selectSeries(uid);
            setSliceIndex(0);
          }}
        />
      </div>

      <ViewerStage
        canvasWidth={layout.canvasWidth}
        canvasHeight={layout.canvasHeight}
        meetsCanvasRatio={layout.meetsCanvasRatio}
        webglAvailable={webglAvailable}
        forbidden={forbidden}
        overlayData={overlayData}
        sliceIndex={sliceIndex}
        totalSlices={totalSlices}
        cinePlaying={cinePlaying}
        toolbarButtons={toolbarButtons}
        onElementReady={onElementReady}
        onElementRelease={onElementRelease}
        onStep={onStep}
        onJump={setSliceIndex}
        onToggleCine={onToggleCine}
      />

      <div
        className="viewer__right"
        style={{ width: `${layout.rightWidth}px` }}
        data-collapsed={rightCollapsed}
      >
        <ViewerSidebarRight collapsed={rightCollapsed} />
      </div>
    </div>
  );
}

/**
 * 默认导出。
 *
 * `React.lazy` 要求模块有 default 导出。保留具名导出是为了让
 * 本模块可被直接引用与单测 —— 两条路径指向同一个组件。
 */
export default ViewerPage;
