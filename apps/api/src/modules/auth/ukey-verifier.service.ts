import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import {
  isCertificateValidAt,
  parseSm2Certificate,
  verifyIssuedBy,
  type Sm2CertificateInfo,
} from '../../common/crypto/signature.js';
import { AuthoritativeTimeService } from '../../common/time/authoritative-time.service.js';

/**
 * UKey 数字证书校验。
 *
 * ## 校验链（契约 /api/v1/auth/login.description）
 *
 *   有效期 -> 颁发者链 -> 吊销列表（CRL/OCSP）-> 私钥签名验证
 *
 * 任一失败即拒绝，且**不透露失败的具体环节** ——
 * 区分「证书过期」与「证书被吊销」等于给攻击者一个 oracle：
 * 他可以据此判断某个序列号是否在院内注册过。
 *
 * ## 关于「私钥签名验证」
 *
 * 登录阶段做的是**证书链 + 有效期 + 吊销状态**校验；
 * 「私钥签名验证」发生在**签名动作**时 ——
 * 医师用 UKey 私钥对本次报告摘要签名（reports 模块）。
 * 登录时的 `ukey_pin_block` 是 PIN 的 PBKDF2 派生值，
 * 用于验证 UKey 的持有（PIN 解锁能力），不是签名。
 *
 * ## 时间基准
 *
 * 有效期判定使用**权威时间**而非本地时间（AC-15 的同一原则）：
 * 本机时钟被篡改时，用本地时间判定证书有效性会得出错误结论。
 */
export interface UkeyVerificationResult {
  cert: Sm2CertificateInfo;
  /** 证书序列号（小写 hex，无冒号） */
  certSerial: string;
}

/** 吊销列表检查器。生产环境对接 CRL/OCSP 服务 */
export interface RevocationChecker {
  /** @returns 该证书是否已被吊销 */
  isRevoked(certSerial: string): Promise<boolean>;
}

export interface UkeyVerifierConfig {
  /** CA 证书 PEM。用于验证颁发者链 */
  caCertificatePem: string;
}

/**
 * DI 令牌。
 *
 * interface 编译后被擦除，不能直接当 Nest 令牌用（会得到 undefined）。
 */
export const REVOCATION_CHECKER = 'REVOCATION_CHECKER';
export const UKEY_VERIFIER_CONFIG = 'UKEY_VERIFIER_CONFIG';

@Injectable()
export class UkeyVerifier {
  constructor(
    private readonly timeService: AuthoritativeTimeService,
    @Inject(REVOCATION_CHECKER) private readonly revocationChecker: RevocationChecker,
    @Inject(UKEY_VERIFIER_CONFIG) private readonly config: UkeyVerifierConfig
  ) {}

  /**
   * 校验 UKey 证书。
   *
   * @param base64Der UKey 中的 SM2 数字证书（Base64 DER）
   * @throws AppError 10002 —— 任何环节失败都归为同一个「凭据无效」
   */
  async verify(base64Der: string): Promise<UkeyVerificationResult> {
    // 权威时间取不到 -> 不能用本地时间做有效期判定
    const authoritative = await this.timeService.now();

    let cert: Sm2CertificateInfo;
    try {
      cert = parseSm2Certificate(base64Der);
    } catch {
      throw invalidCredential();
    }

    // 1. 有效期
    if (!isCertificateValidAt(cert, new Date(authoritative.epochMs))) {
      throw invalidCredential();
    }

    // 2. 颁发者链
    if (!verifyIssuedBy(cert, this.config.caCertificatePem)) {
      throw invalidCredential();
    }

    // 3. 吊销列表
    let revoked = false;
    try {
      revoked = await this.revocationChecker.isRevoked(cert.serial);
    } catch {
      // 吊销服务不可达 -> **按吊销处理**（fail-closed）。
      // 放行等于把「查不到吊销」当成「没被吊销」，攻击者只要让吊销服务
      // 不可达就能用已吊销证书登录。
      throw invalidCredential();
    }
    if (revoked) {
      throw invalidCredential();
    }

    return { cert, certSerial: cert.serial };
  }
}

/**
 * 统一的凭据无效异常。
 *
 * 消息固定为中性表述，**不区分**口令错误 / 证书过期 / 证书被吊销 / 证书链断裂。
 * 契约要求「用户名、口令或 UKey 证书无效」（示例 code 10002）。
 */
function invalidCredential(): AppError {
  return new AppError(
    ERROR_CODES.UNAUTHENTICATED,
    '用户名、口令或 UKey 证书无效',
    401,
    undefined
  );
}
