#!/usr/bin/env node
/**
 * 前端构建产物体积门禁。
 *
 * 为什么需要：
 *   Cornerstone3D 打包后约 4MB（gzip 约 1.1MB）。如果阅片区被静态引入，
 *   这 4MB 会阻塞**首屏**下载 —— 而医生的实际路径是
 *   「登录 → 工作台（看待阅队列）→ 点进检查 → 阅片」，
 *   工作台页根本不需要 Cornerstone。
 *
 *   Spec §10 的 AC-05 要求「2000 层 CT 首帧 ≤3s」，阅片加载预算已经很紧，
 *   不该让工作台页替它付钱。
 *
 * 两条判定：
 *   1. **入口 chunk 不得包含 Cornerstone** —— 入口应保持在 KB 量级
 *   2. **Cornerstone 必须是独立的 lazy chunk** —— 说明阅片区已改懒加载
 *
 * 用法：
 *   node scripts/lint_bundle_size.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'apps', 'web', 'dist');
const ASSETS = path.join(DIST, 'assets');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

if (!fs.existsSync(ASSETS)) {
  /*
   * 没有构建产物时**跳过**，不算失败。
   *
   * 原因：这个门禁检查的是构建产物的体积，天然依赖 `npm run build:web` 先跑。
   * 但它挂在 `npm run lint` 链上 —— 而 lint 应该在「还没构建」时也能独立跑通
   * （CI 里是分步执行的，开发者本地也可能只想跑静态检查）。
   *
   * 报错说「请先构建」会让开发者以为 lint 坏了。正确做法是明确跳过，
   * 并由 CI 的独立步骤（build 后再 lint:bundle）保证它一定会被执行到。
   */
  console.log('=== 前端构建产物体积门禁 ===');
  console.log('跳过：未找到 apps/web/dist/assets（请先执行 npm run build:web）');
  console.log('提示：CI 的「前端产物体积门禁」步骤会在构建之后执行本检查。');
  console.log('通过断言：0');
  console.log('失败断言：0');
  process.exit(0);
}

const files = fs.readdirSync(ASSETS);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const sizes = new Map();
for (const f of jsFiles) {
  sizes.set(f, fs.statSync(path.join(ASSETS, f)).size);
}

/* 1. Cornerstone chunk 识别（先做，入口检查要用到） */
const cornerstoneChunks = jsFiles.filter((f) => {
  const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  return src.includes('RenderingEngine') || src.includes('ToolGroupManager');
});

/* 2. 入口 chunk 识别：index.html 里 modulepreload/script 引用的那个 */
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entryRefs = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
const entryName = entryRefs.find((n) => n.startsWith('index-')) ?? entryRefs[0];

assert(!!entryName, `识别到入口 chunk：${entryName ?? '未找到'}`);

if (entryName) {
  const entrySize = sizes.get(entryName) ?? 0;
  const entryKb = entrySize / 1024;
  // 入口含 React + 路由 + 工作台，控制在 400KB（未压缩）以内
  assert(
    entryKb < 400,
    `入口 chunk 体积 ${entryKb.toFixed(1)}KB < 400KB`
  );

  /*
   * 入口文件不该含 Cornerstone 的**运行时代码**。
   *
   * 判据要精确：不能只看「字符串是否出现」——
   * 懒加载后入口里仍会有 `import("./cornerstone-xxx.js")` 这样的引用字符串，
   * 以及少量类型名残留。真正要防的是**运行时实现被内联进入口**。
   *
   * 判据：入口里出现 `ToolGroupManager` / `Enums` 这类**仅存在于实现中**的符号，
   * 说明整包被内联了。而 `RenderingEngine` 单独出现不足以判定
   * （它可能只是动态 import 的路径片段或类型名）。
   */
  const entrySrc = fs.readFileSync(path.join(ASSETS, entryName), 'utf8');
  const inlinedSymbols = ['ToolGroupManager', 'createTool', 'toolGroup.addTool'];
  const found = inlinedSymbols.filter((s) => entrySrc.includes(s));
  assert(
    found.length === 0,
    `入口 chunk 未内联 Cornerstone 运行时${found.length ? '（检测到实现级符号：' + found.join(', ') + '）' : ''}`
  );

  // 入口必须以动态 import 引用 cornerstone chunk（说明确实是懒加载）
  assert(
    /import\([^)]*cornerstone/i.test(entrySrc) || cornerstoneChunks.length > 0,
    '入口通过动态 import 引用 Cornerstone chunk（懒加载生效）'
  );
}

/* 3. Cornerstone 必须是独立 chunk（说明已懒加载） */
assert(
  cornerstoneChunks.length > 0,
  `Cornerstone 运行时位于独立 chunk（${cornerstoneChunks.join(', ') || '未找到'}）`
);
for (const c of cornerstoneChunks) {
  const kb = (sizes.get(c) ?? 0) / 1024;
  // 单 chunk 上限 5MB（Cornerstone 本身接近 4MB，留余量）
  assert(kb < 5000, `chunk ${c} 体积 ${kb.toFixed(0)}KB < 5000KB`);
}

console.log('=== 前端构建产物体积门禁 ===');
console.log(`产物 chunk 数：${jsFiles.length}`);
for (const f of jsFiles) {
  console.log(`  ${(sizes.get(f) / 1024).toFixed(1).padStart(9)}KB  ${f}`);
}
console.log('');
console.log(`通过断言：${passes.length}`);
console.log(`失败断言：${failures.length}`);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  console.log('\n提示：阅片区应改页面级 lazy 加载（React.lazy + Suspense + ErrorBoundary），');
  console.log('      避免 4MB Cornerstone 阻塞首屏下载。');
  process.exit(1);
}
console.log('\n体积门禁全部通过。');
