/**
 * 序列列表（按期相分组）。
 *
 * ## 期相未识别是硬约束（Spec DCM-02）
 *
 * 必须标注「期相未识别」且**禁止默认归入平扫**。理由是医生会把
 * 延迟期当平扫读，漏掉强化病灶。
 *
 * ## 两个置信度阈值语义不同（契约 PhaseGroup.confidence）
 *
 * | 阈值 | 行为 | 理由 |
 * |------|------|------|
 * | < 0.70 | 该期相组**不得默认选中**，组头显示「期相待人工确认」 | 契约硬要求。选错期相会导致 AI 分割提交被 20002 拒，医师白等一次 GPU 任务与 10 分钟时限 |
 * | < 0.50 | 额外显示「建议人工指定期相」+ 下拉选择 | 更强提示：不自动选，还要主动让医师指定 |
 *
 * 即 0.50–0.70 之间是「不自动选、但有提示条」；
 * < 0.50 是「不自动选 + 主动指定下拉」。
 */

import type { components } from '@medplan/contracts';

import { StatusBadge } from '@/components/ui/status-badge';
import {
  IconCircleDashed,
  IconHelpCircle,
  IconStack2,
  type Icon,
} from '@/components/icons';

/** 期相分组。 */
export type PhaseGroup = components['schemas']['PhaseGroup'];

/** 序列条目。 */
export type SeriesItem = components['schemas']['SeriesItem'];

/** 置信度阈值：低于此值不得默认选中。 */
export const PHASE_CONFIDENCE_REQUIRED = 0.7;

/** 置信度阈值：低于此值需主动指定期相。 */
export const PHASE_CONFIDENCE_SUGGEST = 0.5;

/** 期相的图标与颜色类。 */
const PHASE_ICON: Record<string, Icon> = {
  plain: IconStack2,
  arterial: IconStack2,
  portal: IconStack2,
  venous: IconStack2,
  delayed: IconStack2,
  unknown: IconHelpCircle,
};

/** 期相的颜色类（对应 --color-phase-*）。 */
const PHASE_CLASS: Record<string, string> = {
  plain: 'phase-group--plain',
  arterial: 'phase-group--arterial',
  portal: 'phase-group--portal',
  venous: 'phase-group--venous',
  delayed: 'phase-group--delayed',
  unknown: 'phase-group--unknown',
};

/** 组件属性。 */
export interface SeriesListPanelProps {
  readonly phaseGroups: ReadonlyArray<PhaseGroup>;
  readonly selectedSeriesUid: string | null;
  readonly onSelectSeries: (seriesUid: string) => void;
}

/**
 * 序列列表。
 */
export function SeriesListPanel({
  phaseGroups,
  selectedSeriesUid,
  onSelectSeries,
}: SeriesListPanelProps) {
  if (phaseGroups.length === 0) {
    return (
      <div className="series-list__empty">
        本次检查未返回序列，请确认 PACS 归档是否完成
      </div>
    );
  }

  return (
    <div className="series-list">
      {phaseGroups.map((group) => {
        const needsConfirmation = group.confidence < PHASE_CONFIDENCE_REQUIRED;
        const needsManualAssign = group.confidence < PHASE_CONFIDENCE_SUGGEST;
        const IconComponent = PHASE_ICON[group.phase] ?? IconStack2;

        return (
          <section
            key={group.phase}
            className={['phase-group', PHASE_CLASS[group.phase] ?? '']
              .filter(Boolean)
              .join(' ')}
          >
            <header className="phase-group__header">
              <span className="phase-group__title">
                <IconComponent size={14} strokeWidth={2} aria-hidden />
                <span>{group.phaseLabel}</span>
              </span>

              {needsConfirmation ? (
                <StatusBadge tone="warning" icon={IconCircleDashed}>
                  期相待人工确认
                </StatusBadge>
              ) : (
                <span className="phase-group__confidence numeric">
                  {Math.round(group.confidence * 100)}%
                </span>
              )}
            </header>

            {needsManualAssign ? (
              <div className="phase-group__notice">
                <IconHelpCircle size={14} strokeWidth={2} aria-hidden />
                <span>建议人工指定期相</span>
                <select
                  className="select select--compact"
                  aria-label={`为${group.phaseLabel}指定期相`}
                  defaultValue=""
                >
                  <option value="" disabled>
                    选择期相
                  </option>
                  <option value="plain">平扫</option>
                  <option value="arterial">动脉期</option>
                  <option value="portal">门脉期</option>
                  <option value="delayed">延迟期</option>
                </select>
              </div>
            ) : null}

            <ul className="phase-group__list">
              {group.series.map((series) => (
                <SeriesItemRow
                  key={series.seriesUid}
                  series={series}
                  selected={series.seriesUid === selectedSeriesUid}
                  onSelect={() => onSelectSeries(series.seriesUid)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** 单个序列行。 */
interface SeriesItemRowProps {
  readonly series: SeriesItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/**
 * 序列行。
 *
 * 层数用 tabular-nums —— 512 与 306 在等宽下才能对齐比较。
 */
function SeriesItemRow({ series, selected, onSelect }: SeriesItemRowProps) {
  return (
    <li>
      <button
        type="button"
        className={[
          'series-item',
          selected ? 'series-item--selected' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onSelect}
        aria-current={selected}
      >
        <span className="series-item__description">
          {series.description ?? `序列 ${series.seriesNumber}`}
        </span>
        <span className="series-item__meta numeric">
          {series.instanceCount} 层 · {series.sliceThicknessMm}mm
        </span>
      </button>
    </li>
  );
}

/**
 * 选出可以默认选中的期相组。
 *
 * 置信度 < 0.70 的组**不参与**默认选择 —— 契约硬要求。
 * 若全部组都不满足，则返回 null（由调用方要求医师手动选）。
 */
export function pickDefaultPhaseGroup(
  phaseGroups: ReadonlyArray<PhaseGroup>,
): PhaseGroup | null {
  const eligible = phaseGroups.filter(
    (group) => group.confidence >= PHASE_CONFIDENCE_REQUIRED,
  );
  return eligible[0] ?? null;
}
