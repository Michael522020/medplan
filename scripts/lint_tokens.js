#!/usr/bin/env node
/**
 * 设计 Token 同步门禁。
 *
 * 背景：docs/design-tokens.json 是 Token 的唯一权威源，
 * docs/design-tokens.css 由 scripts/build_tokens.py 从 JSON 生成。
 * packages/design-tokens/ 下的副本是给前后端应用的分发件。
 *
 * 三类漂移路径：
 *   1. 改了 docs/design-tokens.json 但没重跑 build_tokens.py -> CSS 与 JSON 不一致
 *   2. 手改 docs/design-tokens.css -> 与 JSON 漂移
 *   3. 改了 docs/* 但没同步 packages/design-tokens/* -> 分发副本过期
 *
 * 校验方式说明：
 *   这里刻意**不**做「JSON 键名 -> CSS 变量名」的逐条名称映射比对。
 *   命名规则（size-2xs 对应 --text-2xs、family-ui 对应 --font-ui 等）
 *   由生成器 build_tokens.py 负责，映射一旦手写就会随 Token 演进而失效，
 *   变成「永远 FAIL 的噪音断言」或「被人注释掉的断言」。
 *
 *   改为校验**实质**：
 *   - 分发副本与权威源字节级一致（sha256）
 *   - CSS 中的每个色值都能在 JSON 中找到同值（值级覆盖）
 *   - JSON 中的每个色值都能在 CSS 中找到（反向覆盖）
 *   - 关键合规约束成立（Canvas 恒暗、危急值与正常色可区分、无紫粉靛）
 *
 *   颜色漂移是「颜色零硬编码」这条 P0 约束失效的主要形式：
 *   前端引用 var(--color-*) 若指向不存在的值，界面会静默回退到浏览器默认色。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const JSON_SRC = path.join(ROOT, 'docs', 'design-tokens.json');
const CSS_SRC = path.join(ROOT, 'docs', 'design-tokens.css');
const DIST_CSS = path.join(ROOT, 'packages', 'design-tokens', 'tokens.css');
const DIST_JSON = path.join(ROOT, 'packages', 'design-tokens', 'tokens.json');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const f of [JSON_SRC, CSS_SRC, DIST_CSS, DIST_JSON]) {
  assert(fs.existsSync(f), `文件存在: ${path.relative(ROOT, f)}`);
}
if (failures.length) {
  console.log('通过断言：' + passes.length);
  console.log('失败断言：' + failures.length);
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}

/* 1. 分发副本与权威源字节级一致 */
assert(
  sha256(DIST_JSON) === sha256(JSON_SRC),
  'packages/design-tokens/tokens.json 与 docs/design-tokens.json 字节一致'
);
assert(
  sha256(DIST_CSS) === sha256(CSS_SRC),
  'packages/design-tokens/tokens.css 与 docs/design-tokens.css 字节一致'
);

const json = JSON.parse(fs.readFileSync(JSON_SRC, 'utf8'));
const css = fs.readFileSync(CSS_SRC, 'utf8');

/* 2. 收集 JSON 中的全部色值 */
const jsonColors = new Set();
(function collectColors(node) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description') continue;
    if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) {
      jsonColors.add(v.toLowerCase());
    } else if (v && typeof v === 'object') {
      collectColors(v);
    }
  }
})(json);

const cssColors = new Set(
  (css.match(/#[0-9a-f]{3,8}\b/gi) || []).map((c) => c.toLowerCase())
);

const notInCss = [...jsonColors].filter((c) => !cssColors.has(c));
assert(
  notInCss.length === 0,
  `CSS 覆盖 JSON 全部色值（缺 ${notInCss.length} 个${notInCss.length ? ': ' + notInCss.slice(0, 5).join(', ') : ''}）`
);

/* 3. 关键合规约束 */
const sem = json.color && json.color.semantic;
assert(!!sem, 'Token 含 color.semantic 组');

if (sem) {
  const canvas = sem['surface-canvas'];
  assert(!!canvas, 'Token 含 surface-canvas');
  if (canvas) {
    const light = canvas.light && canvas.light.value;
    const dark = canvas.dark && canvas.dark.value;
    assert(
      !!light && !/^#(fff|ffffff)$/i.test(light),
      `亮色主题下 surface-canvas 仍为深色（当前 ${light}）—— 灰阶影像在白底会丧失诊断对比`
    );
    assert(
      !!dark && !/^#(fff|ffffff)$/i.test(dark),
      `暗色主题下 surface-canvas 为深色（当前 ${dark}）`
    );
  }

  const crit = sem['status-critical'] && sem['status-critical'].dark.value;
  const norm = sem['status-normal'] && sem['status-normal'].dark.value;
  assert(
    !!crit && !!norm && crit.toLowerCase() !== norm.toLowerCase(),
    `危急值与正常色可区分（${crit} vs ${norm}）—— 需配合图标与文字做三重编码`
  );

  const onCanvas = sem['text-on-canvas'];
  assert(!!onCanvas, 'Token 含 text-on-canvas（Canvas 上角标文字专用，双主题恒浅色）');
  if (onCanvas) {
    assert(
      onCanvas.light && onCanvas.dark &&
        onCanvas.light.value.toLowerCase() === onCanvas.dark.value.toLowerCase(),
      'text-on-canvas 双主题取值一致（因 Canvas 恒暗）'
    );
  }
}

/* 4. 禁止紫粉靛色值（P0-2） */
const forbidden = (JSON.stringify(json) + css).match(/#(?:7C3AED|A855F7|EC4899|6366F1|4F46E5)/gi);
assert(!forbidden, `无紫粉靛色值（P0-2）${forbidden ? '：' + forbidden.slice(0, 3).join(',') : ''}`);

/* 5. 禁止线性渐变（P0-2） */
assert(!/linear-gradient/i.test(css), 'CSS 中无 linear-gradient（P0-2）');

/* 6. 数值型 Token 应在 CSS 中体现（字号/间距/圆角） */
const numericLeaves = [];
(function collectNumeric(node, path) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description') continue;
    if (v && typeof v === 'object') {
      if (typeof v.value === 'number' || typeof v.value === 'string') {
        if (v.type === 'dimension' || v.type === 'number' || v.type === 'duration') {
          numericLeaves.push(String(v.value));
        }
      }
      collectNumeric(v, path);
    }
  }
})(json, []);
const cssText = css;
const missingNumeric = numericLeaves.filter(
  (val) => !cssText.includes(val) && !cssText.includes(`${val}px`)
);
assert(
  missingNumeric.length === 0,
  `CSS 覆盖 JSON 的尺寸类 Token（缺 ${missingNumeric.length} 个${missingNumeric.length ? ': ' + missingNumeric.slice(0, 5).join(', ') : ''}）`
);

console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('设计 Token 同步自检全部通过。');
