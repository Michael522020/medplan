/**
 * Phase 4 QA —— 越权响应时序不可区分性实测（架构方案 §12.3 C-3）
 *
 * ## 为什么要这个脚本
 *
 * 越权（10004）与「患者不存在」（10005）的不可区分性，是本项目最核心的安全主张。
 * 此前只有**结构性保证**（恒定索引路径的探测查询），**没有任何实测**。
 * 结构上「看起来会执行同样的查询」不等于实测「响应时间分布一致」。
 *
 * 本脚本 import **生产代码的编译产物**（apps/api/.qa-build/…），
 * 不复制 SQL —— 复制 SQL 会引入「副本与实现漂移」的风险，
 * 测出来的结论可能对不上真实实现。
 *
 * ## 三种场景
 *
 * | 场景 | 含义 | 期望 |
 * |------|------|------|
 * | A | 患者存在，攻击者**有权限** | 200，有数据 |
 * | B | 患者**存在但无权限**（越权） | 10004 |
 * | C | 患者**完全不存在** | 10004 |
 *
 * 判定：B 与 C 的 p99 响应时间差异 < 20%（架构方案 §12.3 C-3）。
 *
 * ## 前置
 *
 *   npm run build:test -w @medplan/api
 *   bash scripts/verify_db_local.sh          # 或手动起 PG18
 *   psql -f scripts/qa_seed_timing.sql       # 装载三种场景
 *
 * ## 用法
 *
 *   DATABASE_URL=postgresql://postgres:medplan_ci_only@localhost:15433/medplan_qa \
 *     node scripts/qa_timing_probe.mjs [采样次数]
 */

import { Pool } from 'pg';
import { StudiesRepository } from '../apps/api/.qa-build/modules/studies/studies.repository.js';
import { SeriesRepository } from '../apps/api/.qa-build/modules/studies/series.repository.js';

const SAMPLES = Number.parseInt(process.argv[2] ?? '1000', 10);
const WARMUP = Number.parseInt(process.env.QA_WARMUP ?? '300', 10);

const CONNECTION_STRING =
  process.env.DATABASE_URL ??
  'postgresql://postgres:medplan_ci_only@localhost:15433/medplan_qa';

const QA_USER = '11111111-1111-4111-8111-111111111111';
const STUDY_A = '1.2.840.10008.5.1.4.1.1.2.9001'; // 有权限
const STUDY_B = '1.2.840.10008.5.1.4.1.1.2.9002'; // 存在但无权限 -> 越权 10004
const STUDY_C = '1.2.840.10008.5.1.4.1.1.2.9999'; // 不存在 -> 10004
const PATIENT_A = 'EMPI0000000001';
const PATIENT_B = 'EMPI0000000002';
const PATIENT_C = 'EMPI0000000099';

/** 攻击者上下文：普通影像科医师，非全局角色，非实习医师 */
const ATTACKER = {
  userId: QA_USER,
  departmentCode: 'RADIOLOGY',
  globalScope: false,
  isTrainee: false,
};

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

/** 两组分布的重叠度：1 = 完全分离（完全可区分），0 = 完全重叠 */
function overlapRatio(a, b) {
  const lo = Math.min(...a, ...b);
  const hi = Math.max(...a, ...b);
  if (hi === lo) return 0;
  const BINS = 50;
  const binWidth = (hi - lo) / BINS;
  const histA = new Array(BINS).fill(0);
  const histB = new Array(BINS).fill(0);
  for (const v of a) histA[Math.min(BINS - 1, Math.floor((v - lo) / binWidth))]++;
  for (const v of b) histB[Math.min(BINS - 1, Math.floor((v - lo) / binWidth))]++;
  let overlap = 0;
  for (let i = 0; i < BINS; i++) overlap += Math.min(histA[i], histB[i]);
  return overlap / Math.max(a.length, b.length);
}

