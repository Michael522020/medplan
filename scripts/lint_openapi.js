/**
 * MedPlan OpenAPI 契约自检脚本（CI 门禁）
 * 用途：openapi.yaml 是前后端唯一契约，本脚本把强制约束变成可执行断言，
 *      避免「靠人记住约束」。任一断言失败即退出码 1，阻断构建。
 * 运行：node scripts/lint_openapi.js
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SPEC = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const SCHEMA_SQL = path.join(__dirname, '..', 'docs', 'db', 'schema.sql');
const raw = fs.readFileSync(SPEC, 'utf8');
const sql = fs.readFileSync(SCHEMA_SQL, 'utf8');
const schemaSql = () => fs.readFileSync(SCHEMA_SQL, 'utf8');
const doc = yaml.load(raw);

const failures = [];
const passes = [];
function assert(cond, msg) {
  if (cond) passes.push(msg);
  else failures.push(msg);
}

/* 1. 结构完整性 ---------------------------------------------------------- */
const LOCKED_ENDPOINTS = [
  ['post', '/api/v1/auth/login'],
  ['get', '/api/v1/studies'],
  ['get', '/api/v1/studies/{studyUid}/series'],
  ['post', '/api/v1/wado/instances'],
  ['post', '/api/v1/segmentation-tasks'],
  ['get', '/api/v1/segmentation-tasks/{taskId}'],
  ['post', '/api/v1/segmentation-tasks/{taskId}/confirm'],
  ['post', '/api/v1/plans'],
  ['put', '/api/v1/plans/{planId}'],
  ['get', '/api/v1/reports/{reportId}'],
  ['post', '/api/v1/reports/{reportId}/sign'],
  ['get', '/api/v1/audit-logs'],
];

const actualOps = [];
for (const [p, item] of Object.entries(doc.paths || {})) {
  for (const [m, op] of Object.entries(item)) {
    if (m === 'parameters') continue;
    actualOps.push([m, p]);
  }
}
assert(
  actualOps.length === LOCKED_ENDPOINTS.length,
  `端点数 = ${LOCKED_ENDPOINTS.length}（实际 ${actualOps.length}）`
);
for (const e of LOCKED_ENDPOINTS) {
  assert(
    actualOps.some(([m, p]) => m === e[0] && p === e[1]),
    `锁定端点存在：${e[0].toUpperCase()} ${e[1]}`
  );
}

/* 2. 响应码 key合法性与唯一性 -------------------------------------------- */
for (const [p, item] of Object.entries(doc.paths)) {
  for (const [m, op] of Object.entries(item)) {
    if (!op || !op.responses) continue;
    const codes = Object.keys(op.responses);
    assert(
      new Set(codes).size === codes.length,
      `响应码唯一：${m.toUpperCase()} ${p}`
    );
    for (const c of codes) {
      assert(
        c === 'default' || /^[1-5][0-9X]{2}$/.test(c),
        `响应码合法（default 或 3 位数字）：${m.toUpperCase()} ${p} -> ${c}`
      );
    }
  }
}

/* 3. 幂等端点必须带 Idempotency-Key -------------------------------------- */
const IDEMPOTENT = [
  ['post', '/api/v1/segmentation-tasks'],
  ['post', '/api/v1/segmentation-tasks/{taskId}/confirm'],
  ['post', '/api/v1/plans'],
  ['put', '/api/v1/plans/{planId}'],
  ['post', '/api/v1/reports/{reportId}/sign'],
];
const hasIdemHeader = (op) => {
  const ps = [].concat(op.parameters || []);
  return ps.some(
    (x) => (x.$ref || '').endsWith('/IdempotencyKey') || x.name === 'Idempotency-Key'
  );
};
for (const [m, p] of IDEMPOTENT) {
  const op = doc.paths[p][m];
  assert(op['x-idempotent'] === true, `标注 x-idempotent: true：${m.toUpperCase()} ${p}`);
  assert(hasIdemHeader(op), `携带 Idempotency-Key：${m.toUpperCase()} ${p}`);
}
// 幂等端点必须声明 200 重放响应
for (const [m, p] of IDEMPOTENT) {
  const op = doc.paths[p][m];
  assert(
    !!op.responses['200'],
    `幂等重放响应存在（200）：${m.toUpperCase()} ${p}`
  );
}

