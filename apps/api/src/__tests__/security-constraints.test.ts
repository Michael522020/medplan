import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { AppError } from '../common/errors/app-error.js';
import { ERROR_CODES, INDISTINGUISHABLE_BODY } from '../common/errors/error-codes.js';
import { parseOrThrow, s } from '../common/validation/schema.js';
import {
  isSubmittableModel,
  lookupLicense,
  assertModelLicenseIntegrity,
  API_EXPOSED_MODELS,
} from '../modules/segmentation/model-license-whitelist.js';
import { sm3Hex, sha256Hex, canonicalizeReportBody } from '../common/crypto/digest.js';
import { confirmSegmentationSchema } from '../modules/segmentation/segmentation.schema.js';
import { findMissingControlledFields } from '../modules/reports/report-mapper.js';
import { fingerprintRequestBody } from '../common/idempotency/idempotency.service.js';

/**
 * 四条不可妥协安全约束的行为验证。
 *
 * 这些是**纯逻辑**断言，不依赖数据库 —— 因此在离线环境也能跑。
 * 数据库相关的行为（越权探测的时序等）需要集成测试，
 * 已在交付说明中标注为待补。
 */

describe('安全约束 #1：10004 与 10005 的不可区分性', () => {
  it('10004 与 10005 的响应体字节数相同', () => {
    const denied = AppError.inaccessible();
    const notFound = AppError.notFound();

    // message 字面量相同
    assert.equal(denied.message, notFound.message);
    // data 均为 null（不泄露任何资源信息）
    assert.equal(denied.detail, undefined);
    assert.equal(notFound.detail, undefined);
    // HTTP 状态码相同
    assert.equal(denied.httpStatus, notFound.httpStatus);
    // code 字段等长（5 位数字）
    assert.equal(String(denied.code).length, String(notFound.code).length);
  });

  it('不可区分响应体不含任何可区分信息', () => {
    const body = { ...INDISTINGUISHABLE_BODY };
    assert.equal(body.code, ERROR_CODES.FORBIDDEN_DATA);
    assert.equal(body.message, '请求的资源不可用');
    assert.equal(body.data, null);
    // 不得出现泄露语义的词
    for (const word of ['患者', '不存在', '无权限', '检查']) {
      assert.equal(
        body.message.includes(word),
        false,
        `不可区分响应体不得包含「${word}」`
      );
    }
  });

  it('AppError.inaccessible() 恒返回 10004 / HTTP 404', () => {
    const err = AppError.inaccessible();
    assert.equal(err.code, ERROR_CODES.FORBIDDEN_DATA);
    assert.equal(err.httpStatus, 404);
  });

  it('AppError.notFound() 恒返回 10005 / HTTP 404', () => {
    const err = AppError.notFound();
    assert.equal(err.code, ERROR_CODES.NOT_FOUND);
    assert.equal(err.httpStatus, 404);
  });
});

describe('安全约束 #2：模型许可白名单', () => {
  it('brain_aneurysm（CC BY-NC 4.0）不在可提交集合内', () => {
    assert.equal(isSubmittableModel('brain_aneurysm'), false);
  });

  it('brain_aneurysm 的许可登记为 CC BY-NC 4.0 且不允许商用', () => {
    const entry = lookupLicense('brain_aneurysm');
    assert.ok(entry, 'brain_aneurysm 必须在许可登记表中');
    assert.equal(entry.license, 'CC BY-NC 4.0');
    assert.equal(entry.commercialUseAllowed, false);
  });

  it('契约暴露的 4 个模型全部可商用', () => {
    for (const model of API_EXPOSED_MODELS) {
      assert.equal(isSubmittableModel(model), true, `${model} 应可提交`);
      const entry = lookupLicense(model);
      assert.equal(entry?.license, 'Apache-2.0');
      assert.equal(entry?.commercialUseAllowed, true);
    }
  });

  it('未登记的 task 一律不可提交（白名单默认拒绝）', () => {
    assert.equal(isSubmittableModel('totally_made_up_task'), false);
    assert.equal(lookupLicense('totally_made_up_task'), undefined);
  });

  it('启动期完整性校验通过', () => {
    // 断言失败会抛错 —— 说明白名单与上游脱节了
    assert.doesNotThrow(() => assertModelLicenseIntegrity());
  });
});

