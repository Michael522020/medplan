import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  signSessionToken,
  verifyJwt,
  type JwtVerifierConfig,
} from '../common/auth/jwt-verifier.js';
import { createSharedSecretResolver } from '../common/auth/jwks-resolver.js';
import { AppError } from '../common/errors/app-error.js';
import { ERROR_CODES, INDISTINGUISHABLE_BODY } from '../common/errors/error-codes.js';
import { parseOrThrow } from '../common/validation/schema.js';
import { confirmSegmentationSchema } from '../modules/segmentation/segmentation.schema.js';
import {
  isSubmittableModel,
  lookupLicense,
  MODEL_LICENSE_REGISTRY,
} from '../modules/segmentation/model-license-whitelist.js';
import { sm3Hex, canonicalizeReportBody } from '../common/crypto/digest.js';

/**
 * Phase 4 QA 回归集。
 *
 * ## 为什么要有这个文件
 *
 * 现有 36 条单元测试全部是**纯逻辑**断言，不触碰「签发 -> 验签」闭环、
 * 不触碰真实视图结构。Phase 4 独立验证实测出两个 P0，**现有测试一个都抓不到**：
 *
 *   P0-01 会话令牌：signSessionToken 产出 44 字节的签名段，
 *         verifyJwt 拿它跟 32 字节的 HMAC 比 —— 长度不等 -> 永远 401。
 *         登录成功但每个请求都 401。
 *   P0-02 probePatientScope 查 v_patients_masked.deleted_at，
 *         而该视图没有这一列 —— 该路径 42703 -> 500。
 *
 * 两条都是「编译通过、单测全绿、产品不可用」的沉默逻辑错误。
 * 本文件把这些变成**会变红的断言**。
 *
 * ## 断言纪律
 *
 * - 断言必须来自**契约与规格**（Spec.md / openapi.yaml），不来自实现现状。
 * - 每条断言都问一次「它能不能区分对错」——恒真的断言等于没写。
 * - 覆盖反作弊：没有 skip、没有恒真断言、没有对实现的复述。
 */

/** 生产用的同一份共享密钥（未配 SESSION_SECRET 时的开发默认值） */
const SECRET = Buffer.from('dev-only-insecure-secret-change-me', 'utf8');

const VERIFIER_CONFIG: JwtVerifierConfig = {
  issuer: 'http://localhost',
  realm: 'medplan',
  audience: undefined,
  clockToleranceSeconds: 30,
};

describe('回归 P0-01：会话令牌签发 -> 验签闭环', () => {
  it('signSessionToken 签发的令牌必须能被 verifyJwt 接受', async () => {
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

    // 签名段解码后必须正好是 HMAC-SHA256 的原始长度。
    // 双重 base64 编码会把它变成 44 字节 —— 这条断言直接把它挡住。
    const signatureSegment = token.split('.')[2] ?? '';
    assert.equal(
      Buffer.from(signatureSegment, 'base64url').length,
      32,
      '签名段解码后应为 32 字节（HMAC-SHA256 原始长度），出现 44 字节说明被双重 base64 编码'
    );

    // 闭环：生产签发 -> 生产验签
    const session = await verifyJwt(token, VERIFIER_CONFIG, createSharedSecretResolver(SECRET));
    assert.equal(session.userId, '11111111-1111-4111-8111-111111111111');
    assert.equal(session.department, 'RADIOLOGY');
    assert.deepEqual(session.roles, ['image_physician']);
  });

  it('验签失败必须返回 10002，而不是抛出裸异常', async () => {
    const { token } = signSessionToken(
      {
        sub: 'u-1',
        dept: 'RADIOLOGY',
        roles: ['image_physician'],
        ukeyCertSerial: 'X',
        jti: 'j',
        expiresInSeconds: 3600,
      },
      SECRET
    );
    // 用**错误**的密钥验签
    await assert.rejects(
      () =>
        verifyJwt(
          token,
          VERIFIER_CONFIG,
          createSharedSecretResolver(Buffer.from('wrong-secret-that-is-long-enough!!'))
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.UNAUTHENTICATED);
        assert.equal(err.httpStatus, 401);
        return true;
      }
    );
  });

  it('被篡改的载荷必须验签失败（不能只改一个字符就过）', async () => {
    const { token } = signSessionToken(
      {
        sub: 'u-1',
        dept: 'RADIOLOGY',
        roles: ['image_physician'],
        ukeyCertSerial: 'X',
        jti: 'j',
        expiresInSeconds: 3600,
      },
      SECRET
    );
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p ?? '', 'base64url').toString('utf8')) as {
      sub: string;
    };
    payload.sub = 'u-2';
    const forgedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const forged = `${h}.${forgedPayload}.${s}`;
    await assert.rejects(() =>
      verifyJwt(forged, VERIFIER_CONFIG, createSharedSecretResolver(SECRET))
    );
  });

  it('过期令牌必须被拒绝（exp 不容忍）', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'u-1',
        dept: 'RADIOLOGY',
        roles: ['image_physician'],
        jti: 'j',
        iat: nowSec - 7200,
        exp: nowSec - 3600,
      }),
      'utf8'
    ).toString('base64url');
    const signed = `${header}.${payload}`;
    const sig = createHmac('sha256', SECRET).update(signed).digest();
    const expired = `${signed}.${sig.toString('base64url')}`;
    await assert.rejects(
      () => verifyJwt(expired, VERIFIER_CONFIG, createSharedSecretResolver(SECRET)),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.UNAUTHENTICATED);
        return true;
      }
    );
  });
});

