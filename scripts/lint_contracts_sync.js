#!/usr/bin/env node
/**
 * 契约类型生成链路自检。
 *
 * 背景（2026-10-27 实测踩到）：
 *   外部贡献者 clone 后直接 `npm run typecheck`，报
 *     Cannot find module './generated/api-types'
 *   并连带出现一批 TS7006 隐式 any（类型缺失导致派生类型全部塌陷）。
 *
 * 根因：`packages/contracts/src/generated/` 被 .gitignore 排除
 * （契约类型必须与 openapi.yaml 严格同步，进了版本库就会有静默漂移），
 * 但**没有任何机制提醒「要先跑 gen:types」**。
 *
 * 本门禁守两件事：
 *   1. 生成目录确实被 gitignore（防漂移）
 *   2. README 的快速开始章节确实写了 gen:types 这一步（防新人卡住）
 *   3. gen:types 脚本确实存在且指向 openapi.yaml
 *
 * 用法：node scripts/lint_contracts_sync.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

/* 1. 生成目录被 gitignore */
const gitignorePath = path.join(ROOT, '.gitignore');
assert(fs.existsSync(gitignorePath), '.gitignore 存在');
if (fs.existsSync(gitignorePath)) {
  const gi = fs.readFileSync(gitignorePath, 'utf8');
  assert(
    /packages\/contracts\/src\/generated\//.test(gi),
    '生成目录 packages/contracts/src/generated/ 被 .gitignore 排除（防契约漂移）'
  );
  assert(
    !/^\s*package-lock\.json\s*$/m.test(gi),
    'package-lock.json 未被 gitignore（公开仓必须能复现依赖）'
  );
}

/* 2. 生成脚本存在且指向 openapi.yaml */
const pkgPath = path.join(ROOT, 'package.json');
assert(fs.existsSync(pkgPath), 'package.json 存在');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert(!!pkg.scripts?.['gen:types'], 'package.json 定义了 gen:types 脚本');
  assert(
    !!pkg.scripts?.['verify:types'],
    'package.json 定义了 verify:types 脚本'
  );
  // typecheck 必须包含 gen:types，否则新人跑 typecheck 会踩 TS2307
  assert(
    (pkg.scripts?.typecheck ?? '').includes('gen:types'),
    'typecheck 脚本包含 gen:types（保证单跑 typecheck 不会因缺生成物而失败）'
  );
}

/* 3. gen_types.js 指向 openapi.yaml */
const genPath = path.join(ROOT, 'scripts', 'gen_types.js');
assert(fs.existsSync(genPath), 'scripts/gen_types.js 存在');
if (fs.existsSync(genPath)) {
  const gen = fs.readFileSync(genPath, 'utf8');
  assert(
    gen.includes('openapi.yaml'),
    'gen_types.js 以 docs/openapi.yaml 为输入源'
  );
}

/* 4. README 快速开始写了 gen:types —— 这是本次踩坑的直接教训 */
const readmePath = path.join(ROOT, 'README.md');
assert(fs.existsSync(readmePath), 'README.md 存在');
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert(
    readme.includes('快速开始'),
    'README 含「快速开始」章节'
  );
  const quickStartIdx = readme.indexOf('快速开始');
  const lintIdx = readme.indexOf('契约门禁');
  const quickStartSection =
    quickStartIdx >= 0 ? readme.slice(quickStartIdx, lintIdx > quickStartIdx ? lintIdx : quickStartIdx + 4000) : '';
  assert(
    quickStartSection.includes('gen:types'),
    'README 快速开始章节明确写出 gen:types 这一步（防新人卡在 TS2307）'
  );
  assert(
    quickStartSection.includes('npm ci'),
    'README 快速开始章节包含依赖安装命令'
  );
  assert(
    /22\.(x|1[2-9])/.test(readme) && readme.includes('22.12.0'),
    'README 写明 Node 22 版本约束（>=22.12.0，<23）'
  );
}

/* 5. 契约类型确实从 openapi 生成 —— 抽查生成物存在时的结构 */
const generatedDir = path.join(ROOT, 'packages', 'contracts', 'src', 'generated');
if (fs.existsSync(generatedDir)) {
  const genFiles = fs.readdirSync(generatedDir);
  assert(genFiles.includes('api-types.ts'), '生成物 api-types.ts 已生成（若存在则应完整）');
} else {
  // 未生成是正常状态（未跑 gen:types），不算失败
  passes.push('生成物尚未生成（正常，npm run gen:types 后产生）');
}

console.log('=== 契约类型生成链路自检 ===');
console.log(`通过断言：${passes.length}`);
console.log(`失败断言：${failures.length}`);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  console.log('\n背景：外部贡献者 clone 后直接跑 typecheck 会报 TS2307 + 一片 TS7006，');
  console.log('      因为契约类型不入库、必须先跑 npm run gen:types。');
  process.exit(1);
}
passes.forEach((p) => console.log('  ok    ' + p));
console.log('\n契约生成链路自检全部通过。');
