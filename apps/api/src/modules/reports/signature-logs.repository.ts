import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, query, queryOne, type Queryable } from '../../common/db/pool.js';
import type { SignatureLogRow } from './report-mapper-types.js';

/**
 * 电子签名日志的数据访问。
 *
 * ## 为什么单独成文件
 *
 * `signature_logs` 是**独立存储**的表（WS/T 847 要求「签名日志应独立于
 * 业务系统存储」）。业务库被整体删除或损坏后，凭流水号仍可独立还原
 * 每笔签名的验证结果（COM-10）。
 *
 * 物理上分文件，让「独立」这件事在代码结构上也可见 ——
 * 审阅者一眼能看出签名日志的读写路径不与业务表混在一起。
 *
 * ## 不可变性
 *
 * 该表有 `trg_signature_logs_immutable` 触发器（禁止 UPDATE/DELETE）
 * 与 `trg_signature_logs_no_truncate`。因此本 repository **只有 INSERT 与 SELECT**。
 */
@Injectable()
export class SignatureLogsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** 取报告的签名记录（最新一条） */
  async findLatest(reportId: string): Promise<SignatureLogRow | undefined> {
    return queryOne<SignatureLogRow>(
      this.pool,
      `SELECT id,
              serial_no,
              document_unique_sn,
              subject_id,
              subject_name,
              subject_title,
              subject_dept,
              object_type,
              object_id,
              object_version,
              digest_value,
              digest_algorithm,
              cert_serial,
              cert_issuer,
              cert_valid_from,
              cert_valid_to,
              crl_checked,
              crl_check_result,
              signature_algorithm,
              signature_value,
              signed_at,
              tsa_authority,
              tsa_token,
              clock_drift_seconds,
              log_integrity_digest
         FROM signature_logs
        WHERE object_type = 'report'
          AND object_id = $1
        ORDER BY object_version DESC
        LIMIT 1`,
      [reportId]
    );
  }

  /**
   * 按幂等键查签名记录。
   *
   * 幂等重放的判定依据：同一 `Idempotency-Key` 返回**同一**流水号，
   * 不产生第二条签名记录（避免同一份报告出现两个有效签名 —— 法律风险）。
   */
  async findByIdempotencyKey(key: string): Promise<SignatureLogRow | undefined> {
    return queryOne<SignatureLogRow>(
      this.pool,
      `SELECT id,
              serial_no,
              document_unique_sn,
              subject_id,
              subject_name,
              subject_title,
              subject_dept,
              object_type,
              object_id,
              object_version,
              digest_value,
              digest_algorithm,
              cert_serial,
              cert_issuer,
              cert_valid_from,
              cert_valid_to,
              crl_checked,
              crl_check_result,
              signature_algorithm,
              signature_value,
              signed_at,
              tsa_authority,
              tsa_token,
              clock_drift_seconds,
              log_integrity_digest
         FROM signature_logs
        WHERE idempotency_key = $1`,
      [key]
    );
  }

  /**
   * 写签名日志（WS/T 847 字段逐项对应）。
   *
   * 唯一约束 `uq_signature_idempotency` 保证幂等：同一键第二次写入会被
   * DB 拒绝，因此并发双击不会产生两个流水号。
   */
  async insert(
    client: Queryable,
    params: {
      serialNo: string;
      documentUniqueSn: string;
      subjectId: string;
      subjectName: string;
      subjectTitle: string;
      subjectDept: string;
      objectId: string;
      objectVersion: number;
      digestValue: string;
      certSerial: string;
      certIssuer: string;
      certValidFrom: Date;
      certValidTo: Date;
      crlChecked: boolean;
      crlCheckResult: string | null;
      signatureValue: string;
      signedAt: Date;
      tsaAuthority: string;
      tsaToken: string;
      clockDriftSeconds: number | null;
      logIntegrityDigest: string;
      idempotencyKey: string;
    }
  ): Promise<void> {
    await query(
      client,
      `INSERT INTO signature_logs (
         serial_no, document_unique_sn, subject_id, subject_name, subject_title, subject_dept,
         object_type, object_id, object_version, digest_value, digest_algorithm,
         cert_serial, cert_issuer, cert_valid_from, cert_valid_to, cert_chain,
         crl_checked, crl_check_result, signature_algorithm, signature_value,
         signed_at, tsa_authority, tsa_token, clock_drift_seconds,
         log_integrity_digest, idempotency_key, retention_class
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         'report', $7, $8, $9, 'SM3',
         $10, $11, $12, $13, NULL,
         $14, $15, 'SM2', $16,
         $17, $18, $19, $20,
         $21, $22, 'signature_perm'
       )`,
      [
        params.serialNo,
        params.documentUniqueSn,
        params.subjectId,
        params.subjectName,
        params.subjectTitle,
        params.subjectDept,
        params.objectId,
        params.objectVersion,
        params.digestValue,
        params.certSerial,
        params.certIssuer,
        params.certValidFrom,
        params.certValidTo,
        params.crlChecked,
        params.crlCheckResult,
        params.signatureValue,
        params.signedAt,
        params.tsaAuthority,
        params.tsaToken,
        params.clockDriftSeconds,
        params.logIntegrityDigest,
        params.idempotencyKey,
      ]
    );
  }

  /**
   * 生成下一个签名流水号。
   *
   * 格式 `SN-yyyy-MM-dd-nnnnnn`（契约 WS/T 847 要求，系统内唯一）。
   * 依赖 `uq_signature_serial_no` 唯一约束兜底并发。
   */
  async nextSerialNo(client: Queryable, signedAt: Date): Promise<string> {
    const prefix = `SN-${formatDatePart(signedAt)}`;
    const row = await queryOne<{ max_serial: string | null }>(
      client,
      `SELECT max(serial_no) AS max_serial
         FROM signature_logs
        WHERE serial_no LIKE $1`,
      [`${prefix}-%`]
    );
    const current = row?.max_serial
      ? Number.parseInt(row.max_serial.slice(prefix.length + 1), 10)
      : 0;
    const next = (Number.isFinite(current) ? current : 0) + 1;
    return `${prefix}-${String(next).padStart(6, '0')}`;
  }
}

/** 日期部分格式化 YYYY-MM-DD（按本地时区） */
function formatDatePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