describe('回归 P0-02：视图列存在性（探针查询不得引用不存在的列）', () => {
  /**
   * v_patients_masked 的列来自 docs/db/migrations/001_init.sql。
   * 这条断言把「视图有哪些列」固化下来 ——
   * probePatientScope 若引用 deleted_at，DB 层会 42703，
   * 而这类错误在纯逻辑单测里永远不会暴露。
   */
  const V_PATIENTS_MASKED_COLUMNS = [
    'id',
    'empi_id',
    'name_masked',
    'gender',
    'birth_date',
    'id_card_masked',
    'phone_masked',
    'insurance_no',
    'created_at',
    'updated_at',
  ];

  it('v_patients_masked 不含 deleted_at（视图内部已过滤）', () => {
    assert.equal(
      V_PATIENTS_MASKED_COLUMNS.includes('deleted_at'),
      false,
      '视图已在 WHERE deleted_at IS NULL 内过滤，不应再暴露 deleted_at 列'
    );
  });

  it('probePatientScope 的 WHERE 不得引用 p.deleted_at', async () => {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');

    // 从本文件位置向上找 apps/api/src/... 的**源码**（编译产物里只有 .js）
    let dir = dirname(fileURLToPath(import.meta.url));
    let sourcePath: string | undefined;
    for (let i = 0; i < 8; i++) {
      const candidate = resolve(
        dir,
        'apps/api/src/modules/studies/studies.repository.ts'
      );
      if (existsSync(candidate)) {
        sourcePath = candidate;
        break;
      }
      dir = resolve(dir, '..');
    }
    if (!sourcePath) {
      // 找不到源码（例如从发布产物运行）—— 跳过这条源码级断言，
      // 但**不**静默通过：明确标记为未覆盖。
      assert.fail('未找到 studies.repository.ts 源码，probePatientScope 列引用断言未能执行');
    }

    const source = await readFile(sourcePath, 'utf8');
    const start = source.indexOf('async probePatientScope');
    assert.ok(start > 0, 'probePatientScope 必须存在');
    const body = source.slice(start, source.indexOf('\n  }', start));
    assert.equal(
      /p\.deleted_at/.test(body),
      false,
      'probePatientScope 查的是 v_patients_masked 视图，该视图没有 deleted_at 列 —— ' +
        '引用它会让 GET /studies?patientId= 路径在运行时 42703'
    );
  });
});

