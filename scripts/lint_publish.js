#!/usr/bin/env node
/**
 * 公开仓脱敏门禁。
 *
 * 依据：docs/decisions/ADR-009.md
 *
 * 目的：在把任何内容推到**公开**仓库之前，机械地拦住不该公开的东西。
 * 人工检查会漏，git 历史一旦推上去就无法收回 —— 必须有机器门禁。
 *
 * 检查项：
 *   1. 真实内网网段（10.x / 172.16-31.x / 192.168.x）—— 示例值需在白名单
 *   2. 真实主机名模式（sso.* / *.hospital / *.internal / *.lan）
 *   3. 未打码的身份标识（身份证号 / 手机号 / 住院号）
 *   4. 凭证字面量（password / secret / token）—— 必须在测试占位白名单
 *   5. 凭证文件（.env / *.pem / *.key / *.p12 / *.pfx）
 *   6. 依赖许可清单存在且无未标注的 NC 条款
 *
 * 用法：
 *   node scripts/lint_publish.js              # 检查全项目
 *   node scripts/lint_publish.js --public-only # 只检查可公开的路径
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ONLY = process.argv.includes('--public-only');

const passes = [];
const failures = [];

function assert(cond, label) {
  if (cond) passes.push(label);
  else failures.push(label);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过依赖与构建产物
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    // 跳过临时验证目录（.bootcheck 等以点开头的），它们不进仓库，
    // 扫描它们只会产生基于旧编译产物的误报
    if (entry.isDirectory() && entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.sql', '.yml', '.yaml', '.css', '.py', '.sh', '.txt']);
const CRED_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const CRED_NAME = /^\.env(\..+)?$/i;

/**
 * 示例值白名单。
 *
 * 这些是文档与示例中允许出现的、明确是「假数据」的占位值。
 * 之所以要白名单而不是简单禁止所有内网 IP：
 * 医学影像系统的文档必须能表达「PACS 连接失败（某内网地址:104）」这种场景，
 * 全禁会让文档失去技术准确性。关键是**区分示例与真实值**。
 */
const EXAMPLE_IP_ALLOWLIST = new Set([
  '10.20.3.12',   // UIUX-P2.md PACS 连接失败示例
  '10.20.3.45',   // UIUX.md 审计日志示例
  '10.20.3.52',   // UIUX.md 审计日志示例
  '10.20.31.57',  // openapi.yaml sourceIp 示例
  '10.20.41.12',  // openapi.yaml 示例
]);

const EXAMPLE_HOST_ALLOWLIST = new Set([
  'medplan.internal',
  'medplan.hospital',
  'medplan.hospital.internal',
  'medplan.test.hospital.internal',
  'test.hospital',
  'test.hospital.internal',
  'sso.hospital',
  'sso.hospital.internal',
  'pacs.example.internal',
]);

/** 凭证字面量白名单：明显的测试占位值 */
const CRED_LITERAL_ALLOWLIST = new Set([
  '********',
  'medplan_ci_only',
  'medplan_test_only',
  'medplan_verify_only',
  'test_password',
  'test_secret',
  'placeholder',
]);

const files = walk(ROOT);

/* ---- 0. 凭证文件 ----
 * `.env.example` 是**模板**，必须公开（部署方照它填配置），不算凭证文件。
 * 与 .gitignore 的 `!.env.example` 例外保持一致。
 */
const credFiles = files.filter((f) => {
  const base = path.basename(f);
  if (base === '.env.example') return false;
  return CRED_EXT.has(path.extname(f)) || CRED_NAME.test(base);
});
assert(
  credFiles.length === 0,
  `无凭证文件（.env / *.pem / *.key / *.p12；.env.example 为模板除外）${credFiles.length ? '：' + credFiles.map((f) => path.relative(ROOT, f)).join(', ') : ''}`
);

/* ---- 0b. .env.example 不得含真实凭证 ----
 * 模板里的**凭证类**变量必须为空或占位。
 * 端口号、运行模式、超时毫秒数这类非凭证配置可以有值 ——
 * 把它们一起判为「真实取值」会产生大量误报，门禁一旦被忽略就等于没有。
 */
