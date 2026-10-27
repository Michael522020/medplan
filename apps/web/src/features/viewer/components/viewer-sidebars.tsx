/**
 * 阅片工作台的左右侧栏。
 *
 * ## 为什么要拆
 *
 * 侧栏有独立的三态（加载 / 错误 / 正常）与独立的重试逻辑，
 * 留在主页面里会让主组件超过单一职责，也超过 300 行的文件上限。
 *
 * ## 折叠态的语义
 *
 * 左栏折叠为 64px 图标栏是 **Canvas ≥ 70% 的算术结果**，
 * 不是界面偏好 —— 见 `viewer-layout.ts` 顶部的对照表。
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLockAccess,
} from '@/components/icons';

import { listSeries, type SeriesGroupedData } from '@/services/medplan-service';

import { SeriesListPanel } from './series-list-panel';

/** 序列分组响应。 */
type SeriesGrouped = SeriesGroupedData;

/** 左侧栏属性。 */
export interface ViewerSidebarLeftProps {
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly series: SeriesGrouped | null;
  readonly selectedSeriesUid: string | null;
  readonly studyUid: string;
  readonly onSelectSeries: (seriesUid: string) => void;
}

/**
 * 左侧栏（患者与序列）。
 */
export function ViewerSidebarLeft({
  collapsed,
  onToggleCollapsed,
  loading,
  loadError,
  series,
  selectedSeriesUid,
  studyUid,
  onSelectSeries,
}: ViewerSidebarLeftProps) {
  if (collapsed) {
    return (
      <div className="viewer__left-rail">
        <button
          type="button"
          className="viewer__rail-button"
          onClick={onToggleCollapsed}
          aria-label="展开左侧栏（Ctrl+\）"
          title="展开左侧栏（Ctrl+\）"
        >
          <IconLayoutSidebarLeftExpand size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="viewer__rail-hint numeric">S4</span>
      </div>
    );
  }

  return (
    <>
      <div className="viewer__left-header">
        <span className="viewer__panel-title">患者与序列</span>
        <button
          type="button"
          className="viewer__rail-button"
          onClick={onToggleCollapsed}
          aria-label="折叠左侧栏（Ctrl+\）"
          title="折叠左侧栏（Ctrl+\）"
        >
          <IconLayoutSidebarLeftCollapse size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="viewer__left-body">
        <SeriesListBody
          loading={loading}
          loadError={loadError}
          series={series}
          selectedSeriesUid={selectedSeriesUid}
          studyUid={studyUid}
          onSelectSeries={onSelectSeries}
        />
      </div>
    </>
  );
}

/** 序列列表主体。 */
interface SeriesListBodyProps {
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly series: SeriesGrouped | null;
  readonly selectedSeriesUid: string | null;
  readonly studyUid: string;
  readonly onSelectSeries: (seriesUid: string) => void;
}

/**
 * 序列列表主体。
 *
 * 三态分离：加载中 / 加载失败 / 正常。失败态提供重试，
 * 因为「重试」是医生在瞬时网络抖动后最直接的自救动作。
 */
function SeriesListBody({
  loading,
  loadError,
  series,
  selectedSeriesUid,
  studyUid,
  onSelectSeries,
}: SeriesListBodyProps) {
  const [retrying, setRetrying] = useState(false);

  if (loading) {
    return <div className="viewer__panel-loading">正在加载序列索引…</div>;
  }

  if (loadError) {
    const forbidden = loadError.includes('权限');
    return (
      <EmptyState
        kind={forbidden ? 'forbidden' : 'unreachable'}
        icon={forbidden ? IconLockAccess : undefined}
        title="序列索引加载失败"
        description={`${loadError}。可重试，或联系信息科检查 PACS 链路。`}
        action={
          <Button
            size="sm"
            loading={retrying}
            onClick={() => {
              setRetrying(true);
              void listSeries(studyUid)
                .then(() => setRetrying(false))
                .catch(() => setRetrying(false));
            }}
          >
            重试
          </Button>
        }
      />
    );
  }

  if (!series) {
    return (
      <EmptyState
        kind="no-data"
        title="本次检查未返回序列"
        description="请确认 PACS 归档是否完成，或联系信息科核对检查号。"
      />
    );
  }

  return (
    <SeriesListPanel
      phaseGroups={series.phaseGroups}
      selectedSeriesUid={selectedSeriesUid}
      onSelectSeries={onSelectSeries}
    />
  );
}

/** 右侧栏属性。 */
export interface ViewerSidebarRightProps {
  readonly collapsed: boolean;
}

/**
 * 右侧栏（测量与 AI）。
 *
 * 宽度 320px（--sidebar-right-width），尺寸恒定不随分辨率放大。
 */
export function ViewerSidebarRight({ collapsed }: ViewerSidebarRightProps) {
  if (collapsed) {
    return null;
  }

  return (
    <>
      <div className="viewer__right-header">
        <span className="viewer__panel-title">测量与 AI</span>
      </div>
      <div className="viewer__right-body">
        <section className="panel">
          <h3 className="panel__title">窗宽窗位</h3>
          <p className="panel__empty">
            当前序列无有效像素数据，无法计算直方图
          </p>
        </section>
        <section className="panel">
          <h3 className="panel__title">测量记录</h3>
          <p className="panel__empty">
            尚无测量记录。选择「长度测量」后在影像上点击两点开始测量。
          </p>
        </section>
        <section className="panel">
          <h3 className="panel__title">AI 结果</h3>
          <p className="panel__empty">本检查未提交 AI 分割任务</p>
          <Button size="sm" variant="secondary">
            提交 AI 分割任务
          </Button>
        </section>
      </div>
    </>
  );
}
