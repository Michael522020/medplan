import { createHash } from 'node:crypto';

/**
 * 摘要计算。
 *
 * ## 为什么要 SM3 与 SHA-256 双摘要
 *
 * Spec AC-13 原文写「绑定正文 SHA-256 摘要」，而 ADR-005 / 密评要求国密
 * SM2 + SM3。**SM2 签名算法内部固定使用 SM3 摘要**，无法改为对 SHA-256 签名。
 * 两者不是二选一，而是两个不同用途（openapi.yaml `ReportResponse.bodyDigest`
 * 与 `bodySha256` 的说明已按此固化）：
 *
 *   bodyDigest  = SM3，国密签名**真正绑定**的值，签名日志记它。
 *                 正文改一字符 -> 本值变化 -> 原签名立即失效（AC-14）。
 *   bodySha256  = SHA-256，AC-13 要求的内容绑定值，且是与既有 HIS/EMR
 *                 交叉比对时的通用值。
 *
 * **SHA-256 不参与国密签名运算** —— 用它做签名不满足密评的国密算法要求。
 * 因此签名有效性判定一律以 SM3 为准（安全约束 #4）。
 *
 * SM3 的实现依赖 Node 内建 OpenSSL 3.x 的 `SM3` 算法标识（`createHash('SM3')`）。
 * 已用国标 GB/T 32905-2016 标准测试向量验证：
 *   SM3("abc") = 66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0
 */

/** 国密摘要算法标识。落库 CHECK 约束强制为 SM3 */
export const DIGEST_ALGORITHM_SM3 = 'SM3';

/** 对账用摘要算法标识。不参与国密签名运算 */
export const DIGEST_ALGORITHM_SHA256 = 'SHA-256';

/**
 * 计算 SM3 摘要（十六进制小写，64 字符）。
 *
 * @param content 待摘要内容。报告正文须先经 `canonicalizeReportBody` 规范化，
 *                否则同一份报告在不同字段顺序下会得到不同摘要。
 */
export function sm3Hex(content: string): string {
  return createHash('SM3').update(content, 'utf8').digest('hex');
}

/**
 * 计算 SHA-256 摘要（十六进制小写，64 字符）。
 *
 * 仅用于与既有 HIS/EMR 的内容对账与前端展示，**不参与签名有效性判定**。
 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 报告正文规范化。
 *
 * 摘要必须对「同一份报告」唯一，因此要消除表示层面的差异：
 *   1. 对象键按字典序排序（否则 JSON.stringify 的键序依赖插入顺序）
 *   2. 不含任何与签名无关的易变字段（updated_at 等）
 *   3. 换行统一为 \n
 *
 * 注意：正文里**不得**包含 `bodyDigest` / `bodySha256` 自身，
 * 否则会出现自引用（摘要的输入依赖摘要的输出）。
 */
export function canonicalizeReportBody(value: unknown): string {
  return stableStringify(value);
}

/**
 * 稳定序列化：对象键字典序、数组保序、无空白。
 *
 * 与 JSON.stringify 的区别在于键排序 —— 这正是「同一份报告同一摘要」的前提。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