describe('安全约束 #3：confirmed_by 由后端从会话取', () => {
  it('请求体传 confirmedBy 被 schema 拒绝', () => {
    const body = {
      items: [{ structureName: 'liver', action: 'confirmed' }],
      confirmedBy: 'u-9-attacker',
    };
    assert.throws(
      () => parseOrThrow(confirmSegmentationSchema, body, 'confirm'),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.PARAM_INVALID);
        return true;
      },
      'confirmedBy 必须被拒绝'
    );
  });

  it('请求体传 confirmedAt 被 schema 拒绝', () => {
    const body = {
      items: [{ structureName: 'liver', action: 'confirmed' }],
      confirmedAt: '2026-10-22T10:00:00+08:00',
    };
    assert.throws(() => parseOrThrow(confirmSegmentationSchema, body, 'confirm'));
  });

  it('item 内的额外字段同样被拒绝（additionalProperties: false）', () => {
    const body = {
      items: [{ structureName: 'liver', action: 'confirmed', confirmedBy: 'u-9' }],
    };
    assert.throws(() => parseOrThrow(confirmSegmentationSchema, body, 'confirm'));
  });

  it('合法请求体通过校验', () => {
    const body = { items: [{ structureName: 'liver', action: 'confirmed' }] };
    const parsed = parseOrThrow(confirmSegmentationSchema, body, 'confirm');
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.structureName, 'liver');
  });

  it('action=modified 缺 modificationNote 时通过 schema（业务层再拦）', () => {
    // schema 层允许缺省（契约把「必填」放在 description 里），
    // 业务层再判 —— 但**绝不能**让确认人字段进入 schema。
    const body = { items: [{ structureName: 'liver', action: 'modified' }] };
    const parsed = parseOrThrow(confirmSegmentationSchema, body, 'confirm');
    assert.equal(parsed.items[0]?.modificationNote, undefined);
  });
});

describe('安全约束 #4：签名摘要绑定与锁定', () => {
  const baseReport = {
    id: 'r-1',
    study_uid: '1.2.3',
    version: 4,
    template_code: 'abdomen_liver_ct_v3',
    exam_body_part: '上腹部',
    scan_mode: '腹部平扫+三期增强CT',
    structured_findings: [{ key: 'portal', label: '门脉期', text: '病灶表现' }],
    impression: '肝右叶占位',
    follow_up_recommendation: '建议随访',
    ai_assist: { disclosure: 'x', modelName: 'total', modelVersion: '2.18.0', degraded: false, segmentationTaskId: 'seg-1', allItemsConfirmed: true, referencedStructures: [] },
  } as never;

  it('SM3 符合国标测试向量', () => {
    // GB/T 32905-2016 标准测试向量
    assert.equal(
      sm3Hex('abc'),
      '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0'
    );
  });

  it('正文改一字符 -> SM3 摘要变化（签名失效，AC-14）', () => {
    const original = canonicalizeReportBody(baseReport);
    const tampered = canonicalizeReportBody({
      ...(baseReport as object),
      impression: '肝右叶占位（篡改）',
    });
    assert.notEqual(sm3Hex(original), sm3Hex(tampered));
  });

  it('SM3 与 SHA-256 是不同的摘要（签名绑定用 SM3，对账用 SHA-256）', () => {
    const content = '报告正文';
    assert.notEqual(sm3Hex(content), sha256Hex(content));
    assert.equal(sm3Hex(content).length, 64);
    assert.equal(sha256Hex(content).length, 64);
  });

  it('键序不同但内容相同的正文 -> 摘要相同（规范化生效）', () => {
    const a = canonicalizeReportBody({ x: 1, y: 2, z: 3 });
    const b = canonicalizeReportBody({ z: 3, y: 2, x: 1 });
    assert.equal(a, b);
    assert.equal(sm3Hex(a), sm3Hex(b));
  });

  it('受控字段缺失会被识别（阻断签名，AC-12）', () => {
    const missing = findMissingControlledFields({
      ...(baseReport as object),
      impression: '',
    } as never);
    assert.deepEqual(missing, ['impression']);
  });

  it('五类受控字段齐全时不报缺失', () => {
    assert.deepEqual(findMissingControlledFields(baseReport), []);
  });
});

describe('幂等语义', () => {
  it('同键同体 -> 相同指纹', () => {
    const body = { studyUid: '1.2.3', model: 'total' };
    assert.equal(
      fingerprintRequestBody(body).digest,
      fingerprintRequestBody({ model: 'total', studyUid: '1.2.3' }).digest
    );
  });

  it('同键不同体 -> 不同指纹', () => {
    const a = fingerprintRequestBody({ studyUid: '1.2.3' }).digest;
    const b = fingerprintRequestBody({ studyUid: '1.2.4' }).digest;
    assert.notEqual(a, b);
  });

  it('指纹用 SHA-256（非 SM3）—— 指纹不参与签名运算', () => {
    const digest = fingerprintRequestBody({ a: 1 }).digest;
    assert.equal(digest.length, 64);
    assert.equal(digest, createHash('sha256').update('{"a":1}').digest('hex'));
  });
});

describe('严格校验器', () => {
  it('拒绝未知字段', () => {
    const schema = s.object({ a: s.string() });
    assert.throws(() => parseOrThrow(schema, { a: 'x', b: 'y' }));
  });

  it('缺必填字段被拒绝', () => {
    const schema = s.object({ a: s.string() });
    assert.throws(() => parseOrThrow(schema, {}));
  });

  it('枚举外的值被拒绝', () => {
    const schema = s.object({ a: s.enumOf(['x', 'y']) });
    assert.throws(() => parseOrThrow(schema, { a: 'z' }));
  });

  it('模式不匹配被拒绝', () => {
    const schema = s.object({ a: s.string({ pattern: /^[0-9]+$/ }) });
    assert.throws(() => parseOrThrow(schema, { a: 'abc' }));
  });

  it('合法输入通过', () => {
    const schema = s.object({ a: s.string(), b: s.optional(s.number()) });
    assert.deepEqual(parseOrThrow(schema, { a: 'x' }), { a: 'x' });
  });
});
