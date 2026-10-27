#!/usr/bin/env node
/**
 * 图标名存在性门禁。
 *
 * 背景：Tabler 有 6238 个图标，名字靠记忆一定会写错（实测本项目
 * 首次写出口文件时 51 个名字里错了 4 个：Move / Layers / Pen / Unlock）。
 * 设计师在 Phase 1 也做过同样的校验并自查出 4 个错误。
 *
 * 错误图标名的后果不是编译失败（可能写成 any 混过去），而是运行时
 * 图标渲染成空白 —— 在临床工具里，一个空白的「危急值」或「签名」按钮
 * 是安全隐患。
 *
 * 校验方式：
 *   从 node_modules/@tabler/icons-react/dist/tabler-icons-react.d.ts 提取
 *   全部 `declare const Icon<X>` 作为权威名集合，再扫描项目源码里
 *   从该包 import 的具名符号，逐一比对。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'node_modules', '@tabler', 'icons-react');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

/* 权威图标名集合
 *
 * 必须取**真实导出名**，不是 d.ts 里的声明名。
 * 实测踩坑：d.ts 里写 `declare const IconAlertTriangle`，但实际导出名是
 * `IconAlertTriangle`；若从 d.ts 正则取 `Icon(\w+)` 会得到 "AlertTriangle"
 * （去掉了 Icon 前缀），与真实导出名不符 —— 于是门禁「通过」但 tsc 报
 * "has no exported member named 'AlertTriangle'"。
 * 因此这里从 ESM 入口的 `as Icon<X>` 重新导出语句里取真实名。
 */
const ESM = path.join(PKG, 'dist', 'esm', 'tabler-icons-react.mjs');
assert(fs.existsSync(ESM), '@tabler/icons-react ESM 入口存在（取真实导出名的前提）');

const esm = fs.readFileSync(ESM, 'utf8');
const available = new Set();
const expRe = /as (Icon[A-Za-z0-9_]+)/g;
let em;
while ((em = expRe.exec(esm)) !== null) available.add(em[1]);

assert(available.size > 5000, `提取到 Tabler 真实导出名 ${available.size} 个（预期 5000+）`);

/* 扫描项目源码里从 @tabler/icons-react 的具名 import / re-export */
const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (SRC_EXT.has(path.extname(entry.name))) files.push(full);
  }
})(path.join(ROOT, 'apps'));

/* 两种形式都算具名导入：
 *   import { A, B } from '@tabler/icons-react'
 *   export { A, B } from '@tabler/icons-react'
 *
 * **类型再导出要排除**：
 *   export type { Icon, IconProps } from '@tabler/icons-react'
 * 这是给图标加类型标注的正确用法（IconProps 是 props 类型，Icon 是组件类型），
 * 两者都不是「图标名」，不该拿去和 6304 个图标名比对。
 *
 * 区分方式：import/export 后面是否有独立的 type 关键字。
 */
const importRe =
  /(?<![A-Za-z0-9_])(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@tabler\/icons-react['"]/g;
let checked = 0;
const badNames = [];
const foundFiles = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // 剥离行注释与块注释，避免把注释里的说明文字当成图标名
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let im;
  while ((im = importRe.exec(stripped)) !== null) {
    // type-only 导入/导出：整块跳过（导入的是类型不是组件）
    const isTypeOnly = Boolean(im[1]);
    foundFiles.push(path.relative(ROOT, file));
    const names = im[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    if (isTypeOnly) continue;
    for (const n of names) {
      checked += 1;
      if (!available.has(n)) badNames.push({ file: path.relative(ROOT, file), name: n });
    }
  }
}

assert(
  foundFiles.length > 0,
  `项目中存在从 @tabler/icons-react 的具名 import（已检查 ${foundFiles.length} 个文件）`
);
assert(
  badNames.length === 0,
  `所有导入的图标名真实存在（共校验 ${checked} 个${badNames.length ? '，错误：' + badNames.map((b) => `${b.file} -> ${b.name}`).join('; ') : ''}）`
);

/**
 * 禁止 emoji 作为功能图标（P0-1）。
 *
 * 区间必须精确。只保留**真正的 emoji 区块**：
 *   - U+1F300–U+1FAFF：主 emoji 区
 *   - U+2600–U+27BF：杂项符号与象形文字（含 ★ ☆ ✓ 等）
 *   - U+FE00–U+FE0F：变体选择符
 *   - U+200D：零宽连接符（emoji 组合序列）
 *   - U+20E3：组合用键帽
 *
 * **不要**包含 U+2190–U+21FF（箭头 ← → ↑ ↓）与 U+2B00–U+2BFF（几何图形）。
 * 箭头在中文技术文档里是正常表达（「任一为空 → 阻断签名」），
 * 把它们当 emoji 会让门禁产生大量误报，久而久之门禁会被忽略 ——
 * 那比没有门禁更危险。
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{20E3}]/u;
const emojiHits = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    // 跳过纯注释行：注释里的符号不是 UI 图标
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (EMOJI.test(line)) {
      const m = line.match(EMOJI);
      emojiHits.push(
        `${path.relative(ROOT, file)}:${i + 1} [${m[0]} U+${m[0].codePointAt(0).toString(16).toUpperCase()}] ${trimmed.slice(0, 70)}`
      );
    }
  });
}
assert(
  emojiHits.length === 0,
  `源码中无 emoji 作功能图标（P0-1）${emojiHits.length ? '：' + emojiHits.slice(0, 3).join(' | ') : ''}`
);

/* 禁止混用第二套图标库 */
const otherIconLibs = ['lucide-react', 'react-icons', '@heroicons/react', 'react-feather', 'antd'];
const mixed = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const lib of otherIconLibs) {
    if (src.includes(lib)) mixed.push(`${path.relative(ROOT, file)} -> ${lib}`);
  }
}
assert(
  mixed.length === 0,
  `未混用第二套图标库（P0-1）${mixed.length ? '：' + mixed.slice(0, 3).join(' | ') : ''}`
);

console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log(`图标自检全部通过（校验 ${checked} 个图标名）。`);
