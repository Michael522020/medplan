/**
 * 报告编辑与签名 `/reports/:reportId`。
 *
 * ## 锁定态由服务端决定（AC-13 / AC-14）
 *
 * `lockState.editable` 是**服务端权威判定**，前端不得用本地
 * `signed_at` 或 `status` 自行推导能否编辑。拿到 `editable = false`
 * 就渲染锁定遮罩。
 *
 * ## 五类受控字段（AC-12）
 *
 * 契约的 `structuredFields.required` 为
 * `[examBodyPart, scanMode, findings, impression, followUpRecommendation]`。
 * 任一为空 → **阻断签名**。
 *
 * ## 缺失项文案由服务端下发
 *
 * 契约在缺字段时返回 `code 10001` + `data.missingFields`。
 * 前端**直接渲染该清单**，不自行推断「哪些字段该填」——
 * 避免前端与后端对「必填」的理解漂移。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AlertBanner } from '@/components/ui/alert-banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  IconAlertTriangle,
  IconBrain,
  IconCertificate,
  IconDeviceFloppy,
  IconFileDescription,
  IconInfoCircle,
  IconSend,
  IconSignature,
} from '@/components/icons';

import { ApiError } from '@/services/api-client';
import { getReport, type ReportData } from '@/services/medplan-service';

import { LockOverlay } from './report-lock-state';
import {
  ControlledField,
  FindingsSections,
  SignedTextSection,
  extractMissingFields,
  fieldLabel,
  formatTime,
} from './report-editor';

/** 报告数据。 */
type Report = ReportData;

/** 组件属性。 */
export interface ReportPageProps {
  readonly reportId: string;
}

/**
 * 报告页。
 */
export function ReportPage({ reportId }: ReportPageProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissingFields([]);
    try {
      const data = await getReport(reportId);
      setReport(data);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 10001) {
        /**
         * 契约：缺字段时返回 code 10001 + data.missingFields。
         * 前端直接渲染服务端给的清单，不自行推断。
         */
        setMissingFields(extractMissingFields(caught));
        setError('报告存在未完成的受控字段，无法签名');
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : '报告加载失败，请检查院内网络后重试',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const structuredFields = report?.structuredFields;

  /**
   * 签名前置校验（§6.5）。
   *
   * 校验 1（受控字段完整）的缺失项来自服务端；其余校验在前端判定。
   */
  const signBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (missingFields.length > 0) {
      blockers.push(`未完成：${missingFields.map(fieldLabel).join('、')}`);
    }
    if (structuredFields && !structuredFields.aiAssist.allItemsConfirmed) {
      blockers.push('还有 AI 标记待确认');
    }
    if (report && !report.reviewer) {
      blockers.push('报告尚未通过审核，无法签名');
    }
    return blockers;
  }, [missingFields, report, structuredFields]);

  if (loading) {
    return (
      <div className="report-page">
        <div className="report-page__loading">正在加载报告…</div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="report-page">
        <EmptyState
          kind={error.includes('权限') ? 'forbidden' : 'unreachable'}
          title="报告加载失败"
          description={`${error}。可重试，或联系信息科核对报告编号。`}
          action={
            <Button size="sm" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  if (!report || !structuredFields) {
    return null;
  }

  const editable = report.lockState.editable;

  return (
    <div className="report-page">
      <div className="report-toolbar">
        <span className="report-toolbar__template">
          <IconFileDescription size={16} strokeWidth={1.75} aria-hidden />
          <span>模板 {report.templateCode}</span>
        </span>
        <span className="report-toolbar__spacer" />
        <Button icon={IconDeviceFloppy} disabled={!editable}>
          保存草稿
        </Button>
        <Button icon={IconSend} disabled={!editable}>
          提交审核
        </Button>
        <Button
          variant="primary"
          icon={IconSignature}
          disabled={!editable || signBlockers.length > 0}
          disabledReason={
            signBlockers.length > 0 ? signBlockers.join('；') : undefined
          }
        >
          电子签名
        </Button>
      </div>

      {signBlockers.length > 0 ? (
        <AlertBanner level="warning" ariaLive="assertive">
          <ul className="report-page__blockers">
            {signBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </AlertBanner>
      ) : null}

      <div className="report-page__body">
        <section className="report-editor">
          <div className="report-editor__controlled">
            <ControlledField
              label="检查部位"
              value={structuredFields.examBodyPart}
              readonly
            />
            <ControlledField
              label="扫描方式"
              value={structuredFields.scanMode}
              readonly
            />
          </div>

          <section className="report-editor__section">
            <h2 className="report-editor__heading">检查所见</h2>
            <FindingsSections report={report} />
          </section>

          <SignedTextSection
            title="影像诊断意见"
            text={structuredFields.impression.text}
            authorName={structuredFields.impression.authoredBy.nameMasked}
            authorTitle={structuredFields.impression.authoredBy.title}
          />

          <SignedTextSection
            title="建议随访"
            text={structuredFields.followUpRecommendation.text}
            authorName={
              structuredFields.followUpRecommendation.authoredBy.nameMasked
            }
            authorTitle={
              structuredFields.followUpRecommendation.authoredBy.title
            }
          />

          <div className="report-editor__status">
            <span>已自动保存 14:32:07</span>
            <span className="numeric">186 字</span>
          </div>

          <LockOverlay lockState={report.lockState} />
        </section>

        <aside className="report-ai">
          <section className="panel">
            <h3 className="panel__title">
              <IconBrain size={16} strokeWidth={1.75} aria-hidden />
              AI 辅助标记
            </h3>
            <AlertBanner level="info" icon={IconInfoCircle}>
              {structuredFields.aiAssist.disclosure}
            </AlertBanner>
            <ul className="report-ai__list">
              {structuredFields.aiAssist.referencedStructures.map((item) => (
                <li key={item.structureName} className="report-ai__item">
                  <span className="report-ai__name">
                    {item.structureLabelZh}
                  </span>
                  <span className="report-ai__value numeric">
                    {item.volumeMl.toFixed(1)} mL
                  </span>
                  <span className="report-ai__meta">
                    {item.confirmAction === 'modified' ? '已修改' : '已确认'} ·{' '}
                    {item.confirmedByMasked} {formatTime(item.confirmedAt)}
                  </span>
                </li>
              ))}
            </ul>
            {structuredFields.aiAssist.degraded ? (
              <AlertBanner level="warning" icon={IconAlertTriangle}>
                AI 分割因 GPU 显存不足降级为 CPU 推理，分割精度可能下降，
                请人工复核每项结果。
              </AlertBanner>
            ) : null}
          </section>

          <section className="panel">
            <h3 className="panel__title">
              <IconCertificate size={16} strokeWidth={1.75} aria-hidden />
              签名状态
            </h3>
            {report.signature ? (
              <dl className="report-ai__signature">
                <dt>签名流水号</dt>
                <dd className="numeric">{report.signature.serialNo}</dd>
                <dt>证书序列号</dt>
                <dd className="numeric">{report.signature.certSerial}</dd>
                <dt>签名时间</dt>
                <dd className="numeric">
                  {formatTime(report.signature.signedAt)}
                </dd>
                <dt>摘要算法</dt>
                <dd className="numeric">{report.signature.digestAlgorithm}</dd>
              </dl>
            ) : (
              <p className="panel__empty">本报告尚未签名</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