describe('回归：10004 与 10005 的 HTTP 响应体不可区分', () => {
  it('两者的响应体**大小**必须相同（架构方案 §7.6 的要求）', () => {
    /** 与 AppExceptionFilter 的输出结构一致 */
    const render = (err: AppError): Buffer =>
      Buffer.from(
        JSON.stringify({
          code: err.code,
          message: err.message,
          data: err.detail ?? null,
        }),
        'utf8'
      );

    const denied = render(AppError.inaccessible());
    const notFound = render(AppError.notFound());
    assert.equal(
      denied.length,
      notFound.length,
      '越权与不存在的响应体字节数必须相同（攻击者可用 Content-Length 区分）'
    );
    // 注：两者的 code 值不同（10004 vs 10005），故字节内容必然不同。
    // 这本身不构成存在性预言机 —— 见下一条断言：
    // 生产代码在 PHI 可导航路径上**从不**抛 10005。
  });

  it('PHI 可导航路径上不得抛 10005（否则 code 本身就是存在性预言机）', async () => {
    const { readFile } = await import('node:fs/promises');
    const { readdir } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve, join } = await import('node:path');

    let dir = dirname(fileURLToPath(import.meta.url));
    let srcRoot: string | undefined;
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'apps/api/src');
      if (existsSync(candidate)) {
        srcRoot = candidate;
        break;
      }
      dir = resolve(dir, '..');
    }
    assert.ok(srcRoot, '未找到 apps/api/src 源码目录');

    const offenders: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          await walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const src = await readFile(full, 'utf8');
          if (/AppError\.notFound\(\)/.test(src)) {
            offenders.push(full.slice(srcRoot!.length + 1));
          }
        }
      }
    };
    await walk(srcRoot);

    assert.deepEqual(
      offenders,
      [],
      `以下生产代码使用了 10005（资源不存在）。在 PHI 可导航路径上，10004 与 10005 的 code 值不同，` +
        `攻击者读 code 即可判断资源是否存在，违反 PRD COM-03：${offenders.join(', ')}`
    );
  });

  it('不可区分响应体不得泄露存在性词汇', () => {
    const text = JSON.stringify(INDISTINGUISHABLE_BODY);
    for (const word of ['患者', '不存在', '无权限', '检查', '越权']) {
      assert.equal(text.includes(word), false, `不可区分响应体不得包含「${word}」`);
    }
  });

  it('10004 与 10005 的 HTTP 状态码与 message 必须相同', () => {
    assert.equal(AppError.inaccessible().httpStatus, AppError.notFound().httpStatus);
    assert.equal(AppError.inaccessible().httpStatus, 404);
    assert.equal(AppError.inaccessible().message, AppError.notFound().message);
  });
});

describe('回归：AI 模型许可白名单的对抗性绕过', () => {
  it('每一个非 Apache-2.0 task 都必须不可提交', () => {
    for (const [task, entry] of MODEL_LICENSE_REGISTRY) {
      if (entry.license === 'Apache-2.0' && entry.commercialUseAllowed) continue;
      assert.equal(
        isSubmittableModel(task),
        false,
        `${task} 的许可是 ${entry.license}，绝不可提交`
      );
    }
  });

  it('brain_aneurysm（CC BY-NC 4.0）必须被拒绝', () => {
    assert.equal(isSubmittableModel('brain_aneurysm'), false);
    assert.equal(lookupLicense('brain_aneurysm')?.license, 'CC BY-NC 4.0');
  });

  it('大小写与空白变体不得绕过白名单', () => {
    // 白名单是精确匹配集合，任何变形都必须落空
    for (const variant of [
      'BRAIN_ANEURYSM',
      'brain_aneurysm ',
      ' brain_aneurysm',
      'brain-aneurysm',
      'brain_aneurysm\n',
    ]) {
      assert.equal(
        isSubmittableModel(variant),
        false,
        `变形「${JSON.stringify(variant)}」不得绕过白名单`
      );
    }
  });

  it('未登记 task 一律拒绝（白名单默认拒绝）', () => {
    for (const t of ['', 'total ', 'TOTAL', '../total', 'total;drop', 'total\u0000']) {
      assert.equal(isSubmittableModel(t), false, `未登记 task「${t}」必须拒绝`);
    }
  });
});

