#!/usr/bin/env node
/**
 * Shell 脚本换行符门禁。
 *
 * 背景：Windows 上编辑的 .sh 文件带 CRLF，Linux 上 bash 会报
 *   "set: pipefail\r: invalid option name"
 *   "$'\r': command not found"
 *   "syntax error near unexpected token `$'do\r''"
 *
 * 这是**本地能过、CI 挂**的典型问题，也是最容易被误判为「CI 环境问题」的一类。
 * 本项目在 2026-10-27 实际踩到过：verify_db.sh 在容器里整体无法执行。
 *
 * 检查项：
 *   1. 所有 .sh 必须是 LF（无 CR）
 *   2. 所有 .sh 必须有 shebang（否则 `bash script.sh` 能跑，
 *      但 `./script.sh` 与 CI 里可能的直接执行会失败）
 *   3. 所有 .sh 必须以可执行权限存在（git mode 100755）
 *   4. .bat/.cmd 必须是 CRLF（Windows 批处理的相反要求）
 *
 * 用法：
 *   node scripts/lint_shell_scripts.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    if (entry.isDirectory() && entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const shellFiles = files.filter((f) => f.endsWith('.sh'));
const batFiles = files.filter((f) => /\.(bat|cmd)$/i.test(f));

assert(
  shellFiles.length > 0,
  `发现 ${shellFiles.length} 个 shell 脚本待检查`
);

/* 1. .sh 必须是 LF */
const crlfFiles = [];
const noShebang = [];
for (const f of shellFiles) {
  const buf = fs.readFileSync(f);
  const rel = path.relative(ROOT, f);
  let hasCr = false;
  for (const b of buf) {
    if (b === 0x0d) {
      hasCr = true;
      break;
    }
  }
  if (hasCr) crlfFiles.push(rel);

  const text = buf.toString('utf8');
  if (!text.startsWith('#!')) noShebang.push(rel);
}
assert(
  crlfFiles.length === 0,
  `所有 .sh 使用 LF 换行${crlfFiles.length ? '，以下文件含 CR：' + crlfFiles.join(', ') : ''}`
);
assert(
  noShebang.length === 0,
  `所有 .sh 有 shebang${noShebang.length ? '，缺失：' + noShebang.join(', ') : ''}`
);

/* 2. .bat/.cmd 必须是 CRLF */
const badBat = [];
for (const f of batFiles) {
  const buf = fs.readFileSync(f);
  const rel = path.relative(ROOT, f);
  const hasCr = buf.includes(0x0d);
  const hasLf = buf.includes(0x0a);
  if (!hasCr || !hasLf) badBat.push(rel);
}
assert(
  badBat.length === 0,
  `所有 .bat/.cmd 使用 CRLF 换行${badBat.length ? '，不符：' + badBat.join(', ') : ''}`
);

/* 3. git mode 检查：.sh 应为 100755（可执行） */
let mode = null;
try {
  mode = execSync('git ls-files --stage scripts', { cwd: ROOT, encoding: 'utf8' });
} catch {
  mode = null;
}
if (mode) {
  const nonExec = [];
  for (const line of mode.split('\n')) {
    const m = line.match(/^(\d+) [0-9a-f]+\s+\d+\s+(.+)$/);
    if (!m) continue;
    const [, gitMode, file] = m;
    if (file.endsWith('.sh') && gitMode !== '100755') nonExec.push(`${file} (${gitMode})`);
  }
  assert(
    nonExec.length === 0,
    `所有 .sh 在 git 中标记为可执行（100755）${nonExec.length ? '，不符：' + nonExec.join(', ') : ''}`
  );
}

/* 4. .gitattributes 必须声明 eol=lf */
const gaPath = path.join(ROOT, '.gitattributes');
if (fs.existsSync(gaPath)) {
  const ga = fs.readFileSync(gaPath, 'utf8');
  assert(/eol=lf/.test(ga), '.gitattributes 声明了 eol=lf');
  assert(/\*\.sh\s+text eol=lf/.test(ga), '.gitattributes 对 .sh 显式声明 text eol=lf');
} else {
  assert(false, '.gitattributes 存在（统一换行符策略）');
}

console.log('=== Shell 脚本换行符自检 ===');
console.log(`检查 ${shellFiles.length} 个 .sh / ${batFiles.length} 个 .bat`);
console.log(`通过断言：${passes.length}`);
console.log(`失败断言：${failures.length}`);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  console.log('\n修复：把文件转成 LF（Linux 工具链下用 dos2unix，Windows 下用编辑器或脚本）');
  process.exit(1);
}
passes.forEach((p) => console.log('  ok    ' + p));
console.log('\n换行符自检全部通过。');