/* 4. x-audit 覆盖所有 PHI 端点 ------------------------------------------- */
let auditCount = 0;
for (const [p, item] of Object.entries(doc.paths)) {
  for (const [m, op] of Object.entries(item)) {
    if (!op || !op.responses) continue;
    assert(op['x-audit'] === true, `标注 x-audit: true：${m.toUpperCase()} ${p}`);
    assert(
      typeof op['x-audit-event'] === 'string' && op['x-audit-event'].length > 0,
      `标注 x-audit-event：${m.toUpperCase()} ${p}`
    );
    assert(
      typeof op['x-audit-phi'] === 'boolean',
      `标注 x-audit-phi：${m.toUpperCase()} ${p}`
    );
    if (op['x-audit'] === true) auditCount++;
  }
}
assert(auditCount === LOCKED_ENDPOINTS.length, `带 x-audit 端点数 = ${auditCount}`);

/* 5. plans PUT 必须带 version 且声明 409 --------------------------------- */
function deref(node) {
  if (node && node.$ref) {
    return doc.components.schemas[node.$ref.replace('#/components/schemas/', '')];
  }
  return node;
}
const putPlan = doc.paths['/api/v1/plans/{planId}'].put;
const putPlanBody = deref(putPlan.requestBody.content['application/json'].schema);
assert(
  Array.isArray(putPlanBody.required) && putPlanBody.required.includes('version'),
  'PUT /plans/{planId} 请求体必填 version'
);
assert(
  putPlanBody.properties.version && putPlanBody.properties.version.minimum >= 1,
  'PUT /plans/{planId} 的 version 为正整数（乐观锁版本号）'
);
assert(!!putPlan.responses['409'], 'PUT /plans/{planId} 声明 409 冲突响应');
const conflictSchema = putPlan.responses['409'].content['application/json'].schema;
assert(
  conflictSchema.$ref.endsWith('ErrorResponse'),
  '409 响应复用统一错误结构 ErrorResponse'
);

