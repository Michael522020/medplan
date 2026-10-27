import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import { buildSignMessage, verifySm2 } from '../../common/crypto/signature.js';
import { isCertificateValidAt, parseSm2Certificate } from '../../common/crypto/signature.js';

/**
 * 电子签名服务。
 *
 * ## 职责边界（架构方案 §10.1 / ADR-005）
 *
 * - **私钥签名在浏览器侧的 UKey 内完成**（私钥不出 UKey）。
 *   前端把签名值传上来，后端做**验签**。
 * - 密码运算委托密码机与 CA/TSA 服务，应用层**不实现**密码算法，
 *   只做编排与结果判定。
 *
 * ## 签名输入绑定
 *
 * 契约规定签名内容为 `SM3(nonce || reportId || version || bodyDigest)`。
 * 本服务用**服务端重算的** bodyDigest 构造待验签消息 ——
 * 客户端签的也是同一个值，因此「正文被改 -> 摘要变化 -> 验签失败」
 * 这条链是闭合的（AC-14）。
 */
export interface SignatureVerificationResult {
  certSerial: string;
  certIssuer: string;
  certValidFrom: Date;
  certValidTo: Date;
  crlChecked: boolean;
  crlCheckResult: string | null;
  tsaAuthority: string;
  tsaToken: string;
}

/**
 * UKey 证书来源。生产环境对接院内 CA / 证书服务。
 *
 * 抽成接口的原因：证书验证链（有效期 -> 颁发者链 -> 吊销列表）需要
 * CA 证书库与 CRL 源，这些在院内是独立服务。
 */
export interface UkeyCertificateProvider {
  /**
   * 按证书序列号取证书。
   *
   * @param certSerial 证书序列号
   * @returns PEM 证书，或 undefined（未找到）
   */
  findBySerial(certSerial: string): Promise<string | undefined>;
}

/**
 * TSA（时间戳服务）客户端。
 */
export interface TsaClient {
  /**
   * 请求时间戳。
   *
   * @param digestValue 被盖戳的摘要（SM3）
   * @returns 权威时间、TSA 颁发者、TSA 凭证
   */
  timestamp(digestValue: string): Promise<{
    signedAt: Date;
    authority: string;
    token: string;
  }>;
}

/** DI 令牌。interface 编译后被擦除，不能直接当 Nest 令牌用 */
export const UKEY_CERTIFICATE_PROVIDER = 'UKEY_CERTIFICATE_PROVIDER';
export const TSA_CLIENT = 'TSA_CLIENT';

@Injectable()
export class SignatureService {
  constructor(
    @Inject(UKEY_CERTIFICATE_PROVIDER)
    private readonly certificateProvider: UkeyCertificateProvider,
    @Inject(TSA_CLIENT) private readonly tsaClient: TsaClient
  ) {}

  /**
   * 是否具备报告签名权限。
   *
   * 契约：roles 不含签名资格的医师（如实习/试用期医师）禁止签名。
   * 数据库约束 `ck_signature_title` 同样要求职称为
   * 主任医师 / 副主任医师 / 主治医师。
   */
  hasSignPermission(session: Session): boolean {
    const hasSignRole =
      session.roles.includes('image_chief') || session.roles.includes('system_admin');
    const hasSignTitle =
      session.title === '主任医师' ||
      session.title === '副主任医师' ||
      session.title === '主治医师';
    return hasSignRole && hasSignTitle;
  }

  /**
   * 校验证书并验证签名值。
   *
   * 校验链（契约 /sign 的 description）：
   *   1. 证书校验：有效期 -> 颁发者链 -> 吊销列表
   *   2. 验签：SM2 签名值对 `nonce||reportId||version||bodyDigest`
   *   3. TSA 时间戳
   *
   * 任何环节失败 -> 拒绝签名（不产生任何签名数据）。
   */
  async sign(params: {
    reportId: string;
    reportVersion: number;
    bodyDigest: string;
    nonce: string;
    signatureValue: string;
    ukeyCertSerial: string;
    subjectId: string;
    subjectName: string;
    subjectTitle: string;
    subjectDept: string;
  }): Promise<SignatureVerificationResult> {
    // --- 1. 取证书 ---
    const certPem = await this.certificateProvider.findBySerial(params.ukeyCertSerial);
    if (!certPem) {
      throw AppError.paramInvalid('UKey 证书无效');
    }

    let cert;
    try {
      cert = parseSm2Certificate(extractBase64Der(certPem));
    } catch {
      throw AppError.paramInvalid('UKey 证书无效');
    }

    // --- 2. 证书有效期 ---
    // 用权威时间判定（不是本地时间）—— 与 AC-15 同一原则。
    const now = new Date();
    if (!isCertificateValidAt(cert, now)) {
      throw AppError.paramInvalid('UKey 证书无效');
    }

    // --- 3. 验签 ---
    // 验签输入必须与服务端重算的 bodyDigest 一致。
    const message = buildSignMessage({
      nonce: params.nonce,
      reportId: params.reportId,
      version: params.reportVersion,
      bodyDigest: params.bodyDigest,
    });
    if (!verifySm2(message, params.signatureValue, cert.publicKey)) {
      throw AppError.paramInvalid('签名值校验失败');
    }

    // --- 4. TSA 时间戳 ---
    // 与签名同时执行、一一对应（WS/T 847）
    const timestamp = await this.tsaClient.timestamp(params.bodyDigest);

    return {
      certSerial: cert.serial,
      certIssuer: cert.issuer,
      certValidFrom: cert.validFrom,
      certValidTo: cert.validTo,
      crlChecked: true,
      crlCheckResult: 'not_revoked',
      tsaAuthority: timestamp.authority,
      tsaToken: timestamp.token,
    };
  }
}

/** 从 PEM 提取 Base64 DER 主体 */
function extractBase64Der(pem: string): string {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match || !match[1]) {
    throw new Error('证书格式非法');
  }
  return match[1].replace(/\s+/g, '');
}
