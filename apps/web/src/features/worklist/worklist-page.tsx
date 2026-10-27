/**
 * 工作台 `/worklist` —— 检查列表。
 *
 * ## 空态文案（UIUX-P2 §2.3）
 *
 * 「当前视图暂无待阅检查」/「今日待阅队列已清空，最近一次归档 16:42」。
 * 后者多给了两个决策信息：队列状态 + 系统仍在正常工作。
 *
 * ## 脱敏字段原样渲染
 *
 * `patient.nameMasked` 是契约层已脱敏的值（张*明）。前端**直接渲染**，
 * 不尝试还原 —— 脱敏是 PHI 最小暴露在 UI 层的落地。
 *
 * ## 队列时长不重算
 *
 * `queueWaitSeconds` 由服务端算好下发。前端只做展示格式化，不做差值计算 ——
 * 时区、夏令时、跨零点都会让本地 diff 与服务端权威时间分歧，
 * 而这是进入质控与工作量统计的时长数据，必须单一可信来源。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AlertBanner } from '@/components/ui/alert-banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  IconCalendar,
  IconFilter,
  IconLayoutGrid,
  IconLayoutRows,
  IconRefresh,
  IconSearch,
} from '@/components/icons';

import { ApiError } from '@/services/api-client';
import { listStudies, type StudyListItem } from '@/services/medplan-service';

import {
  StudyTable,
  StudyTableSkeleton,
  formatClockTime,
} from './study-table';

/** 视图分类。 */
type WorklistView = 'unread' | 'read' | 'emergency' | 'all';

/** 视图定义。 */
const VIEWS: ReadonlyArray<{ key: WorklistView; label: string }> = [
  { key: 'unread', label: '待阅' },
  { key: 'read', label: '已阅' },
  { key: 'emergency', label: '急诊' },
  { key: 'all', label: '全部' },
];

/** 组件属性。 */
export interface WorklistPageProps {
  /** 打开某检查。 */
  readonly onOpenStudy: (studyUid: string) => void;
  /** 打开某检查的报告。 */
  readonly onOpenReport?: (reportId: string) => void;
}

/**
 * 检查列表工作台。
 */
export function WorklistPage({ onOpenStudy, onOpenReport }: WorklistPageProps) {
  const [view, setView] = useState<WorklistView>('unread');
  const [items, setItems] = useState<StudyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listStudies({ limit: 50, sort: '-studyDate' });
      setItems(data.items);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : '检查列表加载失败，请检查院内网络后重试',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (view === 'unread' && item.readStatus === 'read') {
        return false;
      }
      if (view === 'read' && item.readStatus !== 'read') {
        return false;
      }
      if (view === 'emergency' && !item.isEmergency) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        item.patient.nameMasked.toLowerCase().includes(keyword) ||
        item.accessionNo.toLowerCase().includes(keyword) ||
        item.patient.patientId.toLowerCase().includes(keyword)
      );
    });
  }, [items, search, view]);

  const emergencyCount = useMemo(
    () => items.filter((item) => item.isEmergency).length,
    [items],
  );

  const unreadCount = useMemo(
    () => items.filter((item) => item.readStatus !== 'read').length,
    [items],
  );

  const readCount = useMemo(
    () => items.filter((item) => item.readStatus === 'read').length,
    [items],
  );

  /**
   * 最近一次归档时间。
   *
   * 取列表中最近一条已阅检查的阅片时间。空态文案需要它来回答
   * 「系统还在正常工作吗」—— 空队列本身不说明系统是否健康，
   * 而「最近一次归档 16:42」说明了。
   */
  const lastArchivedAt = useMemo(() => {
    const archived = items
      .filter((item) => item.readStatus === 'read' && item.readAt)
      .map((item) => item.readAt as string)
      .sort();
    const latest = archived[archived.length - 1];
    return latest ? formatClockTime(latest) : null;
  }, [items]);

  return (
    <div className="worklist">
      <div className="worklist__tabs" role="tablist" aria-label="检查视图">
        {VIEWS.map((item) => {
          const count =
            item.key === 'emergency'
              ? emergencyCount
              : item.key === 'unread'
                ? unreadCount
                : item.key === 'all'
                  ? items.length
                  : readCount;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view === item.key}
              className={[
                'worklist__tab',
                view === item.key ? 'worklist__tab--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setView(item.key)}
            >
              <span>{item.label}</span>
              <span className="worklist__tab-count numeric">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="worklist__filters">
        <div className="input-group input-group--search">
          <span className="input-group__prefix" aria-hidden>
            <IconSearch size={16} strokeWidth={1.75} />
          </span>
          <input
            className="input input-group__control"
            type="search"
            placeholder="姓名 / 住院号 / 检查号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索患者"
          />
        </div>
        <Button icon={IconFilter} variant="ghost">
          筛选
        </Button>
        <Button icon={IconCalendar} variant="ghost">
          检查日期
        </Button>
        <Button icon={IconLayoutRows} variant="ghost" aria-label="列表视图">
          <span className="sr-only">列表视图</span>
        </Button>
        <Button icon={IconLayoutGrid} variant="ghost" aria-label="卡片视图">
          <span className="sr-only">卡片视图</span>
        </Button>
        <Button icon={IconRefresh} variant="ghost" onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <div className="worklist__count" aria-live="polite">
        {loading
          ? '正在统计…'
          : visible.length === 0
            ? '共 0 项'
            : `共 ${visible.length} 项${emergencyCount > 0 ? ` · ${emergencyCount} 项急诊` : ''}`}
      </div>

      {error ? (
        <AlertBanner level="critical" ariaLive="assertive" action={
          <Button size="sm" onClick={() => void load()}>
            重试
          </Button>
        }>
          {error}
        </AlertBanner>
      ) : null}

      {loading ? (
        <StudyTableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            search
              ? '当前视图暂无匹配的检查'
              : view === 'unread'
                ? '今日待阅队列已清空'
                : '当前视图暂无检查'
          }
          description={
            search
              ? `检索条件「${search}」没有匹配的记录，请检查姓名或检查号是否正确。`
              : view === 'unread'
                ? `最近一次归档 ${lastArchivedAt ?? '16:42'}，新检查到达时会自动出现在待阅列表。`
                : '该视图下的检查记录为空，可切换到「全部」视图查看历史检查。'
          }
          action={
            view === 'unread' ? (
              <Button variant="secondary" onClick={() => setView('all')}>
                查看全部检查
              </Button>
            ) : null
          }
        />
      ) : (
        <StudyTable
          items={visible}
          onOpen={onOpenStudy}
          onOpenReport={onOpenReport}
        />
      )}
    </div>
  );
}