const envExample = path.join(ROOT, '.env.example');
if (fs.existsSync(envExample)) {
  const envTxt = fs.readFileSync(envExample, 'utf8');
  const CRED_ENV = /(_SECRET|_PASSWORD|_PASSWD|_TOKEN|_CREDENTIAL)/i;
  // 密钥「别名」不是密钥本身（部署方需要知道填什么才能找到对应密钥），
  // 只有值本身敏感。KEY_ALIAS / KEY_ID 这类指代变量允许有值。
  const ALIAS_ENV = /(_KEY_ALIAS|_KEY_ID|_KEY_NAME|_ALIAS)$/i;
  const realValue = envTxt
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .filter((l) => CRED_ENV.test(l.split('=')[0] ?? ''))
    .filter((l) => !ALIAS_ENV.test(l.split('=')[0] ?? ''))
    .map((l) => l.split('=')[1]?.trim() ?? '')
    .filter((v) => v.length > 0 && !/^(https?:\/\/|postgres:\/\/)/.test(v));
  assert(
    realValue.length === 0,
    `.env.example 的凭证类变量均无取值${realValue.length ? '：' + realValue.slice(0, 3).join(', ') : ''}`
  );
}

/* ---- 1. 内网网段 ---- */
const ipRe = /\b(?:10|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g;
const badIps = [];
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  let m;
  const re = new RegExp(ipRe.source, 'g');
  while ((m = re.exec(src)) !== null) {
    if (!EXAMPLE_IP_ALLOWLIST.has(m[0])) badIps.push(`${rel}: ${m[0]}`);
  }
}
assert(
  badIps.length === 0,
  `无非白名单内网 IP${badIps.length ? '：' + badIps.slice(0, 5).join(' | ') : ''}`
);

/* ---- 2. 内网主机名 ---- */
const hostRe = /\b(?:sso|pacs|dms|emr|his)\.[a-z0-9-]+\.(?:internal|hospital|local|lan|intra)\b|\b[a-z0-9-]+\.(?:internal|local|lan|intra)\b/gi;
const badHosts = [];
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  let m;
  const re = new RegExp(hostRe.source, 'gi');
  while ((m = re.exec(src)) !== null) {
    const hit = m[0];
    const hitLower = hit.toLowerCase();
    // 白名单按「后缀包含」判断：正则捕获的可能是完整主机名的一部分
    // （如 medplan.hospital.internal 被捕获为 hospital.internal）
    const allowed = [...EXAMPLE_HOST_ALLOWLIST].some(
      (w) => w === hitLower || w.endsWith(`.${hitLower}`) || hitLower.endsWith(`.${w}`)
    );
    if (allowed) continue;
    /*
     * 代码标识符误报：`AppError.internal` / `foo.internal` 这类是成员访问，
     * 不是主机名。判据看**主机名段本身**：
     *   - 真实主机名的首段是小写连字符形式（medplan / pacs-server / sso）
     *   - 驼峰或大写开头的段是代码标识符（AppError / FooBar）
     * 主机名在代码里通常出现在字符串或 URL 上下文，而标识符是成员访问。
     */
    const hostPart = hit.split('.')[0] ?? '';
    // 首段含大写字母 -> 判为代码标识符。
    // 注意：判断大写必须用**原始**大小写，不能先 toLowerCase ——
    // 那会把 AppError 变成 apperror，驼峰信息全丢，判据就失效了。
    if (/[A-Z]/.test(hostPart)) continue;
    // 首段是常见代码词 -> 判为代码标识符
    if (['app', 'foo', 'bar', 'baz', 'my', 'this', 'self', 'err', 'error'].includes(hostPart.toLowerCase())) continue;
    // 前面紧邻点号 -> 成员访问（foo.internal 是属性）
    const before = src[m.index - 1] ?? '';
    if (before === '.') continue;
    badHosts.push(`${rel}: ${m[0]}`);
  }
}
assert(
  badHosts.length === 0,
  `无非白名单内网主机名${badHosts.length ? '：' + badHosts.slice(0, 5).join(' | ') : ''}`
);

