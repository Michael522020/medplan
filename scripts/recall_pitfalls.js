#!/usr/bin/env node
/**
 * 按技术栈指纹召回已知坑。
 *
 * 机制（专家团 SOP「记忆系统增强」通道三）：
 *   1. 识别 —— 开发中遇到的报错归类为错误家族，生成稳定签名
 *   2. 记录 —— 落入 .workbuddy/memory/pitfalls.jsonl
 *   3. 触发 —— **开发开始时扫 package.json，只召回技术栈指纹有交集的坑**
 *   4. 验证 —— 避坑后真实运行通过，标记 validated:true；仍复发标记 recurring:true
 *
 * 关键设计：**按技术栈指纹匹配，不按需求文字匹配**。
 * 需求文字会变（「分割」「阅片」一直在），技术栈指纹才稳定。
 *
 * 用法：
 *   node scripts/recall_pitfalls.js            # 输出召回报告
 *   node scripts/recall_pitfalls.js --json     # 输出 JSON，便于注入 prompt
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PITFALLS = path.join(ROOT, '.workbuddy', 'memory', 'pitfalls.jsonl');
const AS_JSON = process.argv.includes('--json');

/** 收集工作区所有 package.json 的依赖名@版本，构成技术栈指纹集合 */
function collectStack() {
  const fingerprints = new Set();
  const pkgs = [
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'apps', 'web', 'package.json'),
    path.join(ROOT, 'apps', 'api', 'package.json'),
    path.join(ROOT, 'packages', 'contracts', 'package.json'),
    path.join(ROOT, 'packages', 'design-tokens', 'package.json'),
  ];
  for (const p of pkgs) {
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(j[field] || {})) {
        // 去掉 ^ ~ 等范围前缀，只留精确版本
        const clean = String(version).replace(/^[\^~>=<\s]+/, '');
        if (clean === '*' || clean === '' || clean.startsWith('workspace')) continue;
        fingerprints.add(`${name}@${clean}`);
      }
    }
  }
  // 运行时本身也是技术栈的一部分（node 版本直接决定包能否加载）
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const engines = rootPkg.engines || {};
  if (engines.node) fingerprints.add(`node@${engines.node}`);

  /**
   * 非 npm 依赖的技术栈。
   *
   * 这类依赖不在任何 package.json 里，但踩坑库里的数据库类坑
   * （分区默认权限缺失、GRANT/REVOKE 顺序颠倒、psql 建库连错库）
   * 指纹正是 postgresql@18 —— 只扫 package.json 会全部漏召回。
   *
   * 权威来源：docs/Spec.md §4 技术架构锁定表。这里读它而不是硬编码，
   * 避免版本升级后指纹失配。
   */
  const specPath = path.join(ROOT, 'docs', 'Spec.md');
  if (fs.existsSync(specPath)) {
    const specAll = fs.readFileSync(specPath, 'utf8');

    /**
     * 只取「## 4. 技术架构」这一节的内容。
     *
     * 必须限定章节 —— Spec 里还有「裁决记录」「已知坑」「变更记录」等表格，
     * 它们的列格式与 tech 栈表相同但内容是散文，
     * 全文扫描会解析出「postgresql@授权被随后的撤销抹掉.0.0」这种垃圾指纹。
     */
    const secMatch = specAll.match(/^##\s*4\.\s*技术架构[\s\S]*?(?=^##\s|\Z)/m);
    const spec = secMatch ? secMatch[0] : '';
    // 匹配 Spec 里的「| PostgreSQL | 18 | ... |」这类行，取出名称与版本
    /**
     * 逐行扫描 Spec 的技术架构表。
     * 行的格式不统一：
     *   | 业务库 | PostgreSQL | **18**（EOL 2030-11-14） | ... |
     *   | 缓存/队列 | Redis Stream | 8.10.2 | ... |
     *   | AI 框架 | nnunetv2 / PyTorch / MONAI | 2.8.1 / 2.5.x / 1.6.1 | ... |
     *
     * 名称列与版本列是**一一对应**的（用 / 分隔），因此按下标匹配。
     * 不能用「取第一个版本」的兜底 —— 那会让 PyTorch 拿到 MONAI 的版本号，
     * 产生错误指纹（如 pytorch@1.6.1），导致后续版本失配而漏召回。
     * 漏召回比多召回危险得多。
     */
    const MAP = [
      { needle: 'postgresql', fingerprint: 'postgresql' },
      { needle: 'redis', fingerprint: 'redis' },
      { needle: 'keycloak', fingerprint: 'keycloak' },
      { needle: 'dcm4chee-arc-light', fingerprint: 'dcm4chee-arc-light' },
      { needle: 'totalsegmentator', fingerprint: 'totalsegmentator' },
      { needle: 'nnunetv2', fingerprint: 'nnunetv2' },
      { needle: 'pytorch', fingerprint: 'pytorch' },
      { needle: 'monai', fingerprint: 'monai' },
    ];
    for (const line of spec.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 4) continue;
      const nameCell = cells[2] ?? '';
      const versionCell = cells[3] ?? '';
      // 版本列可能是 "**18**（EOL ...）" 或 "2.8.1 / 2.5.x / 1.6.1" 或 "8.10.2"
      // 必须按 '/' 分段而不是按数字匹配 —— 非精确版本（如 2.5.x）会导致
      // 数字正则漏掉该项，进而让后续名称的版本下标错位。
      const versionTokens = versionCell
        .replace(/\*\*/g, '')
        .split('/')
        .map((v) => v.trim())
        .filter(Boolean)
        // 去掉括号等尾注： "18（EOL 2030-11-14）" -> "18"
        .map((v) => v.replace(/[（(].*$/, '').trim())
        // 补全为三段版本号，让指纹格式统一： "18" -> "18.0.0"
        .map((v) => (v.split('.').length === 1 ? `${v}.0.0` : v));
      // 名称列用 / 分隔，与版本列一一对应
      const names = nameCell.split('/').map((s) => s.trim().toLowerCase());

      for (const { needle, fingerprint } of MAP) {
        const idx = names.findIndex((n) => n.includes(needle));
        if (idx === -1) continue;
        // 下标越界说明该行名称与版本数量不匹配 —— 跳过而非猜，
        // 猜出来的错误指纹会导致后续漏召回。
        const version = versionTokens[idx];
        if (version) fingerprints.add(`${fingerprint}@${version}`);
      }
    }
  }

  return fingerprints;
}

