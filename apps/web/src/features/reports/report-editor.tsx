/**
 * 报告编辑器的展示组件。
 *
 * ## 五类受控字段（AC-12）
 *
 * 契约的 `structuredFields.required` 为
 * `[examBodyPart, scanMode, findings, impression, followUpRecommendation]`。
 * 任一为空 → **阻断签名**。
 *
 * ## 只读字段的视觉语义
 *
 * 只读字段用 `--color-readonly-bg` + `--color-readonly-border` +
 * lock 图标标识「自动带入，不可编辑」。
 *
 * 注意：只读字段的语义是「**来源权威**」，
 * 与签名锁定态的「**流程冻结**」不同 —— 两者不可共用同一视觉。
 * 把两者混为一谈会让医生误以为报告被锁了，而实际上只是不允许改部位。
 */

import { IconLock, IconSignature } from '@/components/icons';

import type { ReportData } from '@/services/medplan-service';

/** 报告数据。 */
type Report = ReportData;

/** 受控字段。只读字段用 lock 图标标识「自动带入，不可编辑」。 */
export interface ControlledFieldProps {
  readonly label: string;
  readonly value: string;
  readonly readonly?: boolean;
}

/**
 * 受控字段。
 */
export function ControlledField({
  label,
  value,
  readonly = false,
}: ControlledFieldProps) {
  return (
    <div className="controlled-field">
      <span className="controlled-field__label">{label}</span>
      <span
        className={[
          'controlled-field__value',
          readonly ? 'controlled-field__value--readonly' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {readonly ? (
          <IconLock size={14} strokeWidth={1.75} aria-hidden />
        ) : null}
        <span>{value}</span>
      </span>
    </div>
  );
}

/** 检查所见分段列表的属性。 */
export interface FindingsSectionsProps {
  readonly report: Report;
}

/**
 * 检查所见分段列表。
 *
 * `findings` 是**分段数组**（按窗位/期相分段），不是一个富文本框。
 * 每段对应一个窗位或期相。
 */
export function FindingsSections({ report }: FindingsSectionsProps) {
  const { findings } = report.structuredFields;

  if (findings.length === 0) {
    return (
      <p className="panel__empty">
        报告尚未创建。选择模板并开始书写，或从右侧 AI 建议引用开始。
      </p>
    );
  }

  return (
    <>
      {findings.map((section) => (
        <article key={section.key} className="finding-section">
          <header className="finding-section__header">
            <span className="finding-section__label">{section.label}</span>
            <span className="finding-section__author">
              {section.authoredBy.nameMasked} · {section.authoredBy.title}
            </span>
          </header>
          <p className="finding-section__text">{section.text}</p>
        </article>
      ))}
    </>
  );
}

/** 诊断意见与建议随访的属性。 */
export interface SignedTextSectionProps {
  readonly title: string;
  readonly text: string;
  readonly authorName: string;
  readonly authorTitle: string;
}

/**
 * 带署名的文本段（诊断意见 / 建议随访）。
 *
 * 署名由服务端按会话写入 —— 前端**不提供**署名选择器，避免冒名代写。
 */
export function SignedTextSection({
  title,
  text,
  authorName,
  authorTitle,
}: SignedTextSectionProps) {
  return (
    <section className="report-editor__section">
      <h2 className="report-editor__heading">{title}</h2>
      <p className="report-editor__text">{text}</p>
      <p className="report-editor__signature">
        <IconSignature size={14} strokeWidth={1.75} aria-hidden />
        <span>
          {authorName} · {authorTitle}
        </span>
      </p>
    </section>
  );
}

/**
 * 格式化时间。
 *
 * 时间戳用等宽数字（tabular-nums）显示，便于纵向对齐扫描 ——
 * 这是审计页与签名详情的通用要求。
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/** 从契约的 ControlledFieldKey 映射到中文标签。 */
const FIELD_LABELS: Record<string, string> = {
  examBodyPart: '检查部位',
  scanMode: '扫描方式',
  findings: '检查所见',
  impression: '影像诊断意见',
  followUpRecommendation: '建议随访',
};

/** 受控字段的中文名。 */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * 从错误响应中提取缺失字段清单。
 *
 * 契约的 `SignFieldMissingDetail.missingFields` 是
 * `ControlledFieldKey[]`。前端**直接渲染该清单**，不自行推断
 * 「哪些字段该填」—— 避免前端与后端对「必填」的理解漂移。
 */
export function extractMissingFields(error: unknown): string[] {
  const detail = (error as { detail?: { missingFields?: unknown } }).detail;
  const fields = detail?.missingFields;
  if (Array.isArray(fields)) {
    return fields.filter((item): item is string => typeof item === 'string');
  }
  return [];
}
