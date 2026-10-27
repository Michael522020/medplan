import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../common/errors/app-error.js';
import { ERROR_CODES } from '../common/errors/error-codes.js';
import {
  fingerprintRequestBody,
  resolveIdempotentReplay,
  IDEMPOTENCY_TTL_HOURS,
} from '../common/idempotency/idempotency.service.js';

/**
 * 幂等语义验证（契约 §2）。
 *
 *   - 同一 Idempotency-Key + 同一请求体 -> 返回首次结果（idempotentReplay = true）
 *   - 同一 Idempotency-Key + **不同**请求体 -> code 10001（幂等键冲突）
 *
 * 这些断言针对**判定逻辑**（指纹比对），不依赖数据库。
 * 落库路径的集成验证需要 PostgreSQL，已在交付说明中列为待补项。
 */

describe('幂等键语义：同键同体 vs 同键异体', () => {
  const putBody = {
    version: 3,
    title: '肝右叶后段病灶楔形切除入路规划（修订）',
    payload: { entry: { patientXYZmm: [-65.8, 121.0, -36.8] } },
  };

  it('同键同体 -> 判定为重放（不抛错）', () => {
    const first = fingerprintRequestBody(putBody).digest;
    const retry = fingerprintRequestBody({
      version: 3,
      title: '肝右叶后段病灶楔形切除入路规划（修订）',
      payload: { entry: { patientXYZmm: [-65.8, 121.0, -36.8] } },
    }).digest;

    assert.equal(first, retry);
    assert.equal(resolveIdempotentReplay(first, retry), true);
  });

  it('同键异体 -> 抛 10001（幂等键冲突）', () => {
    const first = fingerprintRequestBody(putBody).digest;
    const different = fingerprintRequestBody({ ...putBody, title: '改了标题' }).digest;

    assert.notEqual(first, different);
    assert.throws(
      () => resolveIdempotentReplay(first, different),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.PARAM_INVALID);
        assert.equal(err.httpStatus, 400);
        return true;
      }
    );
  });

  it('同键但 version 不同 -> 也是异体（冲突）', () => {
    const first = fingerprintRequestBody(putBody).digest;
    const different = fingerprintRequestBody({ ...putBody, version: 4 }).digest;
    assert.notEqual(first, different);
    assert.throws(() => resolveIdempotentReplay(first, different));
  });

  it('同键但 payload 不同 -> 也是异体（冲突）', () => {
    const first = fingerprintRequestBody(putBody).digest;
    const different = fingerprintRequestBody({
      ...putBody,
      payload: { entry: { patientXYZmm: [0, 0, 0] } },
    }).digest;
    assert.notEqual(first, different);
    assert.throws(() => resolveIdempotentReplay(first, different));
  });

  it('键序不同但内容相同 -> 同体（稳定序列化生效）', () => {
    const a = fingerprintRequestBody({ version: 3, title: 'T' }).digest;
    const b = fingerprintRequestBody({ title: 'T', version: 3 }).digest;
    assert.equal(a, b);
    assert.equal(resolveIdempotentReplay(a, b), true);
  });

  it('首次请求的指纹缺失时按「异体」处理（不静默当重放）', () => {
    const current = fingerprintRequestBody(putBody).digest;
    // 首次请求的指纹读不到（历史数据/异常）-> 必须报冲突而不是返回旧结果。
    // 宁可让客户端多试一次，也不能返回一个与本次请求无关的旧结果。
    assert.throws(() => resolveIdempotentReplay('different', current));
  });

  it('幂等记录保留 24 小时（契约 §2）', () => {
    assert.equal(IDEMPOTENCY_TTL_HOURS, 24);
  });
});

describe('幂等键与乐观锁的语义边界', () => {
  it('幂等解决「同一请求重复提交」，乐观锁解决「两人改同一方案」', () => {
    // 场景 A：同一请求重试（同键同体）-> 幂等命中，返回首次结果，不产生新版本
    const body = { version: 3, title: 'A' };
    const f1 = fingerprintRequestBody(body).digest;
    const f2 = fingerprintRequestBody(body).digest;
    assert.equal(resolveIdempotentReplay(f1, f2), true);

    // 场景 B：不同请求体、同一个方案 -> 幂等不命中（异体 -> 冲突），
    // 而后由 version 乐观锁判定是否为并发冲突（409 + 20003）。
    // 两者是**不同的错误**：前者 10001（幂等键复用），后者 20003（版本冲突）。
    const other = fingerprintRequestBody({ version: 4, title: 'B' }).digest;
    assert.throws(
      () => resolveIdempotentReplay(f1, other),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.PARAM_INVALID); // 10001
        return true;
      }
    );
  });
});
