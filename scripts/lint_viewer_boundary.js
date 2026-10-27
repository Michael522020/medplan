#!/usr/bin/env node
/**
 * 阅片区封装层边界门禁。
 *
 * 背景：Spec §10 锁定「组件禁止直连 Cornerstone 全局 API，
 * 必须经 features/viewer/core/ 封装层」。这条约束如果只写在文档里，
 * 三个月后必然有人为了「就改一行」直接 import Cornerstone。
 *
 * 三条规则：
 *   1. `@cornerstonejs/*` 只能出现在 apps/web/src/features/viewer/core/ 下。
 *   2. Cornerstone 的 `setPreferSizeOverAccuracy` 不允许出现在 core/ 之外
 *      —— 该开关写死为 true（Spec §10 强制 Int16）。
 *   3. 阅片区以外的文件不得引用 Cornerstone 的类型。
 *
 * 与 lint_icons.js 同构：扫描源码文本，命中即失败。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');
const CORE_DIR = path.join(WEB_SRC, 'features', 'viewer', 'core');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

assert(fs.existsSync(WEB_SRC), 'apps/web/src 存在');
assert(fs.existsSync(CORE_DIR), 'apps/web/src/features/viewer/core 存在');

if (failures.length) {
  console.log('通过断言：' + passes.length);
  console.log('失败断言：' + failures.length);
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}

const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (SRC_EXT.has(path.extname(entry.name))) files.push(full);
  }
})(WEB_SRC);

const CORE_IMPORT_RE = /from\s+['"]@cornerstonejs\/[^'"]+['"]/g;
const SET_PREFER_RE = /\bsetPreferSizeOverAccuracy\b/g;

const outsideImports = [];
const outsideSetPrefer = [];
let coreImportCount = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const isCore = file.startsWith(CORE_DIR + path.sep);

  // 去掉注释，避免把说明文字里的包名当成真实引用
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  CORE_IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = CORE_IMPORT_RE.exec(stripped)) !== null) {
    if (isCore) {
      coreImportCount += 1;
    } else {
      outsideImports.push(`${rel} -> ${match[0]}`);
    }
  }

  if (!isCore) {
    SET_PREFER_RE.lastIndex = 0;
    while ((match = SET_PREFER_RE.exec(stripped)) !== null) {
      outsideSetPrefer.push(`${rel} -> ${match[0]}`);
    }
  }
}

assert(
  coreImportCount > 0,
  `阅片区封装层内部确有 Cornerstone 引用（${coreImportCount} 处）`
);
assert(
  outsideImports.length === 0,
  `core/ 之外无 Cornerstone 直连` +
    (outsideImports.length ? `：${outsideImports.slice(0, 5).join(' | ')}` : '')
);
assert(
  outsideSetPrefer.length === 0,
  `core/ 之外未调用 setPreferSizeOverAccuracy` +
    (outsideSetPrefer.length ? `：${outsideSetPrefer.slice(0, 5).join(' | ')}` : '')
);

// 核心层必须真的强制了 preferSizeOverAccuracy
const viewportManager = fs.readFileSync(
  path.join(CORE_DIR, 'viewport-manager.ts'),
  'utf8'
);
assert(
  /preferSizeOverAccuracy:\s*true/.test(viewportManager),
  'viewport-manager 初始化时写死 preferSizeOverAccuracy: true'
);
assert(
  /setPreferSizeOverAccuracy\(true\)/.test(viewportManager),
  'viewport-manager 初始化后再次确认 setPreferSizeOverAccuracy(true)'
);

console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('阅片区封装层边界自检全部通过。');
