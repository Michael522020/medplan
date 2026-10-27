import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

import { withBusinessSearchPath } from '../common/db/pool.js';
import { StudiesRepository } from '../modules/studies/studies.repository.js';
import type { AccessContext } from '../common/db/access-scope.repository.js';

/**
 * 数据库 schema 相关的**集成测试**（真实 PostgreSQL）。
 *
 * ## 为什么要真实数据库
 *
 * 这两个缺陷都是**只在真实库上才暴露**的：
 *   - `?schema=medplan` 被 node-postgres 静默忽略 —— 只有真的连上去
 *     执行 `SHOW search_path` 才知道
 *   - 视图没有 `deleted_at` 列 —— 只有真的查一次才报 42703
 *
 * 单元测试用 mock 查询，永远抓不到这两类问题：
 * mock 掉的正是「SQL 能不能在真实 schema 下执行」这件事本身。
 *
 * 需要环境变量：
 *   TEST_DATABASE_URL  指向已建好 schema 的 PostgreSQL 18
 * 未设置时整个套件跳过（不产生假绿）。
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

describeIf('数据库 schema 集成测试（真实 PostgreSQL）', () => {
  let pool: Pool;

  before(async () => {
    // 与应用相同的连接串处理（应用侧靠 withBusinessSearchPath 保证 search_path）
    pool = new Pool({ connectionString: withBusinessSearchPath(databaseUrl as string) });
  });

  after(async () => {
    await pool.end();
  });

  it('缺陷 1 回归：连接自带正确的 search_path（不依赖 DB 级设置）', async () => {
    const result = await pool.query('SHOW search_path');
    const searchPath = result.rows[0]?.search_path ?? '';
    assert.match(
      searchPath,
      /medplan/,
      `search_path 必须含 medplan schema，实际为「${searchPath}」。` +
        '全部 28 张业务表都在 medplan schema 下，search_path 不对则每条查询都 42P01。'
    );
  });

  it('缺陷 1 回归：?schema= 参数无效，withBusinessSearchPath 会补上 options', () => {
    // node-postgres 只认 ?options=，?schema= 会被静默忽略
    const fixed = withBusinessSearchPath(
      'postgresql://u:p@host:5432/db?schema=medplan'
    );
    assert.match(fixed, /[?&]options=/, '必须补上 options 参数');
    assert.match(decodeURIComponent(fixed), /search_path=medplan,public/);
  });

  it('缺陷 1 回归：URL 已带 options 时不覆盖运维的设置', () => {
    const original = 'postgresql://u:p@host:5432/db?options=-c%20search_path%3Dother';
    assert.equal(withBusinessSearchPath(original), original);
  });

  it('缺陷 1 回归：不带任何参数的裸连接也能用（.env.example 形态）', async () => {
    const bare = new Pool({
      connectionString: withBusinessSearchPath(
        (databaseUrl as string).split('?')[0] as string
      ),
    });
    try {
      const result = await bare.query('SHOW search_path');
      assert.match(result.rows[0]?.search_path ?? '', /medplan/);
      // 真正查一张业务表 —— 这是「能不能跑」的最终判据
      await bare.query('SELECT count(*) FROM segmentation_tasks');
    } finally {
      await bare.end();
    }
  });

  it('缺陷 2 回归：v_patients_masked 上不引用 deleted_at（视图无此列）', async () => {
    // 视图定义里已内部过滤软删除，列清单里没有 deleted_at
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'medplan' AND table_name = 'v_patients_masked'`
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(
      names.includes('deleted_at'),
      false,
      '视图不应有 deleted_at 列（测试前提：视图定义未变）'
    );
    // 直接查一次：若 SQL 里写了 p.deleted_at，这里会报 42703
    const result = await pool.query(
      'SELECT 1 AS ok FROM v_patients_masked p LIMIT 1'
    );
    assert.ok(result.rows.length >= 0);
  });

  it('缺陷 2 回归：probePatientScope 在真实库上可执行（不报 42703）', async () => {
    const repository = new StudiesRepository(pool);
    // 构造一个无任何可见性的访问者：globalScope=false 且科室不匹配
    const access: AccessContext = {
      userId: '00000000-0000-4000-8000-000000000000',
      departmentCode: '__不存在的科室__',
      globalScope: false,
      isTrainee: false,
    };
    // 关键：只断言「不抛异常」。若 SQL 里含 p.deleted_at，这里会抛 42703。
    const visible = await repository.probePatientScope('EMPI00000000', access);
    assert.equal(typeof visible, 'boolean');
  });

  it('缺陷 2 回归：v_patients_plain 有 name 而无 name_masked（明文路径用对列）', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'medplan' AND table_name = 'v_patients_plain'`
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.ok(names.includes('name'), '明文视图应有 name 列');
    assert.equal(
      names.includes('name_masked'),
      false,
      '明文视图不应有 name_masked 列'
    );
  });
});
