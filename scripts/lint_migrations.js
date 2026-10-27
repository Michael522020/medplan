/**
 * MedPlan 迁移文件自检（CI 门禁）
 *
 * 三件事：
 *   1. 001_init.sql 自身的语法与规范合规性
 *   2. 001_init.sql 与 schema.sql 的**结构一致性**（防止两份文件漂移）
 *   3. 增量迁移规范（文件头10 条）的可执行检查
 *
 * 运行：node scripts/lint_migrations.js
 */
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'docs', 'db');
const MIG = path.join(DB, 'migrations');
const init = fs.readFileSync(path.join(MIG, '001_init.sql'), 'utf8');
const schema = fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8');

const failures = [];
const passes = [];
const assert = (c, m) => (c ? passes : failures).push(m);

const strip = (s) => s.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
const initCode = strip(init);
const schemaCode = strip(schema);

/**
 * 所有迁移的并集（按文件名排序 = 执行顺序）。
 *
 * 为什么不能只比 001：
 *   schema.sql 是**全量建库快照**（从零建库时直接跑它），
 *   而 001_init.sql + 002_xxx.sql 才是**增量路径**。
 *   两边最终状态必须一致 —— 否则「全量建库」与「增量升级」会得到不同的库。
 *
 *   之前这个门禁只读 001，新增 002 时就漏掉了它的索引与触发器，
 *   导致 schema 与迁移不一致无法被发现。
 */
const migFiles = fs
  .readdirSync(MIG)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const allMigCode = strip(
  migFiles.map((f) => fs.readFileSync(path.join(MIG, f), 'utf8')).join('\n')
);

/* ---------------------------------------------------------------- 1. 语法粗检 */
const OPEN = (s) => (s.match(/\(/g) || []).length;
const CLOSE = (s) => (s.match(/\)/g) || []).length;
assert(
  OPEN(initCode) === CLOSE(initCode),
  `括号配平（${OPEN(initCode)} / ${CLOSE(initCode)}）`
);
const DOLLAR_QUOTES = (initCode.match(/\$\$/g) || []).length;
assert(DOLLAR_QUOTES % 2 === 0, `$$ 块成对（${DOLLAR_QUOTES} 个标记）`);

const enumNames = [
  'visit_type', 'series_phase', 'study_status', 'report_status', 'plan_status',
  'segmentation_task_status', 'segmentation_pipeline_step',
  'segmentation_confirm_action', 'audit_event_type', 'audit_result',
  'grant_scope', 'role_code', 'retention_class',
];

/* 典型手误检测：类型名与关键字之间缺空格 */
const TYPED_KW = [
  'uuid', 'varchar', 'char', 'boolean', 'integer', 'numeric', 'text',
  'bigint', 'smallint', 'date', 'jsonb', 'bigserial', 'timestamptz',
];
for (const t of TYPED_KW) {
  const bad = new RegExp(`\\b${t}(NOT|NULL|PRIMARY|DEFAULT|REFERENCES|UNIQUE|CHECK|CONSTRAINT)\\b`, 'g');
  const hits = initCode.match(bad) || [];
  assert(hits.length === 0, `无「类型与关键字粘连」手误（如 ${t}NOT NULL）：${hits.length ? hits[0] : 'ok'}`);
}
// 枚举名与关键字粘连检测（如 role_codeNOT NULL）
// 注意：检测的是「缺空格」，不是「有空格」
for (const e of enumNames) {
  const glued = new RegExp(`\\b${e}(NOT|NULL|PRIMARY|DEFAULT|REFERENCES|UNIQUE|CHECK)\\b`, 'g');
  const hits = initCode.match(glued) || [];
  assert(
    hits.length === 0,
    `枚举 ${e} 与关键字无粘连手误：${hits.length ? '发现 ' + hits.length + ' 处 ' + hits[0] : 'ok'}`
  );
}

