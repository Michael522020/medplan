/**
 * Phase 4 QA —— 端到端 HTTP 验证（自包含：自行拉起真实 API 进程）
 *
 * 启动**真实的** NestJS API（apps/api/.qa-build/main.js），用本地 HS256 会话令牌
 * 打真实端点，记录 HTTP 状态码、Content-Length 与响应体原始字节。
 *
 * 三种场景：
 *   A  有权限的检查   -> 期望 200
 *   B  越权（无权限） -> 期望 404 + code 10004
 *   C  不存在的检查   -> 期望 404 + code 10004
 *
 * 判定：B 与 C 的 **Content-Length 必须字节级相同**，响应体必须逐字节相同。
 *
 * 用法：
 *   node scripts/qa_e2e_probe.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
// 用**生产代码**签发会话令牌 —— 自己复制一份签发逻辑会引入「副本与实现漂移」
// 的风险（本次实测正是靠生产函数才暴露了双重 base64 编码缺陷）。
import { signSessionToken } from '../apps/api/.qa-build/common/auth/jwt-verifier.js';

const BASE = 'http://127.0.0.1:3999';
const SECRET = Buffer.from(process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me', 'utf8');
const QA_USER = '11111111-1111-4111-8111-111111111111';
const DB_HOST = process.env.QA_PG_HOST ?? '127.0.0.1:15433';
/** 无 DB 级 search_path 设置的库 —— 复现「按 .env.example 部署」的现场 */
const DB_NAME_NOSCHEMA = process.env.QA_PG_DB_NOSCHEMA ?? 'medplan_noschema';
/** 已用 ALTER DATABASE ... SET search_path 修正过的库 —— 用于跑通其余验证 */
const DB_NAME_FIXED = process.env.QA_PG_DB_FIXED ?? 'medplan_qa';
const DB_USER = process.env.QA_PG_USER ?? 'postgres';
const DB_PASS = process.env.QA_PG_PASS ?? 'medplan_ci_only';

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** 用生产代码 signSessionToken 签发会话令牌 */
const { token } = signSessionToken(
  {
    sub: QA_USER,
    dept: 'RADIOLOGY',
    roles: ['image_physician'],
    ukeyCertSerial: 'QA-UK-SERIAL-0001',
    jti: 'qa-jti-0001',
    expiresInSeconds: 3600,
  },
  SECRET
);

/** 拉起 API 进程，等待就绪，返回子进程句柄 */
async function startApi(databaseUrl, extraEnv = {}) {
  const child = spawn(process.execPath, ['apps/api/.qa-build/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUDIT_DATABASE_URL: databaseUrl,
      PORT: '3999',
      NODE_ENV: 'development',
      NO_PROXY: '*',
      no_proxy: '*',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });
  child.exited = false;
  child.on('exit', (code) => {
    child.exited = true;
    child.exitCode = code;
  });

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (child.exited) {
      return { child, log, ready: false, exited: true };
    }
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.status > 0) {
        return { child, log, ready: true, exited: false };
      }
    } catch {
      /* 还没起来，继续等 */
    }
  }
  return { child, log, ready: false, exited: child.exited };
}

async function probe(path, label) {
  const started = process.hrtime.bigint();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    label,
    path,
    status: res.status,
    contentLengthHeader: res.headers.get('content-length'),
    actualByteLength: buf.length,
    body: buf.toString('utf8'),
    bodyBytes: buf,
    elapsedMs: elapsed,
  };
}

function show(r) {
  console.log(
    `  ${r.label.padEnd(24)} HTTP ${String(r.status).padEnd(4)} ` +
      `CL=${String(r.contentLengthHeader).padEnd(6)} 字节=${String(r.actualByteLength).padEnd(5)} ` +
      `body=${r.body.slice(0, 110)}`
  );
}

/** 场景一：DATABASE_URL 完全按 .env.example（无 schema 参数） */
async function testNoSchema() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║ 场景一：DATABASE_URL 按 .env.example 原样（无 schema 参数）      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const url = `postgres://${DB_USER}:${DB_PASS}@${DB_HOST}/${DB_NAME_NOSCHEMA}`;
  console.log(`  DATABASE_URL=${url}`);
  console.log('  （该库未做 ALTER DATABASE SET search_path —— 等价于按 .env.example 部署的现场）');
  const { child, log, ready } = await startApi(url);
  if (!ready) {
    console.log('  API 未就绪');
    console.log(log.split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
    child.kill();
    return { ok: false };
  }
  console.log('  API 已就绪，开始请求');
  let r;
  try {
    r = await probe('/api/v1/studies?page=1&limit=1', 'GET /studies');
  } catch (err) {
    console.log(`  请求异常: ${err.message}`);
  }
  if (r) show(r);
  console.log('');
  console.log('  --- 服务端日志中的数据库错误 ---');
  const errLines = log
    .split('\n')
    .filter((l) => /does not exist|42P01|42703|error:/i.test(l))
    .slice(0, 8);
  if (errLines.length === 0) console.log('    (无数据库错误)');
  else errLines.forEach((l) => console.log('    ' + l.slice(0, 200)));
  await sleep(500);
  child.kill('SIGKILL');
  await sleep(500);
  return { ok: true, log };
}