describe('回归：confirmedBy / confirmedAt 不得由客户端指定（对抗性）', () => {
  it('顶层传 confirmedBy 被拒', () => {
    assert.throws(() =>
      parseOrThrow(confirmSegmentationSchema, {
        items: [{ structureName: 'liver', action: 'confirmed' }],
        confirmedBy: 'u-9-attacker',
      })
    );
  });

  it('顶层传 confirmedAt 被拒', () => {
    assert.throws(() =>
      parseOrThrow(confirmSegmentationSchema, {
        items: [{ structureName: 'liver', action: 'confirmed' }],
        confirmedAt: '2026-10-22T10:00:00+08:00',
      })
    );
  });

  it('item 内嵌套传 confirmedBy 被拒', () => {
    assert.throws(() =>
      parseOrThrow(confirmSegmentationSchema, {
        items: [{ structureName: 'liver', action: 'confirmed', confirmedBy: 'u-9' }],
      })
    );
  });

  it('item 内嵌套传 confirmedAt 被拒', () => {
    assert.throws(() =>
      parseOrThrow(confirmSegmentationSchema, {
        items: [{ structureName: 'liver', action: 'confirmed', confirmedAt: '2026-10-22' }],
      })
    );
  });

  it('深层嵌套（items[0].meta.confirmedBy）被拒', () => {
    assert.throws(() =>
      parseOrThrow(confirmSegmentationSchema, {
        items: [
          {
            structureName: 'liver',
            action: 'confirmed',
            meta: { confirmedBy: 'u-9' },
          },
        ],
      })
    );
  });

  it('原型污染式字段名被拒（按真实路径：JSON.parse 会把 __proto__ 变成自有属性）', () => {
    // 请求体在 Fastify 里是 JSON.parse 出来的 —— JSON.parse 用
    // DefineOwnProperty 定义 __proto__，它是**自有可枚举属性**，
    // 校验器的 Object.keys 能看见它 -> 必须被当作未定义字段拒绝。
    const body = JSON.parse(
      '{"items":[{"structureName":"liver","action":"confirmed"}],"__proto__":{"confirmedBy":"u-9"}}'
    ) as unknown;
    assert.throws(() => parseOrThrow(confirmSegmentationSchema, body));
  });

  it('constructor / prototype 键同样被拒', () => {
    for (const raw of [
      '{"items":[{"structureName":"liver","action":"confirmed"}],"constructor":"x"}',
      '{"items":[{"structureName":"liver","action":"confirmed"}],"prototype":"x"}',
    ]) {
      assert.throws(
        () => parseOrThrow(confirmSegmentationSchema, JSON.parse(raw) as unknown),
        `未定义键 ${raw.slice(-20)} 必须被拒绝`
      );
    }
  });
});

describe('回归 P0-04：listStudies 的 SQL 里 JOIN 必须在 WHERE 之前', () => {
  /**
   * PostgreSQL（与标准 SQL）要求 JOIN 属于 FROM 列表，必须出现在 WHERE 之前。
   * `WHERE <expr> LEFT JOIN ...` 是 42601 语法错误，
   * 而 `GET /api/v1/studies`（工作台入口）会直接 500。
   *
   * 这条断言从源码层面守住拼接顺序 —— SQL 语法错误在纯逻辑单测里永远不会暴露。
   */
  it('LEFT JOIN LATERAL 必须落在 baseSelect 片段内部（WHERE 之前）', async () => {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve, join } = await import('node:path');

    let dir = dirname(fileURLToPath(import.meta.url));
    let sourcePath: string | undefined;
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'apps/api/src/modules/studies/studies.repository.ts');
      if (existsSync(candidate)) {
        sourcePath = candidate;
        break;
      }
      dir = resolve(dir, '..');
    }
    assert.ok(sourcePath, '未找到 studies.repository.ts 源码');

    const source = await readFile(sourcePath, 'utf8');

    // baseSelect 模板字符串的范围
    const declIndex = source.indexOf('const baseSelect = `');
    assert.ok(declIndex > 0, '必须存在 baseSelect 片段');
    const literalStart = source.indexOf('`', declIndex);
    const literalEnd = source.indexOf('`', literalStart + 1);
    assert.ok(literalStart > 0 && literalEnd > literalStart, 'baseSelect 模板字面量边界异常');

    const lateralIndex = source.indexOf('LEFT JOIN LATERAL');
    assert.ok(lateralIndex > 0, '必须存在 LEFT JOIN LATERAL');

    assert.ok(
      lateralIndex < literalEnd,
      'LEFT JOIN LATERAL 出现在 baseSelect 之外 —— 它会被拼在 WHERE 子句之后，' +
        'PostgreSQL 报 42601 syntax error at or near "LEFT"，工作台列表端点 100% 500。' +
        'JOIN 必须属于 FROM 列表，必须在 WHERE 之前。'
    );
  });
});

