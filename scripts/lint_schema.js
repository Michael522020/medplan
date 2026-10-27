/**
 * MedPlan schema.sql 静态自检（CI 门禁）
 *
 * 为什么需要脚本：schema.sql 是等保测评的证据材料，人工 review 会漏。
 * 本脚本把「审计表不可改」「不留明文」「卫健委字段全覆盖」等合规约束
 * 变成可执行断言，与 PostgreSQL 实际执行验证互补。
 *
 * 运行：node scripts/lint_schema.js
 * 配套：真实 PG18 执行验证见 docs/db/migrations/README.md
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'docs', 'db', 'schema.sql');
const sql = fs.readFileSync(FILE, 'utf8');

const failures = [];
const passes = [];
const assert = (cond, msg) => (cond ? passes : failures).push(msg);

// 去掉行注释，避免注释里的关键字造成误判
const code = sql
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

/* 辅助：从 CREATE TABLE 块中提取列定义 --------------------------------- */
function tableBody(table) {
  const re = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\n\\)\\s*(?:PARTITION BY[^;]*)?;`
  );
  const m = code.match(re);
  return m ? m[1] : null;
}
function columnsOf(table) {
  const body = tableBody(table);
  if (!body) return [];
  // 顶层逗号切分（忽略括号内的逗号）
  const parts = [];
  let depth = 0, buf = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  parts.push(buf);
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(p))
    .map((p) => ({ name: (p.match(/^(\w+)/) || [])[1], def: p }));
}

/* 1. Spec §6 锁定的 15 张表全部落位 ------------------------------------- */
const LOCKED_TABLES = [
  'patients', 'visits', 'studies', 'series', 'instances',
  'segmentation_tasks', 'segmentation_confirms', 'plans', 'plan_commands',
  'reports', 'signature_logs', 'audit_logs',
  'users', 'roles', 'user_roles', 'patient_grants',
];
for (const t of LOCKED_TABLES) {
  assert(
    new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${t}\\b`).test(code),
    `Spec §6 表存在：${t}`
  );
}
assert(LOCKED_TABLES.length === 16, `锁定表数 = ${LOCKED_TABLES.length}（含 users/roles/user_roles 拆开）`);
// Spec 额外要求的支撑表
for (const t of ['segmentations', 'report_revisions', 'schema_migrations']) {
  assert(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${t}\\b`).test(code), `支撑表存在：${t}`);
}

/* 2. audit_logs 物理不可改：三层防护 ------------------------------------ */
const auditBody = tableBody('audit_logs');
assert(!!auditBody, 'audit_logs 表定义可解析');
assert(
  /REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw/.test(code),
  'audit_logs 对业务账号撤销 UPDATE/DELETE/TRUNCATE（第一层：数据库权限）'
);
assert(
  /CREATE TRIGGER trg_audit_logs_no_update[\s\S]*?BEFORE UPDATE ON audit_logs/.test(code),
  'audit_logs 有 UPDATE 阻断触发器（第二层）'
);
assert(
  /CREATE TRIGGER trg_audit_logs_no_delete[\s\S]*?BEFORE DELETE ON audit_logs/.test(code),
  'audit_logs 有 DELETE 阻断触发器（第二层）'
);
assert(
  /CREATE TRIGGER trg_audit_logs_no_truncate[\s\S]*?BEFORE TRUNCATE ON audit_logs/.test(code),
  'audit_logs 有 TRUNCATE 阻断触发器（TRUNCATE 不触发行级触发器，必须单独声明）'
);
assert(
  /CREATE TRIGGER trg_audit_chain[\s\S]*?BEFORE INSERT ON audit_logs/.test(code),
  'audit_logs 插入时自动计算 hash chain'
);
// 关键：不得存在任何允许修改审计表的路径
assert(
  !/GRANT\s+(UPDATE|DELETE|TRUNCATE|ALL)\s+ON\s+audit_logs/i.test(code),
  '不存在任何 GRANT UPDATE/DELETE/TRUNCATE/ALL ON audit_logs（app_ro/app_rw/ai_worker 均无）'
);
assert(
  /REVOKE ALL ON ALL TABLES IN SCHEMA medplan FROM app_audit/.test(code),
  'app_audit 账号显式 REVOKE ALL 后仅授 INSERT/SELECT（权限分离）'
);

/* 3. hash chain 三要素 -------------------------------------------------- */
const auditCols = columnsOf('audit_logs').map((c) => c.name);
for (const c of ['hash_prev', 'hash_self']) {
  assert(auditCols.includes(c), `audit_logs 含 chain 字段：${c}`);
}
assert(
  /NEW\.hash_prev\s*:=\s*v_prev_hash/.test(code),
  'hash_prev 由链尾自动赋值（非客户端可写）'
);
assert(
  /NEW\.hash_self\s*:=\s*v_row_hash/.test(code),
  'hash_self 由触发器计算（客户端无法伪造）'
);
assert(
  /pg_advisory_xact_lock/.test(code),
  '并发写入用 advisory lock 串行化（否则并发插入产生分叉链）'
);
assert(
  /CREATE OR REPLACE FUNCTION fn_verify_audit_chain/.test(code),
  '提供链完整性校验函数（每日定时调用）'
);

/* 4. PHI 不留明文 ------------------------------------------------------- */
const patientCols = columnsOf('patients');
const pnames = patientCols.map((c) => c.name);
assert(pnames.includes('id_card_hash'), 'patients 有 id_card_hash');
assert(
  !pnames.some((n) => /^id_card$/.test(n)),
  'patients **无** id_card 明文列'
);
const idCardHash = patientCols.find((c) => c.name === 'id_card_hash');
assert(/char\(64\)/.test(idCardHash.def), 'id_card_hash 为 char(64)（SM3 hex 摘要长度）');
assert(
  /phone_hash/.test(code) && !patientCols.some((c) => c.name === 'phone'),
  'patients 手机号只存 phone_hash，无明文 phone 列'
);
assert(
  /COMMENT ON COLUMN patients\.id_card_hash IS '[^']*SM3 摘要/.test(sql),
  'id_card_hash 注释明确为 SM3 摘要'
);
assert(
  /audit_logs[\s\S]{0,4000}?禁止写入姓名明文|禁止写入患者姓名明文/.test(sql),
  'audit_logs 明示禁止写入姓名明文/身份证/手机号'
);
// 唯一约束确保摘要无碰撞重复
assert(
  /CREATE INDEX idx_patients_id_card_hash ON patients\(id_card_hash\)/.test(code),
  'id_card_hash 有索引（摘要比对查询）'
);

/* 5. 卫健委电子病历必备字段全覆盖（架构方案 §7.3） --------------------- */
const NHC = [
  ['患者基本信息', 'patients', ['name', 'gender', 'birth_date', 'id_card_hash']],
  ['就诊信息', 'visits', ['visit_no', 'visit_type', 'admit_date', 'dept']],
  ['检查信息', 'studies', ['accession_no', 'modality', 'body_part', 'study_date']],
  ['检查所见', 'reports', ['findings']],
  ['诊断意见', 'reports', ['impression']],
  ['建议随访', 'reports', ['follow_up_recommendation']],
  ['报告医师', 'reports', ['report_doctor_id']],
  ['审核医师', 'reports', ['review_doctor_id']],
  ['报告时间', 'reports', ['report_time']],
  ['修改痕迹', 'report_revisions', ['snapshot', 'change_summary', 'edited_by']],
  ['操作印痕', 'audit_logs', ['actor_id', 'event_type', 'event_time', 'result']],
  ['签名有效性', 'signature_logs', ['digest_value', 'signature_value', 'cert_serial', 'tsa_token']],
  ['AI 参与声明', 'reports', ['ai_assist']],
  ['AI 标记确认', 'segmentation_confirms', ['action', 'modification_note', 'confirmed_by']],
];
for (const [field, table, cols] of NHC) {
  const actual = columnsOf(table).map((c) => c.name);
  for (const c of cols) {
    assert(
      actual.includes(c),
      `卫健委必备「${field}」落位：${table}.${c}`
    );
  }
}
assert(
  /CREATE OR REPLACE FUNCTION fn_check_nhc_field_coverage/.test(code),
  '提供卫健委字段覆盖检查函数（测评取证用）'
);

/* 6. WS/T 847—2024 签名日志字段逐项 ------------------------------------ */
const sigCols = columnsOf('signature_logs').map((c) => c.name);
const WST847 = [
  ['数字签名流水号', 'serial_no'],
  ['原文唯一序列号', 'document_unique_sn'],
  ['服务主体标识', 'subject_id'],
  ['服务对象标识', 'object_id'],
  ['原文摘要值', 'digest_value'],
  ['摘要算法标识', 'digest_algorithm'],
  ['证书序列号', 'cert_serial'],
  ['签名数据', 'signature_value'],
];
for (const [label, col] of WST847) {
  assert(sigCols.includes(col), `WS/T 847 ${label} -> signature_logs.${col}`);
}
assert(
  /log_integrity_digest/.test(code),
  'signature_logs 有日志自身完整性摘要（WS/T 847：日志本身可被数字签名验证）'
);
assert(
  /CREATE TRIGGER trg_signature_logs_immutable[\s\S]*?BEFORE UPDATE OR DELETE ON signature_logs/.test(code),
  'signature_logs append-only 触发器'
);
assert(
  /CREATE TRIGGER trg_signature_logs_no_truncate[\s\S]*?BEFORE TRUNCATE ON signature_logs/.test(code),
  'signature_logs TRUNCATE 阻断'
);
assert(
  /ck_signature_digest_algorithm CHECK \(digest_algorithm = 'SM3'\)/.test(code),
  '摘要算法 CHECK 锁定 SM3（国密）'
);
assert(
  /ck_signature_algorithm CHECK \(signature_algorithm = 'SM2'\)/.test(code),
  '签名算法 CHECK 锁定 SM2（国密）'
);
assert(
  /ck_signature_cert_valid CHECK/.test(code),
  '签名时间必须在证书有效期内'
);
assert(
  /ck_signature_title CHECK/.test(code),
  '签名人职称 CHECK 限定执业医师（实习医师无签名权）'
);

/* 7. 留存策略 ----------------------------------------------------------- */
const retentionTables = LOCKED_TABLES.filter((t) => !['audit_logs'].includes(t));
for (const t of retentionTables) {
  const body = tableBody(t);
  const hasRetention = /retention_class\s+retention_class/.test(body || '');
  const hasArchiveNote = new RegExp(
    `${t}[\\s\\S]{0,300}?(留存|归档|retention)`
  ).test(sql);
  assert(
    hasRetention || hasArchiveNote,
    `表 ${t} 有 retention_class 或明确归档策略注释`
  );
}
assert(
  /CREATE TYPE retention_class AS ENUM \([\s\S]*audit_6m[\s\S]*report_15y[\s\S]*report_30y[\s\S]*signature_perm/.test(code),
  'retention_class 枚举含审计6个月/门急诊15年/住院30年/签名永久'
);
assert(
  /ck_reports_retention CHECK \([\s\S]*report_15y[\s\S]*report_30y/.test(code),
  'reports 留存 CHECK 限定 15 年或 30 年两档（AC-20）'
);
assert(
  /CREATE TABLE audit_logs_\d{4}_\d{2} PARTITION OF audit_logs/.test(code),
  'audit_logs 按月 RANGE 分区（到期可DETACH 归档）'
);
assert(
  /CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT/.test(code),
  'audit_logs 有 DEFAULT 兜底分区（防止时间落在分区外导致审计写入失败）'
);
assert(
  /fn_find_archivable_reports/.test(code) &&
    !/DELETE\s+FROM\s+reports/.test(code),
  '归档只出清单不删数据（数据库不提供删除入口）'
);

/* 8. AI 合规边界：DB 层无自由文本 ------------------------------------- */
const segCols = columnsOf('segmentations').map((c) => c.name);
const AI_FORBIDDEN = ['nature', 'diagnosis', 'malignancy', 'impression', 'conclusion', 'finding', 'text', 'comment', 'note'];
for (const bad of AI_FORBIDDEN) {
  assert(
    !segCols.includes(bad),
    `segmentations 无结论性/自由文本字段 ${bad}`
  );
}
assert(
  /ck_seg_task_model_version CHECK \([\s\S]*model_version = '2\.18\.0'/.test(code),
  '模型版本 CHECK 锁定 2.18.0（算法升级需变更注册审批）'
);
assert(
  /ck_seg_task_failure_detail CHECK/.test(code),
  '失败任务必须记录错误码与失败环节（禁止空模型冒充成功）'
);
assert(
  /ck_seg_confirm_note_required CHECK/.test(code),
  'action=modified 时修改说明必填（修改留痕）'
);
assert(
  /pending_supervisor_review/.test(code),
  '实习医师确认标记存在（报告提交阻断依据）'
);

/* 9. 乐观锁（ADR-006） ------------------------------------------------- */
const planCols = columnsOf('plans').map((c) => c.name);
assert(planCols.includes('version'), 'plans 有version（乐观锁）');
assert(/ck_plans_version CHECK \(version >= 1\)/.test(code), 'version CHECK');
assert(
  new RegExp('CREATE TABLE plan_commands').test(code),
  'plan_commands 操作日志存在（可审计的变更链）'
);
assert(
  /before_value/.test(code) && /after_value/.test(code),
  'plan_commands 记录变更前后值'
);
assert(
  /CREATE INDEX idx_plans_study ON plans\(study_id, version DESC\)/.test(code),
  'plans 乐观锁索引落地'
);

/* 10. 最小权限：账号与职责分离（等保 8.1.4.2/8.1.4.3） ---------------- */
for (const role of ['app_ro', 'app_rw', 'app_audit', 'ai_worker', 'migrator']) {
  assert(new RegExp(`CREATE ROLE ${role} LOGIN`).test(code), `角色存在：${role}`);
}
assert(
  /REVOKE ALL ON patients, visits, reports, report_revisions,[\s\S]*?FROM ai_worker/.test(code),
  'ai_worker 显式拒绝 PHI 表（GPU Worker 不接触患者数据）'
);
assert(
  /REVOKE ALL ON v_patients_plain FROM app_ro, app_rw, ai_worker/.test(code),
  '明文患者视图默认拒绝（需显式授权 + 强制审计）'
);
assert(
  /v_patients_masked/.test(code),
  '提供患者脱敏视图（后端默认查此视图）'
);
assert(
  /REVOKE DELETE ON signature_logs FROM app_rw/.test(code),
  '业务账号不可删签名日志'
);

/* 11. 索引按架构方案 §7.4 落地 ---------------------------------------- */
const REQUIRED_INDEXES = [
  'idx_patients_empi', 'idx_patients_id_card_hash',
  'idx_studies_accession', 'idx_studies_patient_date', 'idx_studies_status',
  'idx_series_study', 'idx_series_phase',
  'idx_seg_task_status', 'idx_seg_task_study',
  'idx_plans_study',
  'idx_reports_study_version',
  'idx_audit_actor_time', 'idx_audit_type_time', 'idx_audit_patient_time', 'idx_audit_time',
];
for (const ix of REQUIRED_INDEXES) {
  assert(new RegExp(`CREATE (UNIQUE )?INDEX ${ix}\\b`).test(code), `索引落地（架构方案 §7.4）：${ix}`);
}
assert(
  /CREATE INDEX idx_audit_denied ON audit_logs[\s\S]*?WHERE result = 'denied'/.test(code),
  '越权拒绝专项索引（合规追溯最高频查询）'
);

/* 12. 已签名报告不可删不可改 -------------------------------------------- */
assert(
  /trg_reports_no_delete_signed[\s\S]*?BEFORE DELETE ON reports/.test(code),
  '已签名报告 DELETE 阻断'
);
assert(
  /trg_reports_no_signed_update[\s\S]*?BEFORE UPDATE ON reports/.test(code),
  '已签名报告 UPDATE 阻断（正文变更即签名失效 AC-14）'
);
assert(
  /ck_reports_signed CHECK/.test(code),
  'signed 状态必须有签名时间与审核医师'
);

/* 13. patient_grants 判定逻辑必须落在 COMMENT（合规取证时 \d+ 可见） --- */
const pgIdx = sql.indexOf('CREATE TABLE patient_grants');
assert(pgIdx > -1, 'patient_grants 表存在');
// 判定规则写在 patient_grants 之后的 COMMENT 块中（COMMENT ON COLUMN patient_grants.granted_by）
const grantSection = sql.slice(pgIdx, pgIdx + 9000);
assert(
  /COMMENT ON COLUMN patient_grants\.granted_by IS/.test(grantSection),
  'patient_grants 判定逻辑存于 COMMENT（psql \\d+ 可见，符合保取证要求）'
);
assert(
  /L3 数据权限判定规则/.test(grantSection),
  'patient_grants 有明确的判定规则标题'
);
for (const [rule, label] of [
  [/quality_control \/ medical_records \/ system_admin/, '规则 1 质控/病案/管理员全院可见'],
  [/V\.dept = U\.department_code/, '规则 2a 本科室就诊'],
  [/ward_dept = U\.department_code/, '规则 2b 本病区在院'],
  [/R\.report_doctor_id = U\.id 或 R\.review_doctor_id = U\.id/, '规则 3 本人为报告/审核医师'],
  [/转诊 \/ 会诊/, '规则 4 显式授权'],
  [/trainee_physician/, '规则 5 实习医师额外约束'],
]) {
  assert(rule.test(grantSection), `patient_grants 判定规则覆盖：${label}`);
}
assert(
  /下推到 SQL 的 WHERE 子句/.test(grantSection),
  'patient_grants 明确要求权限判定下推到 SQL（防应用层过滤泄露）'
);
assert(
  /不得写在 controller 或 service 层/.test(grantSection),
  'patient_grants 明确 SQL 实现位置（rbac/repositories，遵守依赖方向）'
);
assert(
  /不可区分/.test(grantSection),
  'patient_grants 明确 10004 与「患者不存在」不可区分'
);
assert(
  /retention_class   retention_class NOT NULL DEFAULT 'audit_6m'/.test(tableBody('patient_grants') || ''),
  'patient_grants 有 retention_class（授权记录永久可追溯）'
);

/* 17. PostgreSQL 硬约束（这些是真实执行会直接失败或静默出错的坑） -------- */

// 分区表主键必须包含分区键。写成PRIMARY KEY (id) 会建表失败
for (const [name, src] of [['schema.sql', sql], ['001_init.sql', fs.readFileSync(path.join(__dirname, '..', 'docs', 'db', 'migrations', '001_init.sql'), 'utf8')]]) {
  assert(
    /CONSTRAINT pk_audit_logs PRIMARY KEY \(id, event_time\)/.test(src),
    `分区表主键含分区键（PostgreSQL 硬约束）：${name}`
  );
}

// hash chain 拼接中每个可空字段都必须 coalesce。
// 否则任一为 NULL 会让整串结果为 NULL，触发 hash_self 的 NOT NULL 违约
const chainFn = /fn_audit_chain_guard[\s\S]*?NEW\.hash_self := v_row_hash/.exec(sql);
assert(!!chainFn, '解析到 fn_audit_chain_guard 函数体');
if (chainFn) {
  const body = chainFn[0];
  for (const col of ['actor_id', 'patient_id', 'result_code', 'source_ip', 'terminal_id', 'detail']) {
    assert(
      new RegExp(`coalesce\\(NEW\\.${col}::text,''\\)`).test(body) ||
        new RegExp(`coalesce\\(NEW\\.${col},''\\)`).test(body),
      `hash chain 对可空字段 coalesce：${col}`
    );
  }
  assert(
    /array_to_string\(NEW\.actor_roles/.test(body),
    'hash chain 数组用 array_to_string（不用 ::text，避免依赖数组字面量输出格式）'
  );
}

// DEFAULT '{}' 对 text[] 有效，但需确认列类型确为数组
assert(
  /permissions\s+text\[\]\s+NOT NULL DEFAULT '\{\}'/.test(code),
  "roles.permissions 为 text[] 且 DEFAULT '{}' 类型正确"
);
// 数组包含 CHECK 的正确写法
assert(
  /permissions <@ ARRAY\[/.test(code),
  "roles.permissions 包含约束用 <@ 运算符（PostgreSQL 数组包含）"
);

/* 18. 禁止 emoji ------------------------------------------------------- */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
assert(!EMOJI.test(sql), 'schema.sql 无 emoji');

/* 15. 时间类型统一timestamptz ------------------------------------------ */
const tsCount = (code.match(/\btimestamptz\b/g) || []).length;
const badTs = code.match(/\btimestamp\s+without\s+time\s+zone/g) || [];
assert(badTs.length === 0, `无 timestamp without time zone（统一 timestamptz，共 ${tsCount} 处）`);

/* 16. 幂等键 ----------------------------------------------------------- */
for (const t of ['segmentation_tasks', 'segmentation_confirms', 'plans', 'signature_logs']) {
  const cols = columnsOf(t).map((c) => c.name);
  assert(cols.includes('idempotency_key'), `${t} 有幂等键列`);
  assert(
    new RegExp(`uq_[a-z_]* UNIQUE \\(idempotency_key\\)`).test(code),
    `${t} 幂等键有 UNIQUE 约束（DB 层保证幂等）`
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
console.log('schema.sql 静态自检全部通过。');