/**
 * 阅片页的数据加载 Hook。
 *
 * ## 为什么独立成 Hook
 *
 * 序列加载有独立的错误语义（越权与不存在**必须**返回同一套文案），
 * 混在页面组件里会让页面组件同时管「渲染」与「取数」两件事。
 *
 * ## 越权与不存在不可区分
 *
 * 契约 §4.1：PHI 可导航路径上 10004（越权）与 10005（不存在）
 * 必须返回完全一致的状态码、message 字面量与响应体大小。
 * 本 Hook **不区分**这两者 —— 错误文案统一由页面的「无法访问该检查」
 * 态承担，从机制上杜绝「是否存在」的信息泄露。
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/services/api-client';
import { listSeries, type SeriesGroupedData } from '@/services/medplan-service';

import { pickDefaultPhaseGroup } from '../components/series-list-panel';

/** 序列分组响应。 */
export type SeriesGrouped = SeriesGroupedData;

/** 序列加载结果。 */
export interface UseSeriesListResult {
  readonly series: SeriesGrouped | null;
  readonly loading: boolean;
  readonly loadError: string | null;
  /** 选中的序列 uid。 */
  readonly selectedSeriesUid: string | null;
  /** 选择一个序列。 */
  readonly selectSeries: (seriesUid: string) => void;
  /** 重新加载。 */
  readonly reload: () => void;
}

/**
 * 加载某检查的序列列表。
 *
 * @param studyUid 检查 uid
 */
export function useSeriesList(studyUid: string): UseSeriesListResult {
  const [series, setSeries] = useState<SeriesGrouped | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSeriesUid, setSelectedSeriesUid] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);

    void listSeries(studyUid)
      .then((data) => {
        setSeries(data);
        /**
         * 默认选中的期相组必须满足 confidence ≥ 0.70。
         * 契约硬要求：选错期相会导致 AI 分割提交被 20002 拒，
         * 医师白等一次 GPU 任务与 10 分钟时限。
         */
        const defaultGroup = pickDefaultPhaseGroup(data.phaseGroups);
        const firstSeries =
          defaultGroup?.series[0] ?? data.phaseGroups[0]?.series[0];
        setSelectedSeriesUid(firstSeries?.seriesUid ?? null);
      })
      .catch((caught: unknown) => {
        setLoadError(
          caught instanceof ApiError
            ? caught.message
            : '序列索引加载失败，请检查院内网络后重试',
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [studyUid]);

  useEffect(() => {
    load();
  }, [load]);

  const selectSeries = useCallback((seriesUid: string) => {
    setSelectedSeriesUid(seriesUid);
  }, []);

  return {
    series,
    loading,
    loadError,
    selectedSeriesUid,
    selectSeries,
    reload: load,
  };
}
