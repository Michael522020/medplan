import { s } from '../../common/validation/schema.js';

/**
 * 登录请求校验。
 *
 * 严格模式（`additionalProperties: false`）：契约的 LoginRequest 明确
 * `additionalProperties: false`，因此客户端多传字段一律拒绝。
 *
 * `ukey_cert` 上限 8192 字符（契约 maxLength）——
 * X.509 证书 Base64 后通常约 1.5KB，8192 足够且能挡住超大 body 攻击。
 */
export const loginRequestSchema = s.object({
  username: s.string({ min: 1, max: 64 }),
  password: s.string({ min: 8, max: 128 }),
  ukey_cert: s.string({ min: 1, max: 8192 }),
  ukey_pin_block: s.optional(s.string({ max: 128 })),
});

export type LoginRequestInput = {
  username: string;
  password: string;
  ukey_cert: string;
  ukey_pin_block?: string;
};