/* ---------------------------------------------------------------- 2. 迁移规范 */
assert(/^-- 001_init\.sql/m.test(init), '文件名规范：001_init.sql');
assert(/\bBEGIN\s*;/.test(initCode), '规范 5：迁移包在事务中（BEGIN）');
assert(/\bCOMMIT\s*;/.test(initCode), '规范 5：迁移以 COMMIT 收尾');
assert(
  !/^\s*DROP\s+(TABLE|COLUMN|TYPE)/im.test(initCode),
  '规范 4：无破坏性 DROP（迁移不得靠 DROP 让重复执行"总是能跑"）'
);
assert(
  /CREATE EXTENSION IF NOT EXISTS/.test(initCode),
  '规范 4：可重复对象用 IF NOT EXISTS'
);
assert(
  /CREATE TABLE IF NOT EXISTS schema_migrations/.test(initCode),
  '规范 9：存在迁移记录表'
);
assert(
  /checksum\s+char\(64\)/.test(initCode),
  '规范 9：迁移记录含 checksum（SM3 摘要，防篡改迁移历史）'
);
assert(
  /不可逆|不提供 DOWN/.test(init),
  '规范 1：文件头声明单向前进、不可逆'
);
assert(
  /expand-and-contract|只加不改/.test(init),
  '规范 6：文件头声明只加不改（expand-and-contract）'
);
assert(
  /禁止用DROP|CREATE INDEX CONCURRENTLY/.test(init),
  '规范 4/5：文件头说明并发建索引的例外'
);
assert(
  /ON CONFLICT \(version\) DO NOTHING/.test(initCode),
  '规范 4：迁移记录写入幂等（重复执行不报错也不覆盖）'
);

/* ---------------------------------------------------------------- 3. 枚举定义一致 */
for (const e of enumNames) {
  const s = new RegExp(`CREATE TYPE ${e} AS ENUM\\s*\\(([\\s\\S]*?)\\);`).exec(schemaCode);
  const i = new RegExp(`CREATE TYPE ${e} AS ENUM\\s*\\(([\\s\\S]*?)\\);`).exec(initCode);
  assert(!!s && !!i, `枚举在两文件中均定义：${e}`);
  if (s && i) {
    const norm = (x) =>
      x[1]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
        .sort()
        .join(',');
    assert(
      norm(s) === norm(i),
      `枚举取值一致：${e}${norm(s) === norm(i) ? '' : `（schema=${norm(s)} vs migration=${norm(i)}）`}`
    );
  }
}

