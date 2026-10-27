import type { components } from '@medplan/contracts/generated';
import { formatResourceId } from '../../common/id/ids.js';
import { DIGEST_ALGORITHM_SM3 } from '../../common/crypto/digest.js';
import type { ReportRow, SignatureLogRow } from './report-mapper-types.js';

/**
 * 报告 DTO 映射。
 *
 * 单独成文件的原因：映射逻辑（字段重命名、脱敏、类型收窄）与
 * 业务编排（校验、事务、锁）关注点不同，混在一个文件里两者都会变长。
 */

/**
 * 报告正文的规范化表示。
 *
 * 这是**摘要的唯一输入**。必须：
 *   1. 只含受签名保护的实质内容（不含 updated_at 等易变字段）
 *   2. 键序稳定（由 canonicalizeReportBody 保证）
 *   3. 不含 bodyDigest / bodySha256 自身（否则自引用）
 */
export function buildCanonicalBody(report: ReportRow): unknown {
  return {
    reportId: report.id,
    studyUid: report.study_uid,
    version: report.version,
    templateCode: report.template_code,
    examBodyPart: report.exam_body_part,
    scanMode: report.scan_mode,
    findings: report.structured_findings,
    impression: report.impression,
    followUpRecommendation: report.follow_up_recommendation,
    aiAssist: report.ai_assist,
  };
}

/**
 * 找出缺失的受控字段（五类）。
 *
 * 契约 RPT-01：examBodyPart / scanMode / findings / impression /
 * followUpRecommendation，任一为空 -> 阻断签名（AC-12）。
 */
export function findMissingControlledFields(
  report: ReportRow
): components['schemas']['ControlledFieldKey'][] {
  const missing: components['schemas']['ControlledFieldKey'][] = [];
  if (!report.exam_body_part?.trim()) missing.push('examBodyPart');
  if (!report.scan_mode?.trim()) missing.push('scanMode');

  const findings = report.structured_findings;
  const hasFindings =
    Array.isArray(findings) &&
    findings.length > 0 &&
    findings.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { text?: unknown }).text === 'string' &&
        (item as { text: string }).text.trim().length > 0
    );
  if (!hasFindings) missing.push('findings');

  if (!report.impression?.trim()) missing.push('impression');
  if (!report.follow_up_recommendation?.trim()) missing.push('followUpRecommendation');

  return missing;
}

/** 构造契约的受控字段结构 */
export function buildStructuredFields(
  report: ReportRow
): components['schemas']['StructuredFields'] {
  const author = {
    userId: report.report_doctor_id,
    nameMasked: report.author_name_masked ?? '',
    title: (report.author_title ?? '其他') as components['schemas']['AuthorRef']['title'],
    department: report.author_department ?? '',
  };

  const findings = Array.isArray(report.structured_findings)
    ? (report.structured_findings as components['schemas']['FindingSection'][])
    : [];

  return {
    examBodyPart: report.exam_body_part,
    scanMode: report.scan_mode,
    findings,
    impression: {
      text: report.impression,
      authoredBy: { ...author, authoredAt: report.report_time.toISOString() },
    },
    followUpRecommendation: {
      text: report.follow_up_recommendation,
      authoredBy: { ...author, authoredAt: report.report_time.toISOString() },
    },
    aiAssist: (report.ai_assist ?? {}) as components['schemas']['AiAssist'],
  };
}

/** 构造患者摘要 */
export function buildPatientBrief(
  report: ReportRow
): components['schemas']['PatientBrief'] {
  return {
    patientId: report.empi_id,
    nameMasked: report.patient_name_masked,
    gender: report.gender as components['schemas']['PatientBrief']['gender'],
    birthDate: report.birth_date.toISOString().slice(0, 10),
    ageYears: calculateAge(report.birth_date, report.study_date),
    idCardMasked: report.id_card_masked ?? '',
  };
}

/** 构造就诊信息 */
export function buildVisitBrief(
  report: ReportRow
): components['schemas']['VisitBrief'] {
  return {
    visitId: report.visit_id,
    visitNo: report.visit_no,
    visitType: report.visit_type as components['schemas']['VisitType'],
    dept: report.dept,
    wardDept: report.ward_dept,
    bedNo: report.bed_no,
    admitDate: report.admit_date ? report.admit_date.toISOString() : null,
  };
}

/** 构造检查信息 */
export function buildStudyBrief(
  report: ReportRow
): components['schemas']['StudyBrief'] {
  return {
    accessionNo: report.accession_no,
    modality: report.modality as components['schemas']['Modality'],
    bodyPart: report.body_part as components['schemas']['StudyBrief']['bodyPart'],
    studyDescription: report.study_description ?? undefined,
    studyDate: report.study_date.toISOString(),
  };
}

/** 签名记录 -> 契约的 signature 对象 */
export function toSignature(
  signature: SignatureLogRow
): components['schemas']['ReportSignature'] {
  return {
    signatureId: formatResourceId('r', signature.id),
    serialNo: signature.serial_no,
    documentUniqueSn: signature.document_unique_sn,
    subjectId: signature.subject_id,
    subjectNameMasked: maskName(signature.subject_name),
    digestAlgorithm: DIGEST_ALGORITHM_SM3,
    digestValue: signature.digest_value,
    signatureAlgorithm: 'SM2',
    signatureValue: signature.signature_value,
    certSerial: signature.cert_serial,
    certIssuerName: signature.cert_issuer,
    signedAt: signature.signed_at.toISOString(),
    tsaAuthority: signature.tsa_authority,
    tsaToken: signature.tsa_token,
    logSerialNo: signature.serial_no,
    logIntegrityDigest: signature.log_integrity_digest,
    verifiedAt: signature.signed_at.toISOString(),
  };
}

/** 姓名掩码：保留姓氏 + 末字 */
export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 1) return name;
  return `${name.slice(0, 1)}*${name.slice(-1)}`;
}

/** 计算检查时年龄 */
export function calculateAge(birthDate: Date, studyDate: Date): number {
  let age = studyDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = studyDate.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && studyDate.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/**
 * 构造原文唯一序列号（WS/T 847）。
 *
 * 契约示例形如 `1.2.840.10008.5.1.4.1.1.88.20261022115630.4471` ——
 * 用 DICOM UID 根 + 报告时间 + 序号，全局唯一且可回溯到 PACS 对象。
 */
export function buildDocumentUniqueSn(report: ReportRow, signedAt: Date): string {
  const stamp = signedAt.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const suffix = report.id.replace(/-/g, '').slice(0, 4);
  return `1.2.840.10008.5.1.4.1.1.88.${stamp}.${suffix}`;
}
