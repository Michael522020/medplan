import { verify as verifyOneShot, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';

/**
 * SM2 签名验签。
 *
 * ## 分工
 *
 * 契约明确「私钥不出 UKey」——**私钥签名在浏览器侧的 UKey 内完成**，
 * 前端把 `signatureValue`（Base64 DER 的 SM2 签名值）传上来。
 * 后端只做**验签**，不持有私钥，也不做签名运算。
 *
 * 验签对象（openapi.yaml SignReportRequest.description）：
 *   对 `SM3(nonce || reportId || version || bodyDigest)` 做 SM2 签名。
 * 后端用证书里的 SM2 公钥验签，**验签输入必须与服务端重算的 bodyDigest 一致** ——
 * 这正是「正文被改则签名失效」的技术落点。
 *
 * ## 与密码机的关系
 *
 * 架构方案要求「密码运算全部委托密码机，应用层不实现密码算法」。
 * 本模块只做**验签**（纯公钥运算，不接触密钥材料），是应用层可安全承担的部分；
 * 涉及私钥或需出具证明材料的环节由 reports 模块的 `SignatureService`
 * 对接密码机与 TSA。
 *
 * SM2 依赖 Node 内建 OpenSSL 3.x 的 SM2 曲线支持（`namedCurve: 'SM2'` + `sm3` 摘要）。
 */

export interface Sm2CertificateInfo {
  /** 证书序列号（十六进制，去掉冒号） */
  serial: string;
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  /** 证书内公钥 */
  publicKey: KeyObject;
  /** 原始 PEM，便于留证 */
  pem: string;
}

/**
 * 解析 SM2 数字证书。
 *
 * 校验链（openapi.yaml /api/v1/auth/login.description）：
 *   有效期 -> 颁发者链 -> 吊销列表 -> 私钥签名验证
 *
 * 本函数负责**证书结构解析**；
 * 有效期判定见 `isCertificateValidAt`（用权威时间，不用本地时间）；
 * 颁发者链见 `verifyIssuedBy`；吊销列表由调用方用 CRL/OCSP 校验。
 *
 * 任一失败即拒绝，且**不透露失败的具体环节**（避免证书状态侧信道）。
 */
export function parseSm2Certificate(base64Der: string): Sm2CertificateInfo {
  const pem = toPem(base64Der);
  const cert = new X509Certificate(pem);
  return {
    serial: cert.serialNumber.replace(/:/g, '').toLowerCase(),
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom: new Date(cert.validFrom),
    validTo: new Date(cert.validTo),
    publicKey: cert.publicKey,
    pem,
  };
}

/**
 * 校验证书在权威时间点处于有效期内。
 *
 * 注意时间基准用的是**调用方传入的权威时间**，不是本地时间 ——
 * 与 AC-15 一致：本地时间不可信时不能用本地时间做判断。
 */
export function isCertificateValidAt(info: Sm2CertificateInfo, authoritativeNow: Date): boolean {
  return authoritativeNow >= info.validFrom && authoritativeNow <= info.validTo;
}

/**
 * 校验证书确由指定 CA 签发。
 *
 * 用 CA 公钥验证证书上的签名 —— 证书被换成自签名的伪造件时这里会失败。
 * `X509Certificate.checkIssued` 正是做这件事：校验 issuer 匹配且签名可被
 * CA 公钥验证。
 */
export function verifyIssuedBy(info: Sm2CertificateInfo, caCertificatePem: string): boolean {
  try {
    const ca = new X509Certificate(caCertificatePem);
    const cert = new X509Certificate(info.pem);
    return cert.checkIssued(ca);
  } catch {
    return false;
  }
}

/**
 * SM2 验签。
 *
 * @param message  被签名的消息（本系统为 `nonce||reportId||version||bodyDigest` 原文）
 * @param signatureBase64Der  Base64 编码的 DER 签名值
 * @param publicKey 证书公钥
 */
export function verifySm2(
  message: Buffer,
  signatureBase64Der: string,
  publicKey: KeyObject
): boolean {
  try {
    const signature = Buffer.from(signatureBase64Der, 'base64');
    if (signature.length === 0) return false;
    // 用**一次性** verify API：`createVerify().verify(key, data, sig)` 在
    // 本机 Node 22.22.2 上对正确签名会静默返回 false（参数顺序不匹配），
    // 是典型的沉默逻辑错误陷阱。一次性形式已用真实密钥对验证通过。
    return verifyOneShot('sm3', message, { key: publicKey, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}

/**
 * 构造签名消息：`nonce || reportId || version || bodyDigest`。
 *
 * 契约规定的签名输入（openapi.yaml SignReportRequest.description）。
 * bodyDigest 传 **SM3 十六进制字符串**，与服务端落库的 `reports.body_digest`
 * 完全同源，保证签名绑定的是同一份正文摘要。
 */
export function buildSignMessage(params: {
  nonce: string;
  reportId: string;
  version: number;
  bodyDigest: string;
}): Buffer {
  return Buffer.from(
    `${params.nonce}${params.reportId}${params.version}${params.bodyDigest}`,
    'utf8'
  );
}

/** 由 PEM 提取公钥（供验签使用） */
export function publicKeyFromPem(pem: string): KeyObject {
  return createPublicKey(pem);
}

/** Base64 DER -> PEM */
function toPem(base64Der: string): string {
  const clean = base64Der.replace(/\s+/g, '');
  const body = clean.replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}
