/**
 * L3 数据权限判定的 SQL 片段。
 *
 * ## 唯一依据
 *
 * `docs/db/schema.sql` 中 `patient_grants.granted_by` 的 COMMENT ON COLUMN
 * （架构方案 §10.1）。该注释写明「本 COMMENT 是实现的唯一依据」，
 * 本模块严格按其 5 条规则实现。
 *
 * ## 铁律：判定必须全部下推到 SQL
 *
 * schema.sql 原文：
 *   > 1. 判定必须**全部下推到 SQL 的 WHERE 子句**，禁止先查全量再在应用层过滤。
 *   >    应用层过滤既无法正确分页（total 会泄露全库规模），
 *   >    也会泄露患者存在性（PRD COM-03）。
 *
 * 因此本模块输出的是**可直接嵌入 WHERE 的布尔表达式**，
 * 由各 repository 拼进查询，而不是在 service 里做行过滤。
 *
 * ## 规则 5（实习/试用期医师）的额外约束
 *
 * 原文：
 *   > U 拥有 trainee_physician 角色时额外约束：不可跨科室；
 *   > 访问非本人经手的研究必须有本表记录（即规则 4）
 *
 * 翻译成布尔式（记 G=全局角色, D=科室规则, R=报告医师规则, X=授权规则,
 * D'=仅本科室规则，不含病区跨科室）：
 *   实习医师： X OR (D' AND R)
 *   其他角色： G OR D OR R OR X
 *
 * 实习医师**不享有** G（全局可见）与 D（含病区跨科室）。
 */

/** 参与判定的用户上下文 */
export interface AccessContext {
  /** users.id（uuid） */
  userId: string;
  /** users.department_code */
  departmentCode: string;
  /** 是否拥有 quality_control / medical_records / system_admin */
  globalScope: boolean;
  /** 是否为实习/试用期医师 */
  isTrainee: boolean;
}

export interface SqlFragment {
  /** SQL 片段，含 $1 $2 ... 占位符（片段内部从 $1 开始编号） */
  sql: string;
  /** 与占位符一一对应的参数值 */
  values: unknown[];
}

/**
 * 生成患者可见性谓词。
 *
 * @param patientColumn 患者 id 列的引用（如 `s.patient_id`）。
 *                      由调用方拼接，**必须是代码内的常量**，不得来自用户输入。
 * @param ctx 访问者上下文
 */
export function patientVisibilityPredicate(
  patientColumn: string,
  ctx: AccessContext
): SqlFragment {
  // 片段内部固定从 $1 开始编号；andWhere 会自动整体平移，
  // 调用方无需（也不应）手工处理占位符偏移。
  const pUser = 1;
  const pDept = 2;
  const pGlobal = 3;
  const pTrainee = 4;

  // patient_grants 没有 deleted_at —— 撤销走 revoked_at（授权记录永久保留，
  // 撤销后仍须可追溯「谁在何时凭什么访问过这个患者」）。
  const grantRule = `EXISTS (
      SELECT 1 FROM patient_grants g
       WHERE g.patient_id = ${patientColumn}
         AND g.user_id = $${pUser}
         AND g.revoked_at IS NULL
         AND (g.expires_at IS NULL OR g.expires_at > now())
    )`;

  const reportRule = `EXISTS (
      SELECT 1 FROM reports r
        JOIN studies s2 ON s2.id = r.study_id
       WHERE s2.patient_id = ${patientColumn}
         AND r.deleted_at IS NULL
         AND (r.report_doctor_id = $${pUser} OR r.review_doctor_id = $${pUser})
    )`;

  const deptRule = `EXISTS (
      SELECT 1 FROM visits v
       WHERE v.patient_id = ${patientColumn}
         AND v.deleted_at IS NULL
         AND (v.dept = $${pDept}
              OR (v.is_inpatient AND v.ward_dept = $${pDept}))
    )`;

  const deptStrictRule = `EXISTS (
      SELECT 1 FROM visits v
       WHERE v.patient_id = ${patientColumn}
         AND v.deleted_at IS NULL
         AND v.dept = $${pDept}
    )`;

  const sql = `(
    CASE WHEN $${pTrainee}::boolean THEN
      ( ${grantRule} OR ( ${deptStrictRule} AND ${reportRule} ) )
    ELSE
      ( $${pGlobal}::boolean OR ${deptRule} OR ${reportRule} OR ${grantRule} )
    END
  )`;

  return {
    sql,
    values: [ctx.userId, ctx.departmentCode, ctx.globalScope, ctx.isTrainee],
  };
}

export interface WhereClause {
  sql: string;
  values: unknown[];
}

/**
 * 把若干条件用 AND 连接。
 *
 * **自动平移占位符**：每个片段内部都从 $1 开始编号，这里按已累积的
 * 参数个数整体后移。手工平移是手写参数化 SQL 最常见的沉默逻辑错误
 * （参数串位 -> 查询条件错位 -> 越权或误拒），因此这里做成自动的，
 * 调用方没有机会忘记。
 */
export function andWhere(...clauses: (SqlFragment | null | undefined)[]): WhereClause {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const clause of clauses) {
    if (!clause) continue;
    const offset = values.length;
    parts.push(
      offset === 0
        ? clause.sql
        : clause.sql.replace(/\$(\d+)/g, (_m, digits: string) => `$${Number(digits) + offset}`)
    );
    values.push(...clause.values);
  }
  return { sql: parts.join(' AND '), values };
}

/** 恒真条件（用于「无附加限制」的情形，保证 SQL 形状稳定） */
export function alwaysTrue(): SqlFragment {
  return { sql: 'TRUE', values: [] };
}

/** 恒假条件 */
export function alwaysFalse(): SqlFragment {
  return { sql: 'FALSE', values: [] };
}

/**
 * 简单等值条件。
 *
 * @param column 列名。**必须**是代码内常量（防注入：列名无法参数化）
 * @param value  值。走占位符
 */
export function eq(column: string, value: unknown): SqlFragment {
  return { sql: `${column} = $1`, values: [value] };
}

/** 简单 IN 条件。空数组时返回恒假，避免 `IN ()` 的语法错误 */
export function inArray(column: string, values: readonly unknown[]): SqlFragment {
  if (values.length === 0) return alwaysFalse();
  const placeholders = values.map((_v, i) => `$${i + 1}`).join(', ');
  return { sql: `${column} IN (${placeholders})`, values: [...values] };
}