/** 场景二：加上 search_path 修正（options 方式），跑完整越权对比 */
async function testWithSearchPath() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║ 场景二：修正 search_path 后，跑完整越权不可区分性对比           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const url = `postgres://${DB_USER}:${DB_PASS}@${DB_HOST}/${DB_NAME_FIXED}`;
  console.log(`  DATABASE_URL=${url}`);
  console.log('  （该库已做 ALTER DATABASE medplan_qa SET search_path TO medplan, public）');
  const { child, log, ready } = await startApi(url);
  if (!ready) {
    console.log('  API 未就绪');
    console.log(log.split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
    child.kill();
    return;
  }
  console.log('  API 已就绪，开始请求');

  const results = [];
  for (const [path, label] of [
    ['/api/v1/studies/1.2.840.10008.5.1.4.1.1.2.9001/series', 'A 有权限检查'],
    ['/api/v1/studies/1.2.840.10008.5.1.4.1.1.2.9002/series', 'B 越权检查'],
    ['/api/v1/studies/1.2.840.10008.5.1.4.1.1.2.9999/series', 'C 不存在检查'],
    ['/api/v1/studies?patientId=EMPI0000000002', 'B 越权列表路径'],
    ['/api/v1/studies?patientId=EMPI0000000099', 'C 不存在列表路径'],
    ['/api/v1/studies?patientId=EMPI0000000001', 'A 有权限列表路径'],
    // P0-05 精确复现：query string 的 page/limit 必须是字符串可转数字
    ['/api/v1/studies?page=1&limit=20', 'P0-05 复现：带 page/limit'],
    ['/api/v1/audit-logs?page=1&limit=20', 'P0-05 复现：审计列表'],
  ]) {
    try {
      const r = await probe(path, label);
      results.push(r);
      show(r);
    } catch (err) {
      console.log(`  ${label.padEnd(24)} 请求失败: ${err.message}`);
    }
  }

  const b = results.find((r) => r.label === 'B 越权检查');
  const c = results.find((r) => r.label === 'C 不存在检查');
  const lb = results.find((r) => r.label === 'B 越权列表路径');
  const lc = results.find((r) => r.label === 'C 不存在列表路径');

  console.log('');
  console.log('  === 判定 ===');
  if (b && c) {
    const sameStatus = b.status === c.status;
    const sameLen = b.actualByteLength === c.actualByteLength;
    const sameBytes = b.bodyBytes.equals(c.bodyBytes);
    console.log(`  序列路径 B vs C：状态码相同=${sameStatus}  字节数相同=${sameLen} (${b.actualByteLength} vs ${c.actualByteLength})  响应体逐字节相同=${sameBytes}`);
    console.log(`    B body: ${b.body}`);
    console.log(`    C body: ${c.body}`);
    console.log(`  序列路径判定：${sameStatus && sameLen && sameBytes ? 'PASS（完全不可区分）' : 'FAIL'}`);
  }
  if (lb && lc) {
    const sameStatus = lb.status === lc.status;
    const sameLen = lb.actualByteLength === lc.actualByteLength;
    const sameBytes = lb.bodyBytes.equals(lc.bodyBytes);
    console.log(`  列表路径 B vs C：状态码相同=${sameStatus}  字节数相同=${sameLen} (${lb.actualByteLength} vs ${lc.actualByteLength})  响应体逐字节相同=${sameBytes}`);
    console.log(`    B body: ${lb.body}`);
    console.log(`    C body: ${lc.body}`);
    console.log(`  列表路径判定：${sameStatus && sameLen && sameBytes ? 'PASS（完全不可区分）' : 'FAIL'}`);
  }

  console.log('');
  console.log('  --- 服务端日志中的数据库错误 ---');
  const allLines = log.split('\n').filter((l) => l.trim().length > 0);
  const errLines = allLines
    .filter((l) => /does not exist|42P01|42703|error|severity|detail|stack|TypeError|QueryFailed/i.test(l))
    .slice(0, 14);
  if (errLines.length === 0) {
    console.log('    (未匹配到错误行，服务端日志末尾 12 行如下)');
    allLines.slice(-12).forEach((l) => console.log('    ' + l.slice(0, 260)));
  } else errLines.forEach((l) => console.log('    ' + l.slice(0, 260)));

  await sleep(300);
  child.kill('SIGKILL');
  await sleep(300);
}

await testNoSchema();
await testWithSearchPath();