/* ---------------------------------------------------------------- 4. 表结构一致 */
function colsOf(code, table) {
  const re = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\n\\)\\s*(?:PARTITION BY[^;]*)?;`
  );
  const m = code.match(re);
  if (!m) return null;
  const parts = [];
  let depth = 0, buf = '';
  for (const ch of m[1]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  parts.push(buf);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ name: (p.match(/^(\w+)/) || [])[1], def: p }))
    .filter((c) => c.name && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(c.name));
}

const TABLES = [
  'users', 'roles', 'user_roles', 'patients', 'visits', 'patient_grants',
  'studies', 'series', 'instances',
  'segmentation_tasks', 'segmentations', 'segmentation_confirms',
  'plans', 'plan_commands', 'reports', 'report_revisions',
  'signature_logs', 'audit_logs',
];
for (const t of TABLES) {
  const a = colsOf(schemaCode, t);
  const b = colsOf(initCode, t);
  assert(!!a && !!b, `表在两文件中均定义：${t}`);
  if (!a || !b) continue;
  const an = a.map((c) => c.name).filter(Boolean).sort();
  const bn = b.map((c) => c.name).filter(Boolean).sort();
  const onlySchema = an.filter((x) => !bn.includes(x));
  const onlyMig = bn.filter((x) => !an.includes(x));
  assert(
    onlySchema.length === 0 && onlyMig.length === 0,
    `列一致：${t}${onlySchema.length || onlyMig.length ? `（schema 多:${onlySchema} / migration 多:${onlyMig}）` : ''}`
  );
  // 类型一致性
  for (const c of a) {
    const other = b.find((x) => x.name === c.name);
    if (!other) continue;
    const norm = (d) =>
      d.replace(/--.*$/, '')
        .replace(/\s+/g, ' ')
        .replace(/DEFAULT\s+now\(\)/i, 'DEFAULT now()')
        .replace(/\s*NOT\s+NULL/i, ' NOT NULL')
        .trim();
    if (norm(c.def) !== norm(other.def)) {
      // 允许的差异：列注释行、约束命名
      const stripDefault = (d) => norm(d).replace(/DEFAULT\s+'[^']*'/g, "DEFAULT ''");
      if (stripDefault(c.def) !== stripDefault(other.def)) {
        failures.push(
          `列定义漂移：${t}.${c.name}\n      schema.sql    : ${norm(c.def)}\n      001_init.sql  : ${norm(other.def)}`
        );
      }
    }
  }
  passes.push(`列定义一致：${t}`);
}

/* ---------------------------------------------------------------- 5. 索引一致 */
function indexesOf(code) {
  const out = new Set();
  // 必须跳过 `IF NOT EXISTS`：
  //   CREATE INDEX IF NOT EXISTS idx_foo ON ...
  // 若不跳过，正则会把 `IF` 当成索引名，比对时就会出现
  // 「migration 多: IF」这种无意义差异。
  const re = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = re.exec(code))) out.add(m[2]);
  return out;
}
const si = indexesOf(schemaCode);
const ii = indexesOf(allMigCode);
const idxOnlySchema = [...si].filter((x) => !ii.has(x));
const idxOnlyMig = [...ii].filter((x) => !si.has(x));
assert(
  idxOnlySchema.length === 0 && idxOnlyMig.length === 0,
  `索引集合一致（共 ${si.size} 个）${
    idxOnlySchema.length || idxOnlyMig.length
      ? `（schema 多:${idxOnlySchema} / migration 多:${idxOnlyMig}）`
      : ''
  }`
);

/* ---------------------------------------------------------------- 6. 触发器一致 */
function triggersOf(code) {
  const out = new Set();
  const re = /CREATE\s+TRIGGER\s+(\w+)/gi;
  let m;
  while ((m = re.exec(code))) out.add(m[1]);
  return out;
}
const st = triggersOf(schemaCode);
const it = triggersOf(allMigCode);
const trgOnlySchema = [...st].filter((x) => !it.has(x));
assert(trgOnlySchema.length === 0, `触发器均在迁移中落地（schema 有 ${st.size} 个）${trgOnlySchema.length ? '缺:' + trgOnlySchema : ''}`);

/* ---------------------------------------------------------------- 7. 函数一致 */
function funcsOf(code) {
  const out = new Set();
  const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)/gi;
  let m;
  while ((m = re.exec(code))) out.add(m[1]);
  return out;
}
const sf = funcsOf(schemaCode);
const ifn = funcsOf(allMigCode);
const fnOnlySchema = [...sf].filter((x) => !ifn.has(x));
assert(
  fnOnlySchema.length === 0,
  `函数均在迁移中落地（schema 有 ${sf.size} 个）${fnOnlySchema.length ? '缺:' + fnOnlySchema : ''}`
);

/* ---------------------------------------------------------------- 8. 安全约束在迁移中同样生效 */
assert(
  /REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw/.test(initCode),
  'audit_logs 不可改：迁移中同样REVOKE（不是只在参考快照里写）'
);
assert(
  /REVOKE UPDATE, DELETE, TRUNCATE ON signature_logs FROM app_rw/.test(initCode),
  'signature_logs 不可改：迁移中同样 REVOKE'
);
assert(
  /REVOKE ALL ON patients, visits, reports[\s\S]*?FROM ai_worker/.test(initCode),
  'ai_worker 无 PHI 表权限：迁移中同样 REVOKE'
);
assert(
  /CREATE TRIGGER trg_audit_logs_no_truncate[\s\S]*?BEFORE TRUNCATE ON audit_logs/.test(initCode),
  'audit_logs TRUNCATE 阻断触发器在迁移中'
);
assert(
  /audit_logs_default PARTITION OF audit_logs DEFAULT/.test(initCode),
  'audit_logs DEFAULT 兜底分区在迁移中'
);
assert(
  /ck_seg_task_model_version CHECK \(model_version = '2\.18\.0'\)/.test(initCode),
  '模型版本锁在迁移中'
);
assert(
  /ck_signature_title CHECK/.test(initCode),
  '签名人职称 CHECK 在迁移中'
);

/* ---------------------------------------------------------------- 9. 角色一致 */
for (const r of ['app_ro', 'app_rw', 'app_audit', 'ai_worker', 'migrator']) {
  assert(
    new RegExp(`rolname = '${r}'`).test(initCode),
    `角色 ${r} 在迁移中幂等创建（DO $$ + IF NOT EXISTS）`
  );
}

/* ---------------------------------------------------------------- 10. 无 emoji */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
assert(!EMOJI.test(init), '001_init.sql 无 emoji');
assert(!EMOJI.test(schema), 'schema.sql 无 emoji');

/* ---------------------------------------------------------------- 11. 部署自检清单 */
for (const k of ['表数量', '审计表物理不可改', '签名日志不可改', '审计链', '卫健委字段全覆盖', 'ai_worker']) {
  assert(init.includes(k), `部署后自检清单含：${k}`);
}

/* ---------------------------------------------------------------- 12. 迁移清单登记 */
assert(migFiles.includes('001_init.sql'), '迁移目录含 001_init.sql');

/* 后续迁移是**正常的演进**，不是违规。这个断言原本写死「仅有初始迁移」，
 * 结果任何新增迁移都会让门禁失败 —— 那是把「门禁守护的东西」搞错了：
 * 它该守的是「迁移与 schema 一致」，不是「迁移文件数量固定」。
 *
 * 真正要守的是：
 *   1. 迁移文件编号连续（001, 002, ... 不能跳号，否则回滚顺序会错乱）
 *   2. 每个后续迁移必须有配套的说明（不能是空文件或只有注释）
 *   3. 后续迁移必须是**增量**的（不能重复 CREATE 主表 —— 001 已建过）
 */
const laterMigs = migFiles.filter((f) => f !== '001_init.sql');
assert(
  laterMigs.every((f) => {
    const m = f.match(/^(\d+)_(.+)\.sql$/);
    return m !== null && Number(m[1]) >= 2;
  }),
  `后续迁移文件命名规范（NNN_描述.sql，编号 >= 002）${laterMigs.length ? '：' + laterMigs.join(', ') : ''}`
);

// 编号连续性：001,002,003... 不能跳号
{
  const nums = migFiles
    .map((f) => f.match(/^(\d+)_/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const expected = nums.map((_, i) => i + 1);
  assert(
    JSON.stringify(nums) === JSON.stringify(expected),
    `迁移编号连续无跳号（实际 ${nums.join(',')}）`
  );
}

// 每个后续迁移必须有实质内容（不能是空壳）
{
  const emptyMigs = laterMigs.filter((f) => {
    const content = fs.readFileSync(path.join(MIG, f), 'utf8');
    // 去掉注释与空行后仍有 SQL 语句
    const sql = content
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--') && l.trim().length > 0)
      .join('\n');
    return sql.trim().length === 0;
  });
  assert(
    emptyMigs.length === 0,
    `后续迁移均有实质内容${emptyMigs.length ? '，空壳文件：' + emptyMigs.join(', ') : ''}`
  );
}

// 后续迁移不得重复创建主表（001 已建），否则重复执行会报 already exists
{
  const reCreating = laterMigs.filter((f) => {
    const content = fs.readFileSync(path.join(MIG, f), 'utf8');
    return /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(medplan\.)?(patients|studies|reports|audit_logs|segmentation_tasks|plans)\b/i.test(
      content
    );
  });
  assert(
    reCreating.length === 0,
    `后续迁移不重复创建主表（001_init.sql 已建）${reCreating.length ? '，违反：' + reCreating.join(', ') : ''}`
  );
}


/* ------------------------------------------------------- 13. 运行时分区默认权限 */
/* 回归防护：fn_precreate_audit_partition() 运行时用 CREATE TABLE ... PARTITION OF
   创建月分区。PostgreSQL 的 ALTER DEFAULT PRIVILEGES 只影响该语句之后新建的对象，
   运行时创建的分区不会继承此前已授予的权限。若迁移文件缺这段，新建月分区将没有
   app_audit 的 INSERT 权限 -> 审计写入失败 -> 审计事件丢失（等保 8.1.4.3 不可接受）。
   该缺陷曾真实存在：schema.sql 有，001_init.sql 缺失。 */
assert(
  /ALTER DEFAULT PRIVILEGES IN SCHEMA medplan\s+GRANT INSERT, SELECT ON TABLES TO app_audit/.test(initCode),
  '迁移含 app_audit 的默认权限声明（运行时新建审计分区须有 INSERT 权限）'
);
assert(
  /ALTER DEFAULT PRIVILEGES IN SCHEMA medplan\s+GRANT SELECT ON TABLES TO app_ro/.test(initCode),
  '迁移含 app_ro 的默认权限声明'
);
assert(
  /ALTER DEFAULT PRIVILEGES IN SCHEMA medplan\s+REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM app_rw, app_ro/.test(initCode),
  '迁移含默认权限的撤销声明（新建分区不得绕过审计表物理不可改约束）'
);
// 顺序：默认权限声明必须在角色创建之后，否则 ALTER DEFAULT PRIVILEGES 作用对象不存在
const firstRole = initCode.indexOf('CREATE ROLE app_ro');
const firstDefault = initCode.indexOf('ALTER DEFAULT PRIVILEGES');
assert(
  firstRole !== -1 && firstDefault !== -1 && firstDefault > firstRole,
  'ALTER DEFAULT PRIVILEGES 位于角色创建之后（否则语句作用对象不存在）'
);
// app_audit 必须是默认权限的授予对象之一
assert(
  /fn_precreate_audit_partition/.test(initCode) && /app_audit/.test(initCode),
  '分区预建函数与 app_audit 角色均存在（权限链完整）'
);

/* ------------------------------------------- 14. append-only 语义（契约 vs DDL 一致性）
 *
 * 回归防护：契约（openapi.yaml /segmentation-tasks/{taskId}/confirm）要求
 * segmentation_confirms 是 append-only —— 同一 structureName 重复确认以最后一次为准，
 * 每次变更**追加新记录**。
 *
 * 若 DDL 里保留 UNIQUE (task_id, structure_name)，第二次确认会撞唯一约束，
 * 追加语义直接失效 —— 契约与 DDL 自相矛盾。
 * 「以最后一次为准」应由视图（v_segmentation_confirm_current）提供，
 * 而不是用唯一约束实现。
 *
 * 这个缺陷真实存在过：DDL 用了唯一约束，契约要求 append-only，
 * 两边同时成立不了。静态 lint 之前只比对 schema 与迁移文件的一致性，
 * 没有拿 DDL 去对契约的语义要求，所以漏过了。 */
/* 判据要限定在 segmentation_confirms 表的约束块内 ——
 * segmentations 表（AI 分割结果，一任务一结构）本来就该 UNIQUE，
 * 不能一刀切禁掉所有 (task_id, structure_name) 唯一约束。 */
const confirmsBlock = (() => {
  const i = initCode.indexOf('CREATE TABLE segmentation_confirms');
  if (i === -1) return '';
  const j = initCode.indexOf(');', i);
  return initCode.slice(i, j === -1 ? i + 2000 : j);
})();
assert(
  confirmsBlock.length > 0,
  '迁移文件含 segmentation_confirms 表定义'
);
assert(
  !/UNIQUE\s*\(\s*task_id\s*,\s*structure_name\s*\)/.test(confirmsBlock),
  'segmentation_confirms 不用 UNIQUE (task_id, structure_name)（与契约 append-only 冲突）'
);
assert(
  /CREATE OR REPLACE VIEW v_segmentation_confirm_current/.test(initCode),
  '提供 v_segmentation_confirm_current 视图实现「以最后一次为准」语义'
);
assert(
  /idx_seg_confirm_task_structure/.test(initCode),
  '提供 (task_id, structure_name, confirmed_at DESC) 索引支撑最新记录查询'
);
assert(
  /UNIQUE\s*\(\s*idempotency_key\s*\)/.test(initCode),
  'segmentation_confirms 用 idempotency_key 唯一约束实现重复提交去重'
);

/* ------------------------------------------- 15. 触发器引用不依赖会话 search_path */
{
  const bareRefs = (initCode.match(/EXECUTE FUNCTION\s+(?!medplan\.)fn_\w+/g) || []).length;
  assert(
    bareRefs === 0,
    `触发器引用函数时显式带 schema 前缀（不依赖会话 search_path，剩 ${bareRefs} 处未加）`
  );
}

/* 输出 ------------------------------------------------------------------ */
console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('迁移文件自检全部通过。');
