/**
 * 检查列表表格。
 *
 * ## 脱敏字段原样渲染
 *
 * `patient.nameMasked` 是契约层已脱敏的值（张*明）。
 * 前端**直接渲染**，不尝试还原 —— 脱敏是 PHI 最小暴露在 UI 层的落地。
 *
 * ## 队列时长不重算
 *
 * `queueWaitSeconds` 由服务端算好下发。前端只做展示格式化，不做差值计算 ——
 * 时区、夏令时、跨零点都会让本地 diff 与服务端权威时间分歧，
 * 而这是进入质控与工作量统计的时长数据，必须单一可信来源。
 */

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  IconChevronRight,
  IconSignature,
} from '@/components/icons';

import type { StudyListItem } from '@/services/medplan-service';

/** 表格属性。 */
export interface StudyTableProps {
  readonly items: ReadonlyArray<StudyListItem>;
  /** 打开某检查。 */
  readonly onOpen: (studyUid: string) => void;
  /** 打开某检查的报告。 */
  readonly onOpenReport?: (reportId: string) => void;
}

/**
 * 检查列表表格。
 *
 * `role="grid"` + 每列 `scope="col"`，让屏幕阅读器能逐列播报。
 */
export function StudyTable({ items, onOpen, onOpenReport }: StudyTableProps) {
  return (
    <table className="study-table" role="grid" aria-label="检查列表">
      <caption className="sr-only">
        当前视图共 {items.length} 项检查，按检查日期降序排列
      </caption>
      <thead>
        <tr>
          <th scope="col">患者</th>
          <th scope="col">性别 / 年龄</th>
          <th scope="col">检查类型</th>
          <th scope="col">检查日期</th>
          <th scope="col">队列时长</th>
          <th scope="col">状态</th>
          <th scope="col">
            <span className="sr-only">操作</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <StudyRow
            key={item.studyUid}
            item={item}
            onOpen={() => onOpen(item.studyUid)}
            onOpenReport={
              item.reportId && onOpenReport
                ? () => onOpenReport(item.reportId as string)
                : undefined
            }
          />
        ))}
      </tbody>
    </table>
  );
}

/** 表格骨架。10 行，与真实行高一致，避免加载完成时布局跳动。 */
export function StudyTableSkeleton() {
  return (
    <div className="study-table__skeleton" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton skeleton-row__cell skeleton-row__cell--wide" />
          <span className="skeleton skeleton-row__cell" />
          <span className="skeleton skeleton-row__cell skeleton-row__cell--wide" />
          <span className="skeleton skeleton-row__cell" />
          <span className="skeleton skeleton-row__cell" />
        </div>
      ))}
    </div>
  );
}

/** 单行。 */
interface StudyRowProps {
  readonly item: StudyListItem;
  readonly onOpen: () => void;
  readonly onOpenReport?: () => void;
}

/**
 * 检查行。
 *
 * 急诊行左侧有 4px 危急色指示条 —— 这是状态指示，不是装饰。
 * 同时配合 StatusBadge 的图标与文字，满足三重编码。
 */
function StudyRow({ item, onOpen, onOpenReport }: StudyRowProps) {
  return (
    <tr
      className={[
        'study-table__row',
        item.isEmergency ? 'study-table__row--emergency' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <td className="study-table__patient">
        <button
          type="button"
          className="study-table__open"
          onClick={onOpen}
          aria-label={`打开 ${item.patient.nameMasked} 的 ${item.studyDescription ?? item.modality} 检查`}
        >
          <span className="study-table__name">{item.patient.nameMasked}</span>
          <span className="study-table__accession numeric">
            {item.accessionNo}
          </span>
        </button>
      </td>
      <td className="numeric">
        {formatGender(item.patient.gender)} / {item.patient.ageYears} 岁
      </td>
      <td>
        <span className="study-table__study-type">
          {item.studyDescription ?? `${item.modality} 检查`}
        </span>
        <span className="study-table__body-part">
          {formatBodyPart(item.bodyPart)}
        </span>
      </td>
      <td className="numeric">{formatStudyDate(item.studyDate)}</td>
      <td className="numeric">
        {item.queueWaitSeconds === null
          ? '—'
          : formatQueueWait(item.queueWaitSeconds)}
      </td>
      <td>
        <StatusBadge tone={item.isEmergency ? 'critical' : 'normal'}>
          {item.isEmergency ? '急诊' : item.readStatus === 'read' ? '已阅' : '待阅'}
        </StatusBadge>
        {item.hasSignedReport ? (
          <span className="study-table__signed">
            <IconSignature size={14} strokeWidth={1.75} aria-hidden />
            已签
          </span>
        ) : null}
      </td>
      <td className="study-table__actions">
        {onOpenReport ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenReport}
            icon={IconSignature}
          >
            查看报告
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpen}
          trailingIcon={IconChevronRight}
        >
          阅片
        </Button>
      </td>
    </tr>
  );
}

/** ISO 5218 性别代码转中文。空串显示「未记录」。 */
export function formatGender(gender: string): string {
  switch (gender) {
    case 'M':
      return '男';
    case 'F':
      return '女';
    case 'O':
      return '其他';
    default:
      return '未记录';
  }
}

/** 身体部位枚举转中文。 */
export function formatBodyPart(bodyPart: string | undefined): string {
  switch (bodyPart) {
    case 'ABDOMEN':
      return '腹部';
    case 'LIVER':
      return '肝脏';
    case 'CHEST':
      return '胸部';
    case 'PELVIS':
      return '盆腔';
    case 'HEAD':
      return '头颅';
    case 'SPINE':
      return '脊柱';
    case 'EXTREMITY':
      return '四肢';
    case 'WHOLE_BODY':
      return '全身';
    default:
      return '其他部位';
  }
}

/** 格式化检查日期为 MM-DD HH:mm。 */
export function formatStudyDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

/** 把秒数格式化为「5 小时 12 分」。 */
export function formatQueueWait(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes} 分钟`;
  }
  return `${hours} 小时 ${minutes} 分`;
}

/** 把时间格式化为「16:42」。 */
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
