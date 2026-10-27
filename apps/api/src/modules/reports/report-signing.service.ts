import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { toAccessContext } from '../../common/access/access-context.js';
import { DB_POOL, withTransaction } from '../../common/db/pool.js';
import { formatResourceId, parseResourceId } from '../../common/id/ids.js';
import {
  canonicalizeReportBody,
  sha256Hex,
  sm3Hex,
  DIGEST_ALGORITHM_SM3,
} from '../../common/crypto/digest.js';
import { AuthoritativeTimeService } from '../../common/time/authoritative-time.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { markBusinessAuditCommitted } from '../../common/audit/audit-context.js';
import { ReportsRepository } from './reports.repository.js';
import { SignatureLogsRepository } from './signature-logs.repository.js';
import type { ReportRow, SignatureLogRow } from './report-mapper-types.js';
import { SignatureService } from './signature.service.js';
import {
  buildCanonicalBody,
  buildDocumentUniqueSn,
  findMissingControlledFields,
  maskName,
} from './report-mapper.js';

/**
 * 报告签名编排。
 *
 * 与「读报告」分开的理由：签名是本系统**最敏感**的一段流程 ——
 * 涉及证书校验、验签、权威时间、摘要绑定、多表事务锁定。
 * 它值得独占一个文件，让审阅者能完整看到这条链路而不被读逻辑打断。
 *
 * ## 流程（契约 §sign 的 description 逐条落实）
 *
 *   1. 证书校验：有效期 -> 颁发者链 -> 吊销列表
 *   2. 验签：SM2 签名值对 `nonce||reportId||version||bodyDigest`
 *   3. 权威时间校验：偏移 > 60s -> **拒绝签名**，不得用本地时间兜底（AC-15）
 *   4. 摘要绑定：对规范化正文做 SM3（正文改一字符 -> 签名立即失效，AC-14）
 *   5. 签名日志独立写入 `signature_logs`（WS/T 847）
 *   6. 成功后报告正文与关联规划方案**一并锁定**
 */