async function main() {
  const pool = new Pool({
    connectionString: CONNECTION_STRING,
    max: 4,
    application_name: 'qa-timing',
    // 必须显式设 search_path —— node-postgres **静默忽略**连接串里的
    // `?schema=medplan`（实测 SHOW search_path 仍是 "$user", public）。
    // 详见 QA-REPORT 缺陷 P0-01。
    options: '-c search_path=medplan,public',
  });
  const studies = new StudiesRepository(pool);
  const series = new SeriesRepository(pool);

  // ---- 前置断言：场景设置正确，否则对比无意义 ----
  const aProbe = await studies.probeStudy(STUDY_A);
  const bProbe = await studies.probeStudy(STUDY_B);
  const cProbe = await studies.probeStudy(STUDY_C);

  /** probePatientScope 包一层：它可能抛错，那本身就是缺陷证据，不能让采样崩掉 */
  const safeScope = async (empiId) => {
    try {
      return { ok: await studies.probePatientScope(empiId, ATTACKER), error: null };
    } catch (err) {
      return { ok: null, error: `${err.code ?? ''} ${err.message}`.trim() };
    }
  };

  const aVisible = await safeScope(PATIENT_A);
  const bVisible = await safeScope(PATIENT_B);
  const cVisible = await safeScope(PATIENT_C);

  console.log('=== 场景前置断言 ===');
  console.log(`  A 存在=${aProbe !== undefined}  A 可见=${aVisible.ok}  (期望 true/true)`);
  console.log(`  B 存在=${bProbe !== undefined}  B 可见=${bVisible.ok}  (期望 true/false)`);
  console.log(`  C 存在=${cProbe !== undefined}  C 可见=${cVisible.ok}  (期望 false/false)`);
  if (aVisible.error || bVisible.error || cVisible.error) {
    console.error('  !! probePatientScope 运行时报错 —— GET /studies?patientId= 路径不可用：');
    for (const [k, v] of Object.entries({ A: aVisible, B: bVisible, C: cVisible })) {
      if (v.error) console.error(`     ${k}: ${v.error}`);
    }
  }
  if (!aProbe || !bProbe || cProbe !== undefined) {
    console.error('  !! 场景设置不成立，拒绝采样');
    await pool.end();
    process.exit(2);
  }

  /** 一次「等价 service 路径」采样：probe + scope，与 StudiesService.listSeries 一致 */
  const sampleOnce = async (studyUid) => {
    const t0 = process.hrtime.bigint();
    const p0 = process.hrtime.bigint();
    await studies.probeStudy(studyUid);
    const p1 = process.hrtime.bigint();
    await series.findStudyWithSeries(studyUid, ATTACKER);
    const t1 = process.hrtime.bigint();
    return {
      probe: Number(p1 - p0) / 1e6,
      scope: Number(t1 - p1) / 1e6,
      total: Number(t1 - t0) / 1e6,
    };
  };

  // ---- 预热（避免某场景冷缓存、另一场景热缓存的系统性偏差）----
  for (let i = 0; i < WARMUP; i++) {
    await sampleOnce(STUDY_A);
    await sampleOnce(STUDY_B);
    await sampleOnce(STUDY_C);
  }

  // ---- 轮转采样（消除随时间漂移的偏差）----
  const sa = [];
  const sb = [];
  const sc = [];
  for (let i = 0; i < SAMPLES; i++) {
    sa.push(await sampleOnce(STUDY_A));
    sb.push(await sampleOnce(STUDY_B));
    sc.push(await sampleOnce(STUDY_C));
  }

  const totalA = sa.map((s) => s.total);
  const totalB = sb.map((s) => s.total);
  const totalC = sc.map((s) => s.total);

  const st = stats(totalA);
  const sbS = stats(totalB);
  const scS = stats(totalC);

  console.log('');
  console.log('=== 端到端（probe + scope），单位 ms ===');
  console.log('场景                  n      min      p50      p90      p95      p99      max     mean');
  for (const [name, s] of [
    ['A 有权限    ', st],
    ['B 越权10004 ', sbS],
    ['C 不存在    ', scS],
  ]) {
    console.log(
      `${name} ${String(s.n).padStart(5)} ${s.min.toFixed(3).padStart(9)} ${s.p50.toFixed(3).padStart(9)} ` +
        `${s.p90.toFixed(3).padStart(9)} ${s.p95.toFixed(3).padStart(9)} ${s.p99.toFixed(3).padStart(9)} ` +
        `${s.max.toFixed(3).padStart(9)} ${s.mean.toFixed(3).padStart(9)}`
    );
  }

  const p99Diff = ((sbS.p99 - scS.p99) / scS.p99) * 100;
  const p50Diff = ((sbS.p50 - scS.p50) / scS.p50) * 100;
  const p99Abs = Math.abs(p99Diff);
  const overlap = overlapRatio(totalB, totalC);

  console.log('');
  console.log('=== 判定（架构方案 §12.3 C-3：p99 差异 < 20%）===');
  console.log(`  p99 绝对差异   : ${p99Diff.toFixed(2)}%   (阈值 |diff| < 20%)`);
  console.log(`  p50 绝对差异   : ${p50Diff.toFixed(2)}%`);
  console.log(`  分布重叠度     : ${(overlap * 100).toFixed(2)}%   (越低越不可区分)`);
  console.log(`  判定           : ${p99Abs < 20 ? 'PASS' : 'FAIL'}`);

  console.log('');
  console.log('=== 分段归因（定位差异来源）===');
  const ps = stats(sb.map((s) => s.probe));
  const pcs = stats(sc.map((s) => s.probe));
  const ss = stats(sb.map((s) => s.scope));
  const scs = stats(sc.map((s) => s.scope));
  const pd = (x, y) => (((x - y) / y) * 100).toFixed(2);
  console.log(`  探测查询 p50: B=${ps.p50.toFixed(3)}  C=${pcs.p50.toFixed(3)}  差异=${pd(ps.p50, pcs.p50)}%`);
  console.log(`  探测查询 p99: B=${ps.p99.toFixed(3)}  C=${pcs.p99.toFixed(3)}  差异=${pd(ps.p99, pcs.p99)}%`);
  console.log(`  作用域 p50  : B=${ss.p50.toFixed(3)}  C=${scs.p50.toFixed(3)}  差异=${pd(ss.p50, scs.p50)}%`);
  console.log(`  作用域 p99  : B=${ss.p99.toFixed(3)}  C=${scs.p99.toFixed(3)}  差异=${pd(ss.p99, scs.p99)}%`);

  // ---- 列表路径（GET /studies?patientId=）单独测一遍 ----
  let listPathResult = null;
  try {
    const scopeSamples = async (empiId) => {
      const t0 = process.hrtime.bigint();
      await studies.probePatientScope(empiId, ATTACKER);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const lb = [];
    const lc = [];
    for (let i = 0; i < SAMPLES; i++) {
      lb.push(await scopeSamples(PATIENT_B));
      lc.push(await scopeSamples(PATIENT_C));
    }
    const lbs = stats(lb);
    const lcs = stats(lc);
    const lp99 = ((lbs.p99 - lcs.p99) / lcs.p99) * 100;
    console.log('');
    console.log('=== 列表路径 probePatientScope（GET /studies?patientId=），单位 ms ===');
    console.log(`  B 越权   p50=${lbs.p50.toFixed(3)} p99=${lbs.p99.toFixed(3)}`);
    console.log(`  C 不存在 p50=${lcs.p50.toFixed(3)} p99=${lcs.p99.toFixed(3)}`);
    console.log(`  p99 差异: ${lp99.toFixed(2)}%   判定: ${Math.abs(lp99) < 20 ? 'PASS' : 'FAIL'}`);
    listPathResult = { B: lbs, C: lcs, p99DiffPercent: Number(lp99.toFixed(4)) };
  } catch (err) {
    console.log('');
    console.log('=== 列表路径 probePatientScope（GET /studies?patientId=）===');
    console.log(`  !! 无法采样 —— 运行时报错：${err.code ?? ''} ${err.message}`);
    listPathResult = { error: `${err.code ?? ''} ${err.message}`.trim() };
  }

  await pool.end();

  const result = {
    samples: SAMPLES,
    warmup: WARMUP,
    total: { A: st, B: sbS, C: scS },
    probe: { B: ps, C: pcs },
    scope: { B: ss, C: scs },
    listPath: listPathResult,
    p99DiffPercent: Number(p99Diff.toFixed(4)),
    p50DiffPercent: Number(p50Diff.toFixed(4)),
    overlapRatio: Number(overlap.toFixed(6)),
    verdict: p99Abs < 20 ? 'PASS' : 'FAIL',
  };

  console.log('');
  console.log('=== JSON ===');
  console.log(JSON.stringify(result, null, 2));

  // 供多轮试验脚本聚合：写文件比解析 stdout 稳
  if (process.env.QA_JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.QA_JSON_OUT, JSON.stringify(result));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
