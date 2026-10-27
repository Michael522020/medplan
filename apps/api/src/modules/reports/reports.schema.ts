import { s } from '../../common/validation/schema.js';

/**
 * 报告端点的请求校验。
 */

/**
 * 签名请求。
 *
 * ## 关键点
 *
 * 1. `digestAlgorithm` 只能是 `SM3` —— 国密要求。契约枚举即单值。
 * 2. `nonce` 必须是 32 位十六进制（契约 pattern `^[0-9a-f]{32}$`），
 *    用于防重放 + 签名超时（WS/T 847）。
 * 3. `reportVersion` 必填 —— 防止「签了旧版」（契约明确：与服务端当前版本
 *    不一致 -> code 10001）。
 * 4. `ukeyCertSerial` 必填 —— 服务端须校验其与会话绑定的证书一致，
 *    防「换 Key 签名」。
 */
export const signReportSchema = s.object({
  reportVersion: s.number({ integer: true, min: 1 }),
  digestAlgorithm: s.literal('SM3'),
  ukeyCertSerial: s.string({ min: 1, max: 128 }),
  nonce: s.string({
    pattern: /^[0-9a-f]{32}$/,
    patternHint: '必须是 32 位小写十六进制',
  }),
  signatureValue: s.string({ min: 1, max: 4096 }),
});

export type SignReportInput = {
  reportVersion: number;
  digestAlgorithm: 'SM3';
  ukeyCertSerial: string;
  nonce: string;
  signatureValue: string;
};