/* 6. 全部 $ref 可解析 ---------------------------------------------------- */
function walk(node, pointer, seen) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${pointer}/${i}`, seen));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      const parts = v.replace(/^#\//, '').split('/');
      let cur = doc;
      for (const p of parts) cur = cur == null ? undefined : cur[p];
      assert(cur !== undefined, `$ref 可解析：${v}（引用点 ${pointer}）`);
    } else {
      walk(v, `${pointer}/${k}`, seen);
    }
  }
}
walk(doc, '', null);

/* 7. AI 输出一致性黑名单（强制约束：不够就零） --------------------------- */
const AI_FIELD_BLACKLIST = [
  'nature', 'diagnosis', 'malignancy', 'benign', 'malignant',
  'impression', 'suggestion', 'recommendation', 'conclusion',
  'comment', 'description', 'finding', 'tumor', 'lesion_type',
  'grade', 'stage', 'classification',
];
const AI_SCHEMAS = [
  'SegmentationStructure',
  'AiAssist',
  'AiAssistReference',
  'PhaseValidation',
  'SegmentationTaskError',
];
for (const name of AI_SCHEMAS) {
  const s = doc.components.schemas[name];
  assert(!!s, `AI 相关 schema 存在：${name}`);
  if (!s) continue;
  const props = Object.keys(s.properties || {});
  for (const bad of AI_FIELD_BLACKLIST) {
    assert(
      !props.includes(bad),
      `AI schema ${name} 不含结论性字段 ${bad}`
    );
  }
  assert(
    s.additionalProperties === false,
    `AI schema ${name} 关闭 additionalProperties（越界字段在契约层被拒）`
  );
}
// SegmentationStructure 不得有自由文本字段
const ss = doc.components.schemas.SegmentationStructure;
assert(
  !ss.properties.text && !ss.properties.label && !ss.properties.note,
  'SegmentationStructure 无自由文本字段'
);

/* 8. 诊断意见必须执业医师署名，无AI 作者分支 ----------------------------- */
const imp = doc.components.schemas.SignedImpression;
assert(
  imp.required.includes('authoredBy'),
  'SignedImpression 必填 authoredBy'
);
const impAuthor = deref(imp.properties.authoredBy);
assert(
  !imp.properties.suggestedBy &&
    !impAuthor.properties.aiAuthored &&
    !impAuthor.properties.isAi,
  'SignedImpression 无 AI 作者 / AI 建议分支'
);
const ar = doc.components.schemas.AuthorRef;
assert(
  !Object.keys(ar.properties).some((k) => /ai|suggest|model/i.test(k)),
  'AuthorRef 无任何 AI 相关字段'
);
// AI 字段只出现在 aiAssist 分组
const sf = doc.components.schemas.StructuredFields;
const sfProps = Object.keys(sf.properties);
assert(
  sfProps.filter((k) => /ai/i.test(k)).join(',') === 'aiAssist',
  `AI 字段仅存在于 aiAssist（实际：${sfProps.filter((k) => /ai/i.test(k))}）`
);
assert(sf.required.includes('aiAssist'), 'aiAssist 为必填（不得省略 AI 声明）');

/* 9. 五类受控字段齐全 ---------------------------------------------------- */
const CF = ['examBodyPart', 'scanMode', 'findings', 'impression', 'followUpRecommendation'];
for (const f of CF) {
  assert(sf.required.includes(f), `受控字段必填：${f}`);
}
assert(
  doc.components.schemas.ControlledFieldKey.enum.length === 5,
  'ControlledFieldKey 恰为 5 类'
);

/* 10. 统一响应包裹 ------------------------------------------------------- */
assert(doc.components.schemas.ErrorResponse, 'ErrorResponse 定义存在');
const successSchemas = [
  'LoginResponse', 'StudyListResponse', 'SeriesGroupedResponse',
  'CreateSegmentationTaskResponse', 'SegmentationTaskResponse',
  'ConfirmSegmentationResponse', 'PlanResponse', 'ReportResponse',
  'SignReportResponse', 'AuditLogListResponse',
];
for (const name of successSchemas) {
  const s = doc.components.schemas[name];
  assert(!!s && s.required.includes('code'), `统一包裹含 code：${name}`);
}

/* 11. 安全方案 ----------------------------------------------------------- */
assert(!!doc.components.securitySchemes.bearerAuth, 'bearerAuth 定义存在');
assert(doc.components.securitySchemes.bearerAuth.scheme === 'bearer', 'bearerAuth 为 bearer');
const loginOp = doc.paths['/api/v1/auth/login'].post;
assert(
  Array.isArray(loginOp.security) && loginOp.security.length === 0,
  '登录端点显式声明 security: []（不要求已有令牌）'
);

/* 12. 占位示例值黑名单（临床真实数据） ----------------------------------- */
const PLACEHOLDER = [
  /\bstring1\b/i, /\bstring2\b/i, /\bfoo\b/i, /\bbar\b/i, /\bbaz\b/i,
  /\bLorem\b/i, /\bipsum\b/i, /\bplaceholder\b/i, /\bdummy\b/i,
  /\bexample\.com\b/i, /\btest test\b/i, /\bsample value\b/i,
  /\byour[-_ ]?name\b/i, /\bxxx+\b/i, /\bTODO\b/, /\bTBD\b/, /\bFIXME\b/,
];
// 允许的受控白名单：JWT / Base64 证书 / 密码占位 / OIDC issuer 这类天然重复串
const ALLOWED_REPEAT = [
  /^eyJ[A-Za-z0-9_.\-+/=]+$/,      // JWT
  /^MEUCIQ[A-Za-z0-9+/=]+$/,       // SM2 签名 DER（Base64）
  /^MIAGCS[A-Za-z0-9+/=]+$/,       // TSA token（Base64）
  /^[A-Za-z0-9+/]{40,}={0,2}$/,    // 长Base64（证书 / 公钥）
  /^'+$/,                          // 口令占位
];
function scanStrings(node, pointer) {
  if (typeof node === 'string') {
    const v = node;
    if (ALLOWED_REPEAT.some((r) => r.test(v))) return;
    for (const re of PLACEHOLDER) {
      if (re.test(v)) {
        failures.push(`占位示例值 ${re} 出现在 ${pointer}: ${v.slice(0, 60)}`);
        return;
      }
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanStrings(v, `${pointer}/${i}`));
    return;
  }
  for (const [k, v] of Object.entries(node)) scanStrings(v, `${pointer}/${k}`);
}
scanStrings(doc, '#');

/* 13. 禁用 emoji --------------------------------------------------------- */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
const emojiHit = EMOJI.test(raw);
assert(!emojiHit, 'openapi.yaml 无 emoji');

/* 14. 脱敏：不得返回身份证明文 ------------------------------------------- */
const pb = doc.components.schemas.PatientBrief;
assert(!!pb.properties.idCardMasked, 'PatientBrief 提供 idCardMasked');
assert(
  !Object.keys(pb.properties).some((k) => /^idCard$/i.test(k)),
  'PatientBrief 不提供身份证明文字段'
);
assert(
  /_masked|脱敏|掩码/.test(pb.properties.nameMasked.description || ''),
  'nameMasked 明确掩码语义'
);

/* 15. 声明的 PHI 隐藏端点使用固定常量message ---------------------------- */
const hidden = doc.components.responses.ErrPatientScopeHidden;
assert(
  hidden.content['application/json'].examples.hidden.value.message ===
    '请求的资源不可用',
  '10004 响应 message 为固定常量（防体大小侧信道）'
);
assert(
  doc.paths['/api/v1/studies'].get.responses['404'].$ref.endsWith('ErrPatientScopeHidden'),
  'PHI 导航端点 404 复用 ErrPatientScopeHidden'
);

/* 16. 审计事件枚举与 x-audit-event 对齐 --------------------------------- */
const auditEnum = new Set(doc.components.schemas.AuditEventType.enum);
for (const [p, item] of Object.entries(doc.paths)) {
  for (const [m, op] of Object.entries(item)) {
    if (!op || !op.responses) continue;
    assert(
      auditEnum.has(op['x-audit-event']),
      `x-audit-event 在枚举内：${op['x-audit-event']}（${m.toUpperCase()} ${p}）`
    );
  }
}

/* 17. UIUX-P2 四条接口依赖（架构-设计联合锁定） ------------------------- */

// 便捷解包：200 响应 -> content['application/json'].schema
function okSchema(op, code) {
  return deref(op.responses[code].content['application/json'].schema);
}

// 依赖 1（安全）：报告必须下发服务端权威锁定标志，且进 required
const repData = deref(okSchema(doc.paths['/api/v1/reports/{reportId}'].get, '200').properties.data);
assert(
  repData.required.includes('lockState'),
  '依赖 1：lockState 在 ReportResponse.data 的 required 列表中（非仅 description 建议）'
);
assert(
  !!repData.properties.lockState &&
    repData.properties.lockState.$ref.endsWith('ReportLockState'),
  '依赖 1：lockState 为独立 schema 引用'
);
const lockState = doc.components.schemas.ReportLockState;
assert(!!lockState, '依赖 1：ReportLockState schema 存在');
if (lockState) {
  for (const f of ['state', 'editable', 'reason', 'signatureValid']) {
    assert(
      lockState.required.includes(f),
      `依赖 1：lockState.${f} 为必填（前端不得推断）`
    );
  }
  assert(
    JSON.stringify(lockState.properties.state.enum) ===
      JSON.stringify(['DRAFT', 'PENDING_REVIEW', 'SIGNED', 'ARCHIVED']),
    '依赖 1：lockState.state 四态枚举'
  );
  assert(
    lockState.properties.editable.type === 'boolean',
    '依赖 1：editable 为布尔（前端直接禁用编辑控件，不自行推导）'
  );
  assert(
    lockState.properties.signatureValid.type === 'boolean',
    '依赖 1：signatureValid 独立于 state（签名失效检测，AC-14）'
  );
}
assert(
  /必须用 `lockState`/.test(repData.properties.status.description || ''),
  '依赖 1：status 描述明确要求用 lockState 判断可编辑性'
);
{
  const rep200 = doc.paths['/api/v1/reports/{reportId}'].get.responses['200'];
  const exs = rep200.content['application/json'].examples;
  const vals = Object.values(exs).map((e) => e.value.data);
  assert(
    vals.length > 0 && vals.every((v) => v && v.lockState),
    `依赖 1：全部报告响应示例均含 lockState（${vals.length} 个示例）`
  );
}

// 依赖 2（安全）：确认请求体不得含确认人/确认时间
const confirmBody = deref(
  doc.paths['/api/v1/segmentation-tasks/{taskId}/confirm'].post.requestBody.content[
    'application/json'
  ].schema
);
const itemProps = Object.keys(confirmBody.properties.items.items.properties);
for (const forbidden of ['confirmedBy', 'confirmed_by', 'confirmedAt', 'confirmed_at', 'author', 'operator']) {
  assert(!itemProps.includes(forbidden), `依赖 2：确认项不含 ${forbidden}（身份由服务端从会话取）`);
  assert(!Object.keys(confirmBody.properties).includes(forbidden), `依赖 2：请求体顶层不含 ${forbidden}`);
}
assert(
  confirmBody.additionalProperties === false &&
    confirmBody.properties.items.items.additionalProperties === false,
  '依赖 2：两层 additionalProperties:false，客户端传确认人会被拒'
);
assert(
  /确认人身份不由前端传入/.test(confirmBody.description || ''),
  '依赖 2：schema description 说明身份来源为服务端会话'
);
const confirmResp = deref(
  okSchema(doc.paths['/api/v1/segmentation-tasks/{taskId}/confirm'].post, '200').properties.data
);
assert(
  confirmResp.required.includes('confirmedAt'),
  '依赖 2：响应回带服务端 confirmedAt（证明服务端确实记录）'
);
assert(
  !!confirmResp.properties.pendingSupervisorReview,
  '依赖 2：实习医师确认标记存在（报告提交阻断依据）'
);

// 依赖 3：payload 自由对象
const payload = doc.components.schemas.PlanPayload;
assert(
  payload.additionalProperties === true,
  '依赖 3：PlanPayload 为自由对象（后端不解析语义，不绑死前端迭代）'
);
assert(
  /后端只做存储与乐观锁，\*\*不解析语义\*\*/.test(payload.description || ''),
  '依赖 3：payload 描述声明后端不校验内部语义'
);
assert(
  /screws/.test(payload.description || '') && /entry_points/.test(payload.description || ''),
  '依赖 3：payload 描述含设计师的骨科字段示例（screws / entry_points）'
);

// 依赖 4：派生值服务端下发
const studyItem = doc.components.schemas.StudyListItem;
assert(
  studyItem.required.includes('queueWaitSeconds'),
  '依赖 4：queueWaitSeconds 为必填（前端不重算）'
);
assert(
  /前端不得重算/.test(studyItem.properties.queueWaitSeconds.description || ''),
  '依赖 4：queueWaitSeconds 描述明确禁止前端重算'
);
assert(
  studyItem.properties.queueWaitSeconds.nullable === true,
  '依赖 4：queueWaitSeconds 可为 null（未归档完成时显示占位而非 0）'
);
assert(
  studyItem.properties.queueWaitSeconds.type === 'integer' &&
    studyItem.properties.queueWaitSeconds.minimum === 0,
  '依赖 4：queueWaitSeconds 为非负整数秒（口径唯一，避免时区分歧）'
);
assert(
  studyItem.required.includes('readStatus'),
  '依赖 4：readStatus 必填（待阅/已阅 Tab 的数据依据）'
);
assert(
  studyItem.required.includes('isEmergency'),
  '依赖 4：isEmergency 必填（危急值三重编码由服务端下发）'
);
{
  const s = schemaSql();
  assert(
    /read_status\s+varchar\(16\)\s+NOT NULL DEFAULT 'unread'/.test(s),
    '依赖 4：studies.read_status 落库（工作量统计唯一数据源）'
  );
  assert(/ck_studies_read_complete CHECK/.test(s), '依赖 4：已阅必须有 read_at 的 CHECK 约束');
  assert(/idx_studies_unread_queue/.test(s), '依赖 4：待阅队列部分索引（列表 3 秒内）');
}

// 40003 拒绝详情：许可信息 + 审计留痕
const lic = doc.components.schemas.ModelLicenseRejectedDetail;
assert(!!lic, '40003 拒绝详情 schema 存在');
if (lic) {
  for (const f of ['requestedModel', 'requestedLicense', 'rejectionReason', 'allowedModels', 'auditRecorded']) {
    assert(lic.required.includes(f), `40003 详情必填：${f}（UIUX-P2 §4.3 拒绝态所需）`);
  }
}
assert(
  /'segmentation_task_rejected'/.test(sql),
  '40003 拒绝写审计（AC-09：白名单拒绝本身是合规事件）'
);

// 10004/10005 UI 强约束
const hiddenDesc = doc.components.responses.ErrPatientScopeHidden.description || '';
assert(
  /禁止.{0,10}出现「该患者不存在」/.test(hiddenDesc),
  '10004：description 明确禁止泄露性文案'
);
assert(
  /tabler:lock-access/.test(hiddenDesc) && /而非\s*`?tabler:alert-triangle/.test(hiddenDesc),
  '10004：指定 lock-access 图标并排除 alert-triangle（区分权限边界 vs 故障）'
);
assert(
  /共用同一套 UI/.test(hiddenDesc) || /禁止.{0,6}区分渲染/.test(hiddenDesc),
  '10004：越权与不存在共用同一套 UI，禁止区分渲染'
);

/* 输出 ------------------------------------------------------------------- */
console.log('通过断言：' + passes.length);
console.log('失败断言：' + failures.length);
if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('openapi.yaml 契约自检全部通过。');