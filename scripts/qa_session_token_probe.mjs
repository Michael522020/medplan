/**
 * Phase 4 QA —— 会话令牌「签发 -> 验签」闭环验证
 *
 * 用**生产代码**（apps/api/.qa-build/common/auth/jwt-verifier.js）验证：
 *   signSessionToken() 签发的令牌，能否被 verifyJwt() 接受。
 *
 * 这是登录链路的核心闭环：登录成功 -> 拿到 token -> 用 token 访问业务端点。
 * 若签发与验签的字节编码不一致，令牌**签得出来但用不了** ——
 * 用户表现为「登录成功但每个请求都 401」。
 */

import { signSessionToken, verifyJwt } from '../apps/api/.qa-build/common/auth/jwt-verifier.js';
import { createSharedSecretResolver } from '../apps/api/.qa-build/common/auth/jwks-resolver.js';

const SECRET = Buffer.from('dev-only-insecure-secret-change-me', 'utf8');
const resolver = createSharedSecretResolver(SECRET);

const config = {
  issuer: 'http://localhost',
  realm: 'medplan',
  audience: undefined,
  clockToleranceSeconds: 30,
};

const { token } = signSessionToken(
  {
    sub: '11111111-1111-4111-8111-111111111111',
    dept: 'RADIOLOGY',
    roles: ['image_physician'],
    ukeyCertSerial: 'QA-UK-SERIAL-0001',
    jti: 'qa-jti-0001',
    expiresInSeconds: 3600,
  },
  SECRET
);

console.log('=== 签名段字节分析 ===');
const [h, p, s] = token.split('.');
const sigBytes = Buffer.from(s, 'base64url');
console.log(`  令牌签名段（base64url 解码后）字节长度 = ${sigBytes.length}`);
console.log(`  HMAC-SHA256 原始签名长度            = 32`);
console.log(`  长度是否相等 = ${sigBytes.length === 32}`);

console.log('');
console.log('=== 生产代码闭环验证（signSessionToken -> verifyJwt）===');
try {
  const session = await verifyJwt(token, config, resolver);
  console.log(`  PASS：验签通过，session.userId=${session.userId}`);
  console.log(`        session.department=${session.department}`);
  console.log(`        session.roles=${JSON.stringify(session.roles)}`);
} catch (err) {
  console.log(`  FAIL：验签失败 -> ${err.constructor.name}: ${err.message}`);
  console.log(`        code=${err.code} httpStatus=${err.httpStatus}`);
}

console.log('');
console.log('=== 对照：手工按「单次 base64url」编码的令牌 ===');
const { createHmac } = await import('node:crypto');
const b64u = (v) => Buffer.from(v, 'utf8').toString('base64url');
const issuedAt = Math.floor(Date.now() / 1000);
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64u(
  JSON.stringify({
    sub: '11111111-1111-4111-8111-111111111111',
    dept: 'RADIOLOGY',
    roles: ['image_physician'],
    ukey_cert_serial: 'QA-UK-SERIAL-0001',
    jti: 'qa-jti-0001',
    iat: issuedAt,
    exp: issuedAt + 3600,
  })
);
const signedData = `${header}.${payload}`;
const rawSig = createHmac('sha256', SECRET).update(signedData).digest();
const manualToken = `${signedData}.${rawSig.toString('base64url')}`;
console.log(`  单次 base64url 签名段字节长度 = ${Buffer.from(rawSig.toString('base64url'), 'base64url').length}`);
try {
  const session = await verifyJwt(manualToken, config, resolver);
  console.log(`  PASS：验签通过，session.userId=${session.userId}`);
  console.log(`        session.department=${session.department}`);
  console.log(`        session.roles=${JSON.stringify(session.roles)}`);
  console.log('');
  console.log('  >>> 结论：验签逻辑本身正确，是「签发端编码」与「验签端解码」不一致。');
} catch (err) {
  console.log(`  FAIL：${err.message}`);
}
