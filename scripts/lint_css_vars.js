#!/usr/bin/env node
/**
 * CSS 变量引用门禁。
 *
 * 背景：前端 CSS 里写 `var(--color-surface-app)` 时，如果这个变量
 * 在 design-tokens.css 里不存在，浏览器**不会报错**，只是静默回退到
 * 无样式 —— 表现为「颜色没生效」「间距不对」，极难定位。
 *
 * 实测：本次写 global.css 时误用了 --font-family-ui / --font-size-md /
 * --font-family-mono 三个不存在的名字（真实名是 --font-ui / --text-md /
 * --font-mono）。这类错误靠人眼几乎发现不了。
 *
 * 校验方式：
 *   1. 收集 design-tokens.css 定义的全部 CSS 变量
 *   2. 扫描项目 CSS/TSX 里所有 var(--xxx) 引用
 *   3. 引用了未定义的变量 -> 失败
 *   4. 反向：Token 定义了但从未被任何地方引用 -> 提示（不失败，避免噪音）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOKENS_CSS = path.join(ROOT, 'docs', 'design-tokens.css');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

assert(fs.existsSync(TOKENS_CSS), 'design-tokens.css 存在');
if (failures.length) {
  console.log('通过断言：' + passes.length);
  console.log('失败断言：' + failures.length);
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}

/* 1. 收集已定义的变量 */
const tokensCss = fs.readFileSync(TOKENS_CSS, 'utf8');
const defined = new Set();
const defRe = /(--[a-zA-Z0-9-]+)\s*:/g;
let m;
while ((m = defRe.exec(tokensCss)) !== null) defined.add(m[1]);

assert(defined.size > 100, `Token 变量 ${defined.size} 个（预期 100+）`);

/* 2. 扫描项目源码中的 var() 引用 */
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (['.css', '.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
})(path.join(ROOT, 'apps'));

const varRe = /var\(\s*(--[a-zA-Z0-9-]+)/g;
const undefinedRefs = [];
const used = new Set();
let refCount = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    // 跳过注释行
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    let vm;
    varRe.lastIndex = 0;
    while ((vm = varRe.exec(line)) !== null) {
      refCount += 1;
      const name = vm[1];
      used.add(name);
      if (!defined.has(name)) {
        undefinedRefs.push(`${rel}:${i + 1} ${name}`);
      }
    }
  });
}

assert(
  undefinedRefs.length === 0,
  `所有 var() 引用的变量均已定义（共 ${refCount} 处引用${undefinedRefs.length ? '，未定义：' + undefinedRefs.slice(0, 6).join(' | ') : ''}）`
);

/* 3. 反向检查：Token 中定义了但项目未使用的变量（仅提示） */
const unused = [...defined].filter((v) => !used.has(v));
console.log('提示：Token 中定义但当前未引用的变量 ' + unused.length + ' 个（正常，组件尚未实现）');

console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('CSS 变量引用自检全部通过。');
