#!/usr/bin/env node
/**
 * README 结构自检。
 *
 * 背景（2026-10-27 实际踩到）：
 *   把「快速开始」章节从第七前移到第二后，后面所有章节的编号都要顺延。
 *   改完之后**没人检查有没有漏改的交叉引用** ——
 *   文档里「见第 X 章」这类引用一旦指向错位，内容就答非所问，
 *   而且**完全不影响任何构建与测试**，是最容易被漏掉的一类回归。
 *
 * 检查项：
 *   1. 章节编号连续（一、二、三... 不跳号不重号）
 *   2. 表格列数一致（每张表的表头与数据行列数相同）
 *   3. 代码块闭合（``` 成对）
 *   4. mermaid 图数量不为 0（架构图是这个仓库的主要表达方式）
 *   5. 相对链接指向的文件真实存在（避免死链）
 *   6. 关键章节存在（使用前必读 / 快速开始 / 契约门禁）
 *
 * 用法：node scripts/lint_readme_structure.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const README = path.join(ROOT, 'README.md');

const passes = [];
const failures = [];
function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

assert(fs.existsSync(README), 'README.md 存在');
if (!fs.existsSync(README)) {
  console.log('FAIL  README.md 存在');
  process.exit(1);
}

const text = fs.readFileSync(README, 'utf8');
const lines = text.split(/\r?\n/);

/* 1. 章节编号连续 */
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const sections = [];
lines.forEach((l, i) => {
  const m = l.match(/^##\s+([一二三四五六七八九十]+)、/);
  if (m) sections.push({ idx: CN.indexOf(m[1]), title: m[1], line: i + 1 });
});
assert(sections.length > 0, `解析到 ${sections.length} 个编号章节`);
{
  const seq = sections.map((s) => s.idx);
  const expected = seq.map((_, i) => i);
  assert(
    JSON.stringify(seq) === JSON.stringify(expected),
    `章节编号连续无跳号（实际 ${sections.map((s) => s.title).join('')}）`
  );
}

/* 2. 表格列数一致 + 3. 代码块闭合 */
let inCode = false;
let codeFenceCount = 0;
const tables = [];
let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (l.trim().startsWith('```')) {
    inCode = !inCode;
    codeFenceCount += 1;
    i += 1;
    continue;
  }
  if (
    !inCode &&
    l.trim().startsWith('|') &&
    i + 1 < lines.length &&
    /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())
  ) {
    const cols = l.split('|').length;
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      rows.push({ line: j + 1, cols: lines[j].split('|').length });
      j += 1;
    }
    tables.push({ headerLine: i + 1, cols, rows });
    i = j;
    continue;
  }
  i += 1;
}
assert(codeFenceCount % 2 === 0, `代码块成对闭合（共 ${codeFenceCount} 个围栏）`);
{
  const bad = [];
  for (const t of tables) {
    for (const r of t.rows) {
      if (r.cols !== t.cols) bad.push(`第 ${r.line} 行（表头在第 ${t.headerLine} 行）`);
    }
  }
  assert(
    bad.length === 0,
    `${tables.length} 个表格列数一致${bad.length ? '，异常：' + bad.slice(0, 3).join('、') : ''}`
  );
}

/* 4. mermaid 图不为 0 */
const mermaidCount = (text.match(/```mermaid/g) || []).length;
assert(mermaidCount >= 3, `含 ${mermaidCount} 张 mermaid 架构图（>=3）`);

/* 5. 相对链接指向的文件存在 */
{
  const broken = [];
  const linkRe = /\]\((?!https?:\/\/|#|mailto:)([^)#]+)(?:#[^)]*)?\)/g;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    const resolved = path.resolve(path.dirname(README), target);
    if (!fs.existsSync(resolved)) broken.push(target);
  }
  assert(
    broken.length === 0,
    `相对链接均指向存在的文件${broken.length ? '，死链：' + broken.slice(0, 5).join(', ') : ''}`
  );
}

/* 6. 关键章节存在 */
for (const key of ['使用前必读', '快速开始', '契约门禁']) {
  assert(text.includes(key), `含「${key}」章节`);
}

/* 7. 关键内容不被误删 */
assert(text.includes('npm run gen:types'), '快速开始包含 gen:types 步骤');
assert(text.includes('22.12.0'), '写明 Node 版本下限 22.12.0');
assert(
  text.includes('不是医疗器械') || text.includes('不可直接用于临床诊断'),
  '含「非医疗器械」免责声明'
);

console.log('=== README 结构自检 ===');
console.log(`章节 ${sections.length} 个 | 表格 ${tables.length} 个 | mermaid ${mermaidCount} 张`);
console.log(`通过断言：${passes.length}`);
console.log(`失败断言：${failures.length}`);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
passes.forEach((p) => console.log('  ok    ' + p));
console.log('\nREADME 结构自检全部通过。');