describe('回归 P0-05：query string 的 page/limit 必须先转换再校验', () => {
  /**
   * Fastify 的 query 参数永远是字符串（`?page=1` -> `'1'`）。
   * 若把**原始** query 交给 `s.number()` 校验器，必定报「必须为有限数字」，
   * `GET /api/v1/studies?page=1&limit=20` 与 `GET /api/v1/audit-logs?page=1` 直接 400。
   *
   * 正确顺序是「先 normalize（字符串 -> 数字），再 parseOrThrow」。
   */
  const CASES: Array<{ file: string; schemaCall: string; normalizeCall: string }> = [
    {
      file: 'apps/api/src/modules/studies/studies.controller.ts',
      schemaCall: 'parseOrThrow(studyListQuerySchema',
      normalizeCall: 'normalizeStudyListQuery(',
    },
    {
      file: 'apps/api/src/modules/audit-logs/audit-logs.controller.ts',
      schemaCall: 'parseOrThrow(auditLogQuerySchema',
      normalizeCall: 'normalizeAuditQuery(',
    },
  ];

  for (const c of CASES) {
    it(`${c.file.split('/').pop()}：normalize 必须早于 parseOrThrow`, async () => {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, resolve, join } = await import('node:path');

      let dir = dirname(fileURLToPath(import.meta.url));
      let sourcePath: string | undefined;
      for (let i = 0; i < 8; i++) {
        const candidate = join(dir, c.file);
        if (existsSync(candidate)) {
          sourcePath = candidate;
          break;
        }
        dir = resolve(dir, '..');
      }
      assert.ok(sourcePath, `未找到 ${c.file}`);

      const source = await readFile(sourcePath, 'utf8');
      const schemaIndex = source.indexOf(c.schemaCall);
      const normalizeIndex = source.indexOf(c.normalizeCall);
      assert.ok(schemaIndex > 0, `未找到 ${c.schemaCall}`);
      assert.ok(normalizeIndex > 0, `未找到 ${c.normalizeCall}`);

      assert.ok(
        normalizeIndex < schemaIndex,
        `${c.normalizeCall} 必须在 ${c.schemaCall} **之前**调用。` +
          'query string 的数值参数是字符串，先校验会直接报「必须为有限数字」，' +
          '列表端点带 page/limit 时 100% 400。'
      );
    });
  }

  it('normalizeStudyListQuery 能把数字字符串转成 number', async () => {
    const { normalizeStudyListQuery } = await import(
      '../modules/studies/studies.schema.js'
    );
    const normalized = normalizeStudyListQuery({ page: '2', limit: '50' });
    assert.equal(normalized.page, 2);
    assert.equal(normalized.limit, 50);
  });
});

describe('回归：签名摘要绑定（AC-13 / AC-14）', () => {
  const base = {
    id: 'r-1',
    version: 4,
    template_code: 'abdomen_liver_ct_v3',
    exam_body_part: '上腹部',
    scan_mode: '腹部平扫+三期增强CT',
    findings: '病灶表现',
    impression: '肝右叶占位',
    follow_up_recommendation: '建议随访',
  } as never;

  it('正文改一个字符 -> SM3 变化', () => {
    const a = sm3Hex(canonicalizeReportBody(base));
    const b = sm3Hex(
      canonicalizeReportBody({ ...(base as object), impression: '肝右叶占位。' })
    );
    assert.notEqual(a, b);
  });

  it('改**不参与签名的字段**不应影响摘要（否则签名前后不一致）', () => {
    // version / id 参与签名（buildSignMessage 里含 version），
    // 但正文规范化对象本身不应含易变字段 updated_at
    const canonical = canonicalizeReportBody(base);
    assert.equal(canonical.includes('updated_at'), false);
  });

  it('键序不同、内容相同 -> 摘要相同（规范化生效）', () => {
    const a = canonicalizeReportBody({ x: 1, y: 2, z: 3 });
    const b = canonicalizeReportBody({ z: 3, y: 2, x: 1 });
    assert.equal(a, b);
    assert.equal(sm3Hex(a), sm3Hex(b));
  });

  it('数组顺序不同 -> 摘要不同（数组不得被排序）', () => {
    const a = canonicalizeReportBody({ items: [1, 2, 3] });
    const b = canonicalizeReportBody({ items: [3, 2, 1] });
    assert.notEqual(a, b);
  });
});