@Injectable()
export class ReportSigningService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly signatureLogs: SignatureLogsRepository,
    private readonly signatureService: SignatureService,
    private readonly timeService: AuthoritativeTimeService,
    private readonly auditService: AuditService,
    @Inject(DB_POOL) private readonly pool: Pool
  ) {}

  /**
   * 执行签名。
   */
  async sign(
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
    const reportId = parseResourceId(reportIdParam, 'r');
    const access = toAccessContext(session);

    // 幂等重放：同一 Idempotency-Key 返回同一流水号，不产生第二条签名记录
    const existingSignature = await this.signatureLogs.findByIdempotencyKey(idempotencyKey);
    if (existingSignature) {
      return this.toSignResponse(existingSignature, true);
    }

    // 恒定索引路径的探测查询
    await this.repository.probe(reportId);

    const report = await this.repository.findById(reportId, access);
    if (!report) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    this.assertPreconditions(session, report, body);

    // --- 摘要绑定：对规范化正文做 SM3 ---
    // 这是签名真正绑定的值。正文改一字符 -> 摘要变化 -> 原签名立即失效（AC-14）。
    const canonicalBody = canonicalizeReportBody(buildCanonicalBody(report));
    const bodyDigest = sm3Hex(canonicalBody);
    const bodySha256 = sha256Hex(canonicalBody);

    // --- 证书校验 + 签名验签 + TSA 时间戳 ---
    // 验签输入必须是服务端重算的 bodyDigest —— 客户端签的也是同一个值。
    const signatureResult = await this.signatureService.sign({
      reportId,
      reportVersion: report.version,
      bodyDigest,
      nonce: body.nonce,
      signatureValue: body.signatureValue,
      ukeyCertSerial: body.ukeyCertSerial,
      subjectId: session.userId,
      subjectName: session.displayName,
      subjectTitle: session.title,
      subjectDept: session.department,
    });

    // --- 权威时间校验（AC-15）---
    // 必须在**签名落库前**校验：偏移超阈值则拒绝签名，
    // 且**不得**用本地时间兜底。
    const authoritative = await this.timeService.assertWithinDrift();
    const signedAt = new Date(authoritative.epochMs);
    const driftSeconds = Math.round(Math.abs(authoritative.offsetMs) / 1000);

    // --- 写签名日志 + 锁定报告 + 锁定规划方案，同一事务 ---
    await withTransaction(this.pool, async (client) => {
      const serial = await this.signatureLogs.nextSerialNo(client, signedAt);
      const documentUniqueSn = buildDocumentUniqueSn(report, signedAt);
      const logIntegrityDigest = sm3Hex(
        canonicalizeReportBody({
          serialNo: serial,
          documentUniqueSn,
          digestValue: bodyDigest,
          subjectId: session.userId,
          signedAt: signedAt.toISOString(),
        })
      );

      await this.signatureLogs.insert(client, {
        serialNo: serial,
        documentUniqueSn,
        subjectId: session.userId,
        subjectName: session.displayName,
        subjectTitle: session.title,
        subjectDept: session.department,
        objectId: reportId,
        objectVersion: report.version,
        digestValue: bodyDigest,
        certSerial: signatureResult.certSerial,
        certIssuer: signatureResult.certIssuer,
        certValidFrom: signatureResult.certValidFrom,
        certValidTo: signatureResult.certValidTo,
        crlChecked: signatureResult.crlChecked,
        crlCheckResult: signatureResult.crlCheckResult,
        signatureValue: body.signatureValue,
        signedAt,
        tsaAuthority: signatureResult.tsaAuthority,
        tsaToken: signatureResult.tsaToken,
        clockDriftSeconds: driftSeconds,
        logIntegrityDigest,
        idempotencyKey,
      });

      await this.repository.markSigned(client, {
        reportId,
        signedAt,
        bodyDigest,
        bodySha256,
      });

      await this.repository.lockPlans(client, {
        studyId: (await this.repository.probe(reportId))?.studyId ?? '',
        reportId,
        lockedAt: signedAt,
      });

      await this.repository.appendRevision(client, {
        reportId,
        version: report.version,
        snapshot: { bodyDigest, bodySha256 },
        bodyDigest,
        changeSummary: '电子签名，正文锁定',
        editedBy: session.userId,
      });

      await this.auditService.appendWith(client, {
        eventType: 'REPORT_SIGNED',
        actorId: session.userId,
        actorRoles: session.roles,
        result: 'success',
        resourceType: 'report',
        resourceId: reportId,
        detail: {
          serialNo: serial,
          digestAlgorithm: DIGEST_ALGORITHM_SM3,
          bodyDigest,
          clockDriftSeconds: driftSeconds,
        },
      });
    });
    markBusinessAuditCommitted();

    const signature = await this.signatureLogs.findLatest(reportId);
    if (!signature) {
      throw AppError.internal();
    }
    return this.toSignResponse(signature, false);
  }

  /**
   * 签名前置业务校验。
   *
   * 顺序有意义：先判角色（最便宜、且与患者无关），再判业务状态。
   */
  private assertPreconditions(
    session: Session,
    report: ReportRow,
    body: { reportVersion: number; digestAlgorithm: string }
  ): void {
    // 1. 签名权限（角色级，10003）
    if (!this.signatureService.hasSignPermission(session)) {
      throw AppError.forbiddenRole('当前角色无报告签名权限');
    }

    // 2. 未审核不可签名（50001）
    if (!report.review_doctor_id || !report.reviewed_at) {
      throw AppError.reportNotReviewed();
    }

    // 3. 已签名不可重复签名（50003）
    if (report.status === 'signed' || report.status === 'archived') {
      throw AppError.reportSignedLocked();
    }

    // 4. 五类受控字段完整（10001）
    const missingFields = findMissingControlledFields(report);
    if (missingFields.length > 0) {
      throw AppError.paramInvalid('受控字段不完整，无法签名', { missingFields });
    }

    // 5. 版本一致（10001）—— 防止「签了旧版」
    if (body.reportVersion !== report.version) {
      throw AppError.paramInvalid('报告版本已变更，请刷新后重新签名');
    }

    // 6. 摘要算法必须 SM3
    if (body.digestAlgorithm !== DIGEST_ALGORITHM_SM3) {
      throw AppError.paramInvalid('摘要算法必须为 SM3');
    }
  }

  /** 签名记录 -> 契约响应 */
  private toSignResponse(
    signature: SignatureLogRow,
    replay: boolean
  ): components['schemas']['SignReportResponse'] {
    return {
      code: 0,
      message: '',
      data: {
        signatureId: formatResourceId('r', signature.id),
        reportId: formatResourceId('r', signature.object_id),
        reportVersion: signature.object_version,
        serialNo: signature.serial_no,
        documentUniqueSn: signature.document_unique_sn,
        subjectId: signature.subject_id,
        subjectNameMasked: maskName(signature.subject_name),
        digestAlgorithm: DIGEST_ALGORITHM_SM3,
        digestValue: signature.digest_value,
        signatureAlgorithm: 'SM2',
        signatureValue: signature.signature_value,
        certSerial: signature.cert_serial,
        signedAt: signature.signed_at.toISOString(),
        tsaAuthority: signature.tsa_authority,
        tsaToken: signature.tsa_token,
        logSerialNo: signature.serial_no,
        reportLocked: true,
        lockedScope: ['report_body', 'plan_payload'],
        verified: true,
        idempotentReplay: replay,
      },
    };
  }
}
