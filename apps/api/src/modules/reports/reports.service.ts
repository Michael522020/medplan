import { Injectable } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { formatResourceId, parseResourceId } from '../../common/id/ids.js';
import { canonicalizeReportBody, sm3Hex, DIGEST_ALGORITHM_SM3 } from '../../common/crypto/digest.js';
import { ReportsRepository } from './reports.repository.js';
import { SignatureLogsRepository } from './signature-logs.repository.js';
import type { ReportRow } from './report-mapper-types.js';
import { ReportSigningService } from './report-signing.service.js';
import {
  buildCanonicalBody,
  buildPatientBrief,
  buildStudyBrief,
  buildStructuredFields,
  buildVisitBrief,
  toSignature,
} from './report-mapper.js';

/**
 * 报告读取与签名入口。
 *
 * 签名的具体编排见 `report-signing.service.ts`；本类只做读取与委派。
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly signatureLogs: SignatureLogsRepository,
    private readonly signingService: ReportSigningService
  ) {}

  /**
   * GET /api/v1/reports/{reportId}
   *
   * 获取结构化报告。响应含**服务端权威**的 `lockState`。
   */
  async getReport(
    session: Session,
    reportIdParam: string
  ): Promise<components['schemas']['ReportResponse']> {
    const reportId = parseResourceId(reportIdParam, 'r');
    const access = toAccessContext(session);

    // 恒定索引路径的探测查询
    await this.repository.probe(reportId);

    const report = await this.repository.findById(reportId, access);
    if (!report) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    const revisions = await this.repository.findRevisions(reportId);
    const signature = await this.signatureLogs.findLatest(reportId);

    return {
      code: 0,
      message: '',
      data: {
        reportId: formatResourceId('r', report.id),
        studyUid: report.study_uid,
        version: report.version,
        status: report.status as components['schemas']['ReportResponse']['data']['status'],
        lockState: buildLockState(report, signature?.digest_value ?? null),
        templateCode: report.template_code,
        patient: buildPatientBrief(report),
        visit: buildVisitBrief(report),
        study: buildStudyBrief(report),
        structuredFields: buildStructuredFields(report),
        author: {
          userId: report.report_doctor_id,
          nameMasked: report.author_name_masked ?? '',
          title: (report.author_title ?? '其他') as components['schemas']['AuthorRef']['title'],
          department: report.author_department ?? '',
        },
        reviewer: report.reviewer_name_masked
          ? {
              userId: report.review_doctor_id ?? '',
              nameMasked: report.reviewer_name_masked,
              title: (report.reviewer_title ?? '其他') as components['schemas']['AuthorRef']['title'],
              department: report.reviewer_department ?? '',
            }
          : null,
        reportTime: report.report_time.toISOString(),
        bodyDigestAlgorithm: DIGEST_ALGORITHM_SM3,
        bodyDigest: report.body_digest,
        bodySha256: report.body_sha256,
        signature: signature ? toSignature(signature) : null,
        revisionHistory: revisions.map((row) => ({
          version: row.version,
          editedByMasked: row.edited_by_masked ?? '',
          editedAt: row.edited_at.toISOString(),
          changeSummary: row.change_summary,
        })),
        createdAt: report.created_at.toISOString(),
        updatedAt: report.updated_at.toISOString(),
      },
    };
  }

  /**
   * POST /api/v1/reports/{reportId}/sign
   *
   * 医师电子签名（SM2 + CA + TSA）。
   */
  async signReport(
    session: Session,
    reportIdParam: string,
    body: {
      reportVersion: number;
      digestAlgorithm: string;
      ukeyCertSerial: string;
      nonce: string;
      signatureValue: string;
    },
    idempotencyKey: string
  ): Promise<components['schemas']['SignReportResponse']> {
    return this.signingService.sign(session, reportIdParam, body, idempotencyKey);
  }
}

/**
 * 构建服务端权威的锁定状态。
 *
 * ## 两条独立维度
 *
 * 1. `state` / `editable` / `reason` / `lockedAt` / `lockedScope`
 *    -> 回答「**能不能改**」
 * 2. `signatureValid`
 *    -> 回答「**签名还成不成立**」
 *
 * `signatureValid` 由**重算正文摘要并与签名时的摘要比对**得出，
 * 与 state 独立：正文在签名后被改动（绕过触发器的直接改库）时，
 * state 仍是 SIGNED，但 signatureValid 为 false —— 这是篡改检测信号。
 */
export function buildLockState(
  report: ReportRow,
  signedDigestValue: string | null
): components['schemas']['ReportLockState'] {
  const state = report.status.toUpperCase() as components['schemas']['ReportLockState']['state'];
  const editable = state === 'DRAFT' || state === 'PENDING_REVIEW';

  let reason: components['schemas']['ReportLockState']['reason'];
  switch (state) {
    case 'SIGNED':
      reason = 'SIGNED_LOCKED';
      break;
    case 'ARCHIVED':
      reason = 'ARCHIVED_LOCKED';
      break;
    case 'PENDING_REVIEW':
      reason = 'NOT_REVIEWED_YET';
      break;
    default:
      reason = 'NOT_SIGNED_YET';
  }

  // 签名有效性：重算当前正文的 SM3，与签名时记录的摘要比对
  let signatureValid = false;
  if (signedDigestValue) {
    const currentDigest = sm3Hex(canonicalizeReportBody(buildCanonicalBody(report)));
    signatureValid = currentDigest === signedDigestValue;
  }

  const locked = state === 'SIGNED' || state === 'ARCHIVED';
  return {
    state,
    editable,
    reason,
    signatureValid,
    lockedAt: report.signed_at ? report.signed_at.toISOString() : null,
    lockedScope: locked ? ['report_body', 'plan_payload'] : [],
  };
}
