/**
 * 表单字段容器。
 *
 * ## 错误就近呈现
 *
 * UIUX-P2 §6.8：每个字段的错误显示在**该字段下方**，
 * 不用 `aria-describedby` 关联到页面顶部的汇总列表 ——
 * 顶部汇总会让屏幕阅读器用户丢失定位。
 *
 * ## 错误占位
 *
 * 错误容器预留固定高度（`--space-1`），错误出现时不撑破布局 ——
 * CLS < 0.1 是 UIUX-P2 §1.6 的明确要求。
 */

import type { ReactNode } from 'react';

import { IconAlertCircle } from '@/components/icons';

/** 字段属性。 */
export interface FieldProps {
  /** 字段标签。 */
  label: string;
  /** 字段 id，用于 label 的 htmlFor。 */
  htmlFor?: string;
  /** 错误文案。存在时下方显示并以 aria-describedby 关联。 */
  error?: string;
  /** 补充说明。 */
  hint?: string;
  /** 右侧附加内容（如「查看我的授权范围」链接）。 */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 表单字段。
 *
 * @example
 * <Field label="工号" htmlFor="username" error="工号或口令不正确，剩余尝试 3 次">
 *   <input id="username" />
 * </Field>
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  trailing,
  children,
  className,
}: FieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  return (
    <div
      className={['field', error ? 'field--error' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="field__header">
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {trailing ? <div className="field__trailing">{trailing}</div> : null}
      </div>
      <div
        className="field__control"
        aria-describedby={
          [error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        {children}
      </div>
      <div className="field__footer">
        {error ? (
          <p className="field__error" id={errorId} role="alert">
            <IconAlertCircle size={14} strokeWidth={2} aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {hint && !error ? (
          <p className="field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