/**
 * 指纹匹配。
 * 直接用完整 `name@version` 相等最准；但版本升级后旧坑的指纹会失配
 * （如 Cornerstone 5.13.1 -> 5.13.2），因此退化为**包名匹配**，
 * 保证版本升级不会让已记录的坑丢失。
 */
function matches(fingerprint, stack) {
  if (!fingerprint) return false;
  const pkgName = fingerprint.split('@')[0];
  for (const s of stack) {
    if (s === fingerprint) return { hit: true, exact: true, via: s };
    if (s.split('@')[0] === pkgName) return { hit: true, exact: false, via: s };
  }
  return { hit: false };
}

function main() {
  if (!fs.existsSync(PITFALLS)) {
    console.log('踩坑库不存在，跳过召回。');
    return;
  }

  const stack = collectStack();
  const lines = fs
    .readFileSync(PITFALLS, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim());

  const recalled = [];
  for (const line of lines) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const hits = [];
    for (const fp of d.stack_fingerprint || []) {
      const m = matches(fp, stack);
      if (m.hit) hits.push({ fingerprint: fp, ...m });
    }
    if (hits.length > 0) {
      recalled.push({
        signature: d.signature,
        family: d.family,
        root_cause: d.root_cause,
        fix: d.fix,
        validated: d.validated ?? false,
        recurring: d.recurring ?? false,
        hits,
      });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ stack: [...stack], recalled }, null, 2));
    return;
  }

  console.log('=== 已知坑召回（按技术栈指纹匹配）===');
  console.log(`技术栈指纹 ${stack.size} 项 | 踩坑库 ${lines.length} 条 | 命中 ${recalled.length} 条`);
  console.log('');

  if (recalled.length === 0) {
    console.log('无相关坑。');
    return;
  }

  // 未验证的坑排在前面：那是还没被机械证据确认的，最需要警惕
  recalled.sort((a, b) => {
    const av = a.validated ? 1 : 0;
    const bv = b.validated ? 1 : 0;
    if (av !== bv) return av - bv;
    return a.family.localeCompare(b.family);
  });

  for (const r of recalled) {
    const flag = r.recurring ? ' [复发! 需换策略]' : r.validated ? ' [已验证]' : ' [未验证]';
    console.log(`[${r.family}] ${r.signature}${flag}`);
    console.log(`  根因: ${r.root_cause}`);
    console.log(`  修法: ${r.fix}`);
    console.log(`  命中: ${r.hits.map((h) => h.fingerprint + (h.exact ? '' : '(包名匹配)')).join(', ')}`);
    console.log('');
  }

  const unverified = recalled.filter((r) => !r.validified).length;
  const recurring = recalled.filter((r) => r.recurring).length;
  console.log(
    `其中未验证 ${unverified} 条、复发 ${recurring} 条 —— 开发中优先防范这两类。`
  );
}

main();