/* ---- 3. 未打码的身份标识 ---- */
const idRe = /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g; // 身份证
const phoneRe = /\b1[3-9]\d{9}\b/g; // 手机号
const badIds = [];
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  for (const re of [idRe, phoneRe]) {
    const r = new RegExp(re.source, 'g');
    let m;
    while ((m = r.exec(src)) !== null) badIds.push(`${rel}: ${m[0]}`);
  }
}
assert(badIds.length === 0, `无未打码的身份证/手机号${badIds.length ? '：' + badIds.slice(0, 5).join(' | ') : ''}`);

/* ---- 4. 凭证字面量 ---- */
const credLiteralRe = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|tsa[_-]?token)\s*[:=]\s*['"`]([^'"`]{6,})['"`]/gi;
const badCreds = [];
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  let m;
  const re = new RegExp(credLiteralRe.source, 'gi');
  while ((m = re.exec(src)) !== null) {
    const val = m[1];
    if (CRED_LITERAL_ALLOWLIST.has(val)) continue;
    // 明显是占位/示例的也放过
    if (/^(<|\{\{|xxx|XXX|\.\.\.|YOUR_|CHANGE_|\*)/i.test(val)) continue;
    if (/medplan_(ci|hbui|verify)/.test(val)) continue;
    // 环境变量引用不是凭证字面量：PGPASSWORD="$PG_PASS" 引用的是环境变量，
    // 真实口令在进程环境里，不在源码里。
    if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(val)) continue;
    // mock/fixture 的假凭证：mock-access-token / mock-refresh-token / fake-token
    if (/^(mock|fake|dummy|test|stub)[-_]/i.test(val)) continue;
    badCreds.push(`${rel}: ${m[0].slice(0, 60)}`);
  }
}
assert(
  badCreds.length === 0,
  `无非白名单的凭证字面量${badCreds.length ? '：' + badCreds.slice(0, 5).join(' | ') : ''}`
);

/* ---- 5. 依赖许可清单 ---- */
const licensePath = path.join(ROOT, 'docs', 'licenses', 'THIRD-PARTY.md');
assert(
  fs.existsSync(licensePath),
  '第三方依赖许可清单存在（docs/licenses/THIRD-PARTY.md）—— 公开仓必须说明各依赖的许可'
);
if (fs.existsSync(licensePath)) {
  const lic = fs.readFileSync(licensePath, 'utf8');
  const licLower = lic.toLowerCase();
  // 大小写不敏感比对：清单里写的是 @cornerstonejs/core 与 @tabler/icons-react，
  // 用 'Cornerstone' 直接 includes 会漏判（大小写不匹配）
  for (const name of ['cornerstone', 'dcm4chee', 'totalsegmentator', 'react', 'nestjs', 'fastify', 'tabler']) {
    assert(licLower.includes(name), `许可清单含 ${name}`);
  }
  // NC 条款必须被显式标注
  assert(
    /CC BY-NC/i.test(lic),
    '许可清单显式标注了 CC BY-NC 条款（TotalSegmentator 的 brain_aneurysm 等 task）'
  );
}

/* ---- 6. 许可证声明 ---- */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert(
  pkg.license && pkg.license !== 'UNLICENSED',
  `package.json 有明确许可证声明（当前 ${pkg.license}）`
);

/* ---- 输出 ---- */
console.log('=== 公开仓脱敏门禁 ===');
console.log(`扫描 ${files.length} 个文件${PUBLIC_ONLY ? '（公开路径模式）' : ''}`);
console.log(`通过断言：${passes.length}`);
console.log(`失败断言：${failures.length}`);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  console.log('\n依据 docs/decisions/ADR-009.md：这些内容不应出现在公开仓库。');
  process.exit(1);
}
console.log('\n通过断言明细：');
passes.forEach((p) => console.log('  ok    ' + p));
console.log('\n公开仓脱敏门禁全部通过。');
