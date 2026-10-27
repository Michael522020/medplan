import type { components } from '@medplan/contracts/generated';

/**
 * 报告与签名日志的行类型。
 *
 * 单独成文件：repository 与 service 都用得到这些类型，
 * 放在 repository 文件里会让 service 反向依赖 repository 的类型定义。
 */

export interface ReportRow {
  id: string;
  study_uid: string;
  version: number;
  template_code: string;
  status: string;
  exam_body_part: string;
  scan_mode: string;
  findings: string;
  impression: string;
  follow_up_recommendation: string;
  structured_findings: unknown;
  follow_up_detail: unknown;
  ai_assist: unknown;
  segmentation_task_id: string | null;
  report_doctor_id: string;
  review_doctor_id: string | null;
  report_time: Date;
  reviewed_at: Date | null;
  body_digest: string;
  body_digest_algorithm: string;
  body_sha256: string;
  signed_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** 患者摘要（脱敏视图） */
  empi_id: string;
  patient_name_masked: string;
  gender: string;
  birth_date: Date;
  id_card_masked: string | null;
  /** 就诊信息 */
  visit_id: string;
  visit_no: string;
  visit_type: string;
  dept: string;
  ward_dept: string | null;
  bed_no: string | null;
  admit_date: Date | null;
  /** 检查信息 */
  accession_no: string;
  modality: string;
  body_part: string;
  study_description: string | null;
  study_date: Date;
  /** 报告医师 / 审核医师 */
  author_name_masked: string | null;
  author_title: string | null;
  author_department: string | null;
  reviewer_name_masked: string | null;
  reviewer_title: string | null;
  reviewer_department: string | null;
}

export interface RevisionRow {
  version: number;
  body_digest: string;
  change_summary: string;
  edited_at: Date;
  edited_by_masked: string | null;
}

export interface SignatureLogRow {
  id: string;
  serial_no: string;
  document_unique_sn: string;
  subject_id: string;
  subject_name: string;
  subject_title: string;
  subject_dept: string;
  object_type: string;
  object_id: string;
  object_version: number;
  digest_value: string;
  digest_algorithm: string;
  cert_serial: string;
  cert_issuer: string;
  cert_valid_from: Date;
  cert_valid_to: Date;
  crl_checked: boolean;
  crl_check_result: string | null;
  signature_algorithm: string;
  signature_value: string;
  signed_at: Date;
  tsa_authority: string;
  tsa_token: string;
  clock_drift_seconds: number | null;
  log_integrity_digest: string;
}

/** 契约的报告数据类型别名（供 mapper 使用） */
export type ReportResponseData = components['schemas']['ReportResponse']['data'];
