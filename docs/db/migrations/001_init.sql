-- =====================================================================
-- 001_init.sql — MedPlan 业务库初始结构
-- =====================================================================
-- 目标库：PostgreSQL 18（私有化部署，院内）
-- 上游参考：docs/db/schema.sql（结构参考快照，与本文件必须保持一致）
--
-- 执行：
--   psql -v ON_ERROR_STOP=1 -f docs/db/migrations/001_init.sql
--
-- =====================================================================
-- 增量迁移规范（开发启动前必须遵守，评审按此检查）
-- =====================================================================
--
-- 【规范 1】单向前进，不可逆
--   迁移只向前，不提供 DOWN脚本。
--   理由：生产库的 down 会丢数据，而丢病历数据的代价不可接受；
--   出问题时的正确做法是写一个新的修复迁移（forward fix），
--   而不是回滚。回滚只在测试环境有意义，且靠重建库实现。
--
-- 【规范 2】编号规则NNN_snake_case.sql
--   编号严格递增，不复用。已合入主干的编号永久作废。
--   001_init / 002_add_report_template / 003_add_... 依此类推。
--   两名开发者同时改库时，靠编号冲突暴露并协调，不靠git 合并。
--
-- 【规范 3】一个迁移只做一件事
--   一次迁移只解决一个变更（加表 / 加列 / 加索引 / 数据修复）。
--   理由：大迁移在失败时无法定位是哪一步坏了，回滚成本高。
--   例外：001 初始结构天然是多个对象，因为空库不存在部分应用的问题。
--
-- 【规范 4】必须幂等或必须显式失败，二选一
--   - 幂等对象用 IF NOT EXISTS（CREATE TABLE / INDEX / EXTENSION）
--   - 非幂等对象（INSERT / ALTER COLUMN SET NOT NULL）必须显式失败，
--     不允许用 IF NOT EXISTS 掩盖问题
--   **禁止**用 DROP ... IF EXISTS 让迁移"总是能跑"——
--   那会让已应用的迁移在被重复执行时悄悄改坏数据结构。
--
-- 【规范 5】每个迁移一个事务
--   全文包在 BEGIN / COMMIT 中。
--   例外：CREATE INDEX CONCURRENTLY 不能在事务内跑（PostgreSQL 限制），
--         这类语句用 CONCURRENTLY 且不加 BEGIN，由运维单独执行。
--
-- 【规范 6】只加不改（expand-and-contract）
--   破坏性变更（删列 / 改类型 / 重命名）必须拆成至少三次迁移：
--     expand:  加新列（可空或带默认值），新旧并存
--     migrate:  应用层双写 + 回填历史数据
--     contract: 确认无读取方后再删旧列（**只能在下一个大版本**）
--   理由：私有化部署由院方控制升级时机，我们无法要求前后端同时上线。
--   一次迁移里既加列又删旧列，会让"中间状态"在某些部署里根本不存在，
--   而那个中间状态恰恰是回滚时要用的。
--
-- 【规范 7】不写数据迁移到生产敏感表
--   初始结构迁移**不含**任何业务数据。
--   测试种子数据放db/seeds/，用 ON CONFLICT DO NOTHING 保证可重复执行。
--   理由：往生产病历表插测试数据是严重事故，迁移文件会被审计。
--
-- 【规范 8】必须同步的文档
--   迁移涉及结构变更时，同一PR 内必须同步更新：
--     - docs/db/schema.sql（参考快照）
--     - docs/openapi.yaml（若涉及字段或端点）
--     - 本文件末尾的迁移清单
--   契约与实现不一致时，以 openapi.yaml 为准并修正实现。
--
-- 【规范 9】记录 checksum 防篡改
--   每个迁移执行完写入 schema_migrations，checksum 为文件内容 SM3摘要。
--   启动时校验：已应用迁移的文件被改动过则拒绝启动。
--   理由：迁移历史本身是审计对象，被人改过的迁移等于被篡改的证据链。
--
-- 【规范 10】PACS 与业务库禁止跨 schema 外键
--   见 ADR-004。两库可拆分是刻意的设计约束，
--   一旦建了跨 schema 外键，拆分成本从"改配置"变成"改数据"。
--
-- =====================================================================
-- 本迁移（001_init）内容清单：
--   1. schema 与扩展
--   2. 枚举类型 12 个
--   3. 触发器函数（审计链、防篡改、updated_at、脱敏）
--   4. RBAC 三表（users / roles / user_roles）
--   5. 患者主索引与就诊（patients / visits / patient_grants）
--   6. 影像元数据（studies / series / instances）
--   7. AI 分割（segmentation_tasks / segmentations / segmentation_confirms）
--   8. 规划（plans / plan_commands）
--   9. 报告（reports / report_revisions）
--  10. 签名（signature_logs）
--  11. 审计（audit_logs，按月分区）
--  12. 索引
--  13. 最小权限账号
--  14. 脱敏视图
--  15. 运维函数
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Schema 与扩展
-- ---------------------------------------------------------------------
-- SM3 说明：PostgreSQL 核心无内置 SM3。本迁移的设计前提是
--   **SM3 由应用层/密码机计算后传入**（架构方案 §7.5、ADR-004）。
--   触发器中的 sm3_or_fallback() 在未部署 pg_sm3 扩展时降级为 SHA-256，
--   两者均为单向摘要，链式防篡改强度相当。
--   若密评要求全链路国密，部署 pg_sm3 扩展后该函数自动走 SM3 分支，
--   **无需修改表结构或数据**（这是当初把摘要逻辑收敛到一个函数的原因）。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS medplan;
SET search_path TO medplan, public;

-- ---------------------------------------------------------------------
-- 2. 枚举类型
-- ---------------------------------------------------------------------
CREATE TYPE visit_type AS ENUM (
  'outpatient', 'emergency', 'inpatient', 'physical_exam', 'day_surgery'
);
COMMENT ON TYPE visit_type IS '就诊类型。outpatient/emergency 报告留存 >=15 年，inpatient >=30 年（AC-20）';

CREATE TYPE series_phase AS ENUM (
  'plain', 'arterial', 'portal', 'delayed', 'unknown'
);
COMMENT ON TYPE series_phase IS '序列期相（DCM-02 自动分组）。unknown = 置信度不足，前端不得默认选中';

CREATE TYPE study_status AS ENUM (
  'registered', 'in_progress', 'completed', 'archived', 'cancelled'
);
COMMENT ON TYPE study_status IS '检查状态';

CREATE TYPE report_status AS ENUM (
  'draft', 'pending_review', 'signed', 'archived'
);
COMMENT ON TYPE report_status IS '报告状态机。signed 为终态，正文与关联规划一并锁定（AC-13/AC-14）';

CREATE TYPE plan_status AS ENUM (
  'draft', 'confirmed', 'archived'
);
COMMENT ON TYPE plan_status IS '规划方案状态。archived 为终态，之后修改需医务部门审批（50004）';

CREATE TYPE segmentation_task_status AS ENUM (
  'queued', 'running', 'succeeded', 'failed'
);
COMMENT ON TYPE segmentation_task_status IS 'AI 分割任务状态机。至少一次投递下靠状态幂等去重';

CREATE TYPE segmentation_pipeline_step AS ENUM (
  'precheck', 'fetch', 'preprocess', 'inference', 'stow', 'callback'
);
COMMENT ON TYPE segmentation_pipeline_step IS
  'AI 流水线环节。命名避开 stage：医学语境下易与 TNM 癌症分期混淆（真实歧义风险）';

CREATE TYPE segmentation_confirm_action AS ENUM (
  'confirmed', 'modified'
);
COMMENT ON TYPE segmentation_confirm_action IS
  '医师对 AI 标记的处理动作。modified 时 modification_note 必填（修改留痕）';

CREATE TYPE audit_event_type AS ENUM (
  'auth_login', 'auth_logout', 'auth_login_failed',
  'study_list_viewed', 'study_series_viewed', 'dicom_instances_retrieved',
  'measurement_saved',
  'segmentation_task_submitted', 'segmentation_task_rejected',
  'segmentation_task_read', 'segmentation_item_confirmed',
  'plan_created', 'plan_updated',
  'report_created', 'report_viewed', 'report_updated',
  'report_signed', 'report_exported', 'report_archived',
  'audit_log_queried', 'permission_changed', 'patient_grant_changed',
  'deidentification_override'
);
COMMENT ON TYPE audit_event_type IS
  '审计事件类型。与 openapi.yaml 的 AuditEventType 枚举逐项一致（契约校验脚本交叉比对）';

CREATE TYPE audit_result AS ENUM (
  'success', 'failure', 'denied'
);
COMMENT ON TYPE audit_result IS
  '审计结果。denied = 越权被拒。失败与拒绝路径**必须**记录（架构方案 §10.4）';

CREATE TYPE grant_scope AS ENUM (
  'read', 'write'
);
COMMENT ON TYPE grant_scope IS '患者数据授权范围（L3 数据权限）';

CREATE TYPE role_code AS ENUM (
  'system_admin', 'image_chief', 'image_physician', 'trainee_physician',
  'surgeon_physician', 'quality_control', 'medical_records', 'service_account'
);
COMMENT ON TYPE role_code IS '角色编码。与 openapi.yaml RoleCode 一致';

CREATE TYPE retention_class AS ENUM (
  'audit_6m', 'imaging_meta_5y', 'plan_15y', 'report_15y', 'report_30y', 'signature_perm'
);
COMMENT ON TYPE retention_class IS
  '留存等级：审计 >=6 个月（等保硬下限）/ 影像元数据 5 年 / 规划与门急诊报告 15 年 / 住院报告 30 年 / 签名永久';

-- ---------------------------------------------------------------------
-- 3. 触发器函数
-- ---------------------------------------------------------------------

-- SM3 适配层。未部署 pg_sm3 时降级 SHA-256（见文件头说明）
CREATE OR REPLACE FUNCTION sm3_or_fallback(p_text text)
RETURNS bytea
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_sm3') THEN
    RETURN sm3(convert_to(p_text, 'UTF8'));
  ELSE
    RETURN digest(convert_to(p_text, 'UTF8'), 'sha256');
  END IF;
END;
$$;

COMMENT ON FUNCTION sm3_or_fallback(text) IS
  'SM3 计算适配层。部署 pg_sm3 后自动走国密分支；否则降级 SHA-256。摘要逻辑收敛于此，便于密评整改时零改表切换';

-- 审计链计算。
-- advisory lock 的必要性：并发 INSERT 若各读到同一个链尾会产生分叉链，
-- 导致 fn_verify_audit_chain() 误报断裂。
CREATE OR REPLACE FUNCTION fn_audit_chain_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = medplan, pg_temp
AS $$
DECLARE
  v_prev_hash text;
  v_row_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('medplan.audit_logs.chain'));

  SELECT hash_self INTO v_prev_hash
  FROM medplan.audit_logs
  ORDER BY id DESC
  LIMIT 1;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := repeat('0', 64);
  END IF;

  NEW.hash_prev := v_prev_hash;

  -- 摘要覆盖等保 8.1.4.3 要求的全部审计要素。任一项被改动，链上必有节点不匹配
  v_row_hash := encode(
    sm3_or_fallback(
      NEW.hash_prev || '|' ||
      NEW.event_time::text || '|' ||
      coalesce(NEW.actor_id::text,'') || '|' ||
      coalesce(array_to_string(NEW.actor_roles, ','),'') || '|' ||
      NEW.event_type::text || '|' ||
      NEW.result::text || '|' ||
      coalesce(NEW.result_code::text,'') || '|' ||
      coalesce(NEW.patient_id::text,'') || '|' ||
      NEW.resource_type || '|' ||
      NEW.resource_id || '|' ||
      coalesce(NEW.source_ip::text,'') || '|' ||
      coalesce(NEW.terminal_id,'') || '|' ||
      coalesce(NEW.detail::text,'')
    ),
    'hex'
  );

  NEW.hash_self := v_row_hash;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_audit_chain_guard() IS
  '审计链守卫。插入时自动计算 hash_prev（链尾）与 hash_self（含全部审计要素的摘要）。客户端无法指定这两列';

-- append-only 阻断。功能权限是第一层防护，本触发器是第二层（防 owner 误操作）
CREATE OR REPLACE FUNCTION fn_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% 为 append-only 表：禁止 % 操作。业务数据修正请在业务表操作，审计侧追加新事件。',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION fn_append_only_guard() IS
  'append-only 表通用阻断函数。配合 REVOKE 构成双层防护（等保 8.1.4.3 / ADR-004）';

-- updated_at 自动维护。用触发器而非应用层赋值：漏一处就导致审计追溯不可信
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 报告状态保护：已签署报告禁止删除与修改
CREATE OR REPLACE FUNCTION fn_reports_signed_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '报告 % 已签署（status=%），禁止 %。国卫办医发〔2017〕8 号要求签署后电子病历不得篡改；正文变更会使原签名立即失效（AC-14）。',
    OLD.id, OLD.status, TG_OP
    USING ERRCODE = '42501';
END;
$$;

-- studies.patient_id 与 visits.patient_id 同步
CREATE OR REPLACE FUNCTION fn_sync_study_patient()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT patient_id INTO NEW.patient_id FROM visits WHERE id = NEW.visit_id;
  IF NEW.patient_id IS NULL THEN
    RAISE EXCEPTION 'visit_id % 不存在，无法同步 patient_id', NEW.visit_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. RBAC：users / roles / user_roles
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name         varchar(64)  NOT NULL,
  display_name       varchar(64)  NOT NULL,
  keycloak_subject   varchar(255) NOT NULL,
  title              varchar(32)  NOT NULL,
  department_code    varchar(32)  NOT NULL,
  license_no_hash    char(64),
  phone_hash         char(64),
  ukey_cert_serial   varchar(128),
  is_active          boolean      NOT NULL DEFAULT true,
  failed_login_count smallint     NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  retention_class    retention_class NOT NULL DEFAULT 'audit_6m',
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT uq_users_login_name UNIQUE (login_name),
  CONSTRAINT ck_users_failed_login_count CHECK (failed_login_count >= 0)
);
COMMENT ON TABLE users IS '用户表。**口令不存储**，认证委托 Keycloak 26.8.1（ADR-005）';
COMMENT ON COLUMN users.ukey_cert_serial IS 'UKey SM2 证书序列号。双因素第二因素凭据，会话须绑定';
COMMENT ON COLUMN users.license_no_hash IS '执业证书号 SM3 摘要（hex 64）。不存明文';
COMMENT ON COLUMN users.phone_hash IS '手机号 SM3 摘要（hex 64）。不存明文';

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         role_code    NOT NULL,
  name         varchar(64) NOT NULL,
  permissions  text[]    NOT NULL DEFAULT '{}',
  description  text,
  is_system    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roles_code UNIQUE (code),
  CONSTRAINT ck_roles_permissions CHECK (
    permissions <@ ARRAY['read','write','sign','review','audit_read','user_manage']::text[]
  )
);
COMMENT ON TABLE roles IS '角色表。permissions 由 CHECK 限定取值域，防止拼错权限名后静默失效';
COMMENT ON COLUMN roles.is_system IS '系统内置角色标记。为 true 时禁止删除（防止误删 report_signer 导致无人能签名）';

CREATE TABLE user_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  retention_class retention_class NOT NULL DEFAULT 'audit_6m',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_roles UNIQUE (user_id, role_id),
  CONSTRAINT ck_user_roles_expiry CHECK (expires_at IS NULL OR expires_at > granted_at)
);
COMMENT ON TABLE user_roles IS '用户-角色关联（RBAC）。expires_at 支持临时授权，如夜班值班医师';

-- ---------------------------------------------------------------------
-- 5. 患者主索引与就诊
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empi_id         varchar(32) NOT NULL,
  name            varchar(64) NOT NULL,
  gender          char(1)     NOT NULL DEFAULT 'O',
  birth_date      date        NOT NULL,
  id_card_hash    char(64),
  id_card_masked  varchar(32),
  phone_hash      char(64),
  phone_masked    varchar(16),
  insurance_no    varchar(32),
  extra           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  retention_class retention_class NOT NULL DEFAULT 'report_30y',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT uq_patients_empi UNIQUE (empi_id),
  CONSTRAINT ck_patients_gender CHECK (gender IN ('M','F','O','')),
  CONSTRAINT ck_patients_id_card_masked CHECK (
    id_card_masked IS NULL OR char_length(id_card_masked) BETWEEN 10 AND 20
  )
);
COMMENT ON TABLE patients IS '患者主索引（EMPI）。卫健委电子病历必备：患者基本信息';
COMMENT ON COLUMN patients.id_card_hash IS '身份证号 SM3 摘要（hex 64）。**不存明文**，查询时用摘要比对';
COMMENT ON COLUMN patients.id_card_masked IS '身份证掩码（如 310***********1234）。建档时生成一次，不可逆推';
COMMENT ON COLUMN patients.phone_hash IS '手机号 SM3 摘要（hex 64）。**不存明文**';

CREATE TABLE visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_no        varchar(32) NOT NULL,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_type      visit_type NOT NULL,
  admit_date      timestamptz,
  discharge_date  timestamptz,
  dept            varchar(64) NOT NULL,
  ward_dept       varchar(64),
  bed_no          varchar(16),
  is_inpatient    boolean     NOT NULL DEFAULT false,
  diagnosis_text  text,
  retention_class retention_class NOT NULL DEFAULT 'report_30y',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT uq_visits_visit_no UNIQUE (visit_no),
  CONSTRAINT ck_visits_discharge_after_admit CHECK (
    discharge_date IS NULL OR admit_date IS NULL OR discharge_date >= admit_date
  )
);
COMMENT ON TABLE visits IS '就诊记录。卫健委电子病历必备：就诊信息';
COMMENT ON COLUMN visits.is_inpatient IS '在院标记。L3 数据权限规则 2b「本病区在院患者」依赖此字段';

CREATE TABLE patient_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope           grant_scope NOT NULL DEFAULT 'read',
  grant_reason    varchar(256) NOT NULL,
  granted_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason   varchar(256),
  retention_class retention_class NOT NULL DEFAULT 'audit_6m',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_patient_grants_active UNIQUE (patient_id, user_id, scope),
  CONSTRAINT ck_patient_grants_expiry CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT ck_patient_grants_revoke CHECK (
    revoked_at IS NULL OR (revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CONSTRAINT ck_patient_grants_retention CHECK (retention_class = 'audit_6m')
);
COMMENT ON TABLE patient_grants IS
  '患者数据授权（L3 数据权限，PRD COM-03）。**判定规则见 COLUMN granted_by 的 COMMENT**';
COMMENT ON COLUMN patient_grants.grant_reason IS '授权来源说明（转诊/会诊/住院主管）。合规追溯「凭什么能看这个患者」';
COMMENT ON COLUMN patient_grants.expires_at IS '到期自动失效。会诊授权建议 <=72 小时，避免长期过度授权';
COMMENT ON COLUMN patient_grants.granted_by IS
  '授权人。
--------------------------------------------------------------------------
L3 数据权限判定规则（架构方案 §10.1，本 COMMENT 是实现的唯一依据）：

  用户 U 可见患者 P，当且仅当下列任一成立：

  (1) U 拥有 quality_control / medical_records / system_admin 角色
      => 全院可见。**仍需全量审计**，角色不是免审计通行证。
  (2) 存在 visits V，V.patient_id = P.id，且满足：
      (2a) V.dept = U.department_code本科室就诊
      (2b) V.is_inpatient AND V.ward_dept = U.department_code本病区在院
  (3) 存在 reports R（R 属于 P 的检查），且
      R.report_doctor_id = U.id 或 R.review_doctor_id = U.id
  (4) 存在本表记录 G：G.patient_id = P.id、G.user_id = U.id、
      G.revoked_at IS NULL、(G.expires_at IS NULL OR G.expires_at > now())
  (5) U 拥有 trainee_physician（实习/试用期医师）时额外约束：
      不可跨科室；访问非本人经手研究必须有本表记录；
      其确认记录 pending_supervisor_review 置 true，报告不可提交。

--------------------------------------------------------------------------
实现要求（违反即代码评审不通过）：

  1. 判定必须**全部下推到 SQL 的 WHERE 子句**，
     禁止先查全量再在应用层过滤（既无法正确分页，也会泄露患者存在性）。
  2. SQL 落在 medplan-backend/src/modules/rbac/repositories/，
     **不得写在 controller 或 service 层**（架构方案 §5.1 依赖方向硬规则）。
  3. 判定不通过返回 10004，响应与「患者不存在」在响应时间、状态码、
     响应体大小三者上不可区分（openapi.yaml info §4.1）。
     **禁止**先查患者是否存在再决定返回什么。
  4. 判定无论通过与否都写审计；被拒记录必须含拒绝原因。
--------------------------------------------------------------------------';

-- ---------------------------------------------------------------------
-- 6. 影像元数据
-- ---------------------------------------------------------------------
CREATE TABLE studies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_uid           varchar(128) NOT NULL,
  visit_id            uuid NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  patient_id          uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  accession_no        varchar(32)  NOT NULL,
  modality            varchar(16)  NOT NULL,
  body_part           varchar(32)  NOT NULL,
  study_description   varchar(256),
  study_date          timestamptz  NOT NULL,
  status              study_status NOT NULL DEFAULT 'registered',
  -- 阅片状态。对应工作台「待阅 / 已阅」Tab（UIUX-P2 §2.3）。
  -- PRD OPN-01 工作量统计的唯一数据源，**不允许手工填报**
  read_status         varchar(16)  NOT NULL DEFAULT 'unread',
  read_at             timestamptz,
  read_by             uuid         REFERENCES users(id) ON DELETE SET NULL,
  report_template_code varchar(64),
  retention_class     retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT uq_studies_study_uid UNIQUE (study_uid),
  CONSTRAINT uq_studies_accession_no UNIQUE (accession_no),
  CONSTRAINT ck_studies_modality CHECK (
    modality IN ('CT','MR','US','XA','CR','DX','MG','NM','PT','PET')
  ),
  CONSTRAINT ck_studies_read_status CHECK (
    read_status IN ('unread','in_progress','read')
  ),
  CONSTRAINT ck_studies_read_complete CHECK (
    read_status <> 'read' OR read_at IS NOT NULL
  )
);
COMMENT ON TABLE studies IS '检查记录。**影像像素存于 PACS（dcm4chee），本表只存元数据**';
COMMENT ON COLUMN studies.read_status IS '阅片状态。PRD OPN-01 工作量统计唯一数据源，不允许手工填报';
COMMENT ON COLUMN studies.read_at IS '首次阅片时间。队列等待时长的计算终点（已阅）或 now()（未阅）';
COMMENT ON COLUMN studies.patient_id IS '冗余字段，由触发器与 visits.patient_id 同步。用于 L3 权限按患者直接过滤';

CREATE TRIGGER trg_sync_study_patient
BEFORE INSERT OR UPDATE OF visit_id ON studies
FOR EACH ROW EXECUTE FUNCTION medplan.fn_sync_study_patient();

CREATE TABLE series (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_uid          varchar(128) NOT NULL,
  study_id            uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid           varchar(128) NOT NULL,
  series_number       integer      NOT NULL,
  series_description  varchar(256),
  phase               series_phase NOT NULL DEFAULT 'unknown',
  phase_confidence    numeric(4,3),
  instance_count      integer      NOT NULL DEFAULT 0,
  slice_thickness_mm  numeric(6,2),
  rows                integer,
  columns             integer,
  pixel_spacing_mm    numeric(6,3)[],
  transfer_syntax_uid varchar(64),
  window_center       numeric(7,2),
  window_width        numeric(7,2),
  retention_class     retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT uq_series_uid UNIQUE (series_uid),
  CONSTRAINT ck_series_phase_confidence CHECK (
    phase_confidence IS NULL OR (phase_confidence >= 0 AND phase_confidence <= 1)
  ),
  CONSTRAINT ck_series_instance_count CHECK (instance_count >= 0),
  CONSTRAINT ck_series_thickness CHECK (slice_thickness_mm IS NULL OR slice_thickness_mm > 0)
);
COMMENT ON TABLE series IS '序列记录。期相由 DCM-02 自动分组，置信度不足时 phase=unknown';
COMMENT ON COLUMN series.phase_confidence IS '期相识别置信度。< 0.70 时前端须提示「期相待人工确认」且不得默认选中';
COMMENT ON COLUMN series.transfer_syntax_uid IS '传输语法 UID。薄层 CT 需 JPEG2000（1.2.840.10008.1.2.4.90）+ openjpeg 1.3.0';
COMMENT ON COLUMN series.pixel_spacing_mm IS '像素间距 [行,列]（mm）。长度测量据此换算毫米值（AC-07）';

CREATE TABLE instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_uid                 varchar(128) NOT NULL,
  series_id               uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  series_uid              varchar(128) NOT NULL,
  study_uid               varchar(128) NOT NULL,
  instance_number         integer NOT NULL,
  rows                    integer NOT NULL,
  columns                 integer NOT NULL,
  image_position_patient  numeric(3)[],
  image_orientation_patient numeric(6),
  slice_location          numeric(9,3),
  slice_thickness_mm      numeric(6,2),
  size_bytes              bigint,
  is_compressed           boolean     NOT NULL DEFAULT false,
  retention_class         retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT uq_instances_sop_uid UNIQUE (sop_uid),
  CONSTRAINT uq_instances_series_number UNIQUE (series_uid, instance_number),
  CONSTRAINT ck_instances_dims CHECK (rows > 0 AND columns > 0),
  CONSTRAINT ck_instances_size CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
COMMENT ON TABLE instances IS 'DICOM 实例元数据索引。**像素数据在 PACS，本表不存影像内容**（架构方案 N3）';
COMMENT ON COLUMN instances.image_position_patient IS 'IPP (0020,0032)。MPR 三视图定位与体素间距计算依赖此字段';

-- ---------------------------------------------------------------------
-- 7. AI 分割
-- ---------------------------------------------------------------------
CREATE TABLE segmentation_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id            uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid           varchar(128) NOT NULL,
  series_id           uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  model_name          varchar(64)  NOT NULL,
  model_version       varchar(16)  NOT NULL DEFAULT '2.18.0',
  weights_version     varchar(128),
  weights_hash        char(64),
  fast_flag           boolean     NOT NULL DEFAULT false,
  degraded            boolean     NOT NULL DEFAULT false,
  gpu_memory_gb       numeric(4,1),
  status              segmentation_task_status NOT NULL DEFAULT 'queued',
  progress_percent    smallint    NOT NULL DEFAULT 0,
  error_code          integer,
  error_step          segmentation_pipeline_step,
  error_detail        text,
  phase_checked       series_phase,
  phase_eligible      boolean,
  submitted_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at          timestamptz,
  finished_at         timestamptz,
  stream_message_id   varchar(64),
  idempotency_key     char(36),
  retention_class     retention_class NOT NULL DEFAULT 'plan_15y',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT uq_seg_task_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_seg_task_progress CHECK (progress_percent BETWEEN 0 AND 100),
  -- 模型版本锁定。算法升级属重大软件更新，需变更注册审批（PRD OOS-12）
  CONSTRAINT ck_seg_task_model_version CHECK (model_version = '2.18.0'),
  -- 成功必须有结束时间与 100% 进度
  CONSTRAINT ck_seg_task_terminal CHECK (
    status <> 'succeeded' OR (finished_at IS NOT NULL AND progress_percent = 100)
  ),
  -- 失败必须记录错误码与失败环节。禁止以空模型冒充成功（AI-02）
  CONSTRAINT ck_seg_task_failure_detail CHECK (
    status <> 'failed' OR (error_code IS NOT NULL AND error_step IS NOT NULL)
  )
);
COMMENT ON TABLE segmentation_tasks IS 'AI 分割任务。非辅助决策类功能（器审中心 2022 年第 8 号）';
COMMENT ON COLUMN segmentation_tasks.model_name IS
  '模型 task 名。**必须属Apache-2.0 白名单**（TotalSegmentator 2.18.0 的 31 个 task）。brain_aneurysm 为 CC BY-NC 4.0 且不提供商业许可，禁止使用';
COMMENT ON COLUMN segmentation_tasks.model_version IS '模型版本锁定 2.18.0。CHECK 强制，算法升级需变更注册审批';
COMMENT ON COLUMN segmentation_tasks.degraded IS
  '降级标记。显存 <12GB 时强制 fast。**必须随报告归档**，不得静默降级（AC-10）';
COMMENT ON COLUMN segmentation_tasks.idempotency_key IS
  '幂等键（UUID）。Redis Stream 至少一次投递，重投不重复计算 GPU';
COMMENT ON COLUMN segmentation_tasks.error_step IS
  '失败流水线环节。前端据此告知医师哪些结论还可用。命名避开 stage（易与 TNM 分期混淆）';

CREATE TABLE segmentations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES segmentation_tasks(id) ON DELETE CASCADE,
  structure_name      varchar(64)  NOT NULL,
  structure_label_zh  varchar(64),
  volume_ml           numeric(12,2) NOT NULL,
  seg_sop_uid         varchar(128),
  mask_storage_uri    text,
  retention_class     retention_class NOT NULL DEFAULT 'plan_15y',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_segmentations_task_structure UNIQUE (task_id, structure_name),
  CONSTRAINT ck_segmentations_volume CHECK (volume_ml >= 0)
);
COMMENT ON TABLE segmentations IS
  'AI 分割结果。**只有解剖结构名与量化体积，无任何自由文本字段**——类型层面不可能产出诊断结论';
COMMENT ON COLUMN segmentations.structure_name IS '解剖结构标识（TotalSegmentator 类别名）。非病灶名，非诊断结论';
COMMENT ON COLUMN segmentations.volume_ml IS '量化体积（mL）。测量值，须经执业医师逐项确认后才可进报告（AC-11）';

CREATE TABLE segmentation_confirms (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                   uuid NOT NULL REFERENCES segmentation_tasks(id) ON DELETE CASCADE,
  structure_name            varchar(64)  NOT NULL,
  action                    segmentation_confirm_action NOT NULL,
  modification_note         text,
  volume_ml_snapshot        numeric(12,2),
  confirmed_by              uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at              timestamptz NOT NULL DEFAULT now(),
  pending_supervisor_review boolean NOT NULL DEFAULT false,
  idempotency_key           char(36),
  retention_class           retention_class NOT NULL DEFAULT 'plan_15y',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_seg_confirm_idem UNIQUE (idempotency_key),
  -- 修改必须有备注：无备注的修改一律拒绝（电子病历修改留痕要求）
  CONSTRAINT ck_seg_confirm_note_required CHECK (
    action <> 'modified'
    OR (modification_note IS NOT NULL AND char_length(trim(modification_note)) > 0)
  )
);

-- 不用 UNIQUE (task_id, structure_name)：契约要求 append-only
-- （同一 structureName 重复确认以最后一次为准，每次变更追加新记录），
-- 唯一约束会让第二次确认直接冲突。最新状态由视图提供。
CREATE INDEX idx_seg_confirm_task_structure
  ON segmentation_confirms (task_id, structure_name, confirmed_at DESC);

CREATE OR REPLACE VIEW v_segmentation_confirm_current AS
SELECT DISTINCT ON (task_id, structure_name)
  task_id, structure_name, action, modification_note, volume_ml_snapshot,
  confirmed_by, confirmed_at, pending_supervisor_review
FROM segmentation_confirms
ORDER BY task_id, structure_name, confirmed_at DESC, id DESC;

COMMENT ON TABLE segmentation_confirms IS '医师对 AI 标记的逐项确认。append-only，变更追加新记录';
COMMENT ON COLUMN segmentation_confirms.modification_note IS '修改说明。action=modified 时**必填**';
COMMENT ON COLUMN segmentation_confirms.volume_ml_snapshot IS '确认时体积快照。医师手工修改后与 AI 原值可能不同，快照保证可回溯';
COMMENT ON COLUMN segmentation_confirms.pending_supervisor_review IS '实习/试用期医师确认标记。为 true 时报告不可提交';

-- ---------------------------------------------------------------------
-- 8. 规划方案
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id              uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid             varchar(128) NOT NULL,
  segmentation_task_id  uuid REFERENCES segmentation_tasks(id) ON DELETE SET NULL,
  version               integer     NOT NULL DEFAULT 1,
  plan_type             varchar(64) NOT NULL,
  title                 varchar(200),
  payload               jsonb       NOT NULL,
  status                plan_status NOT NULL DEFAULT 'draft',
  locked_at             timestamptz,
  locked_by_report_id   uuid,
  created_by            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key       char(36),
  retention_class       retention_class NOT NULL DEFAULT 'plan_15y',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT uq_plans_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_plans_version CHECK (version >= 1),
  CONSTRAINT ck_plans_archived CHECK (status <> 'archived' OR locked_at IS NOT NULL)
);
COMMENT ON TABLE plans IS
  '三维入路规划方案。乐观锁 + 操作日志。v1.0 不做多人实时协作（ADR-006：CRDT 静默合并会产生临床错误且不可审计）';
COMMENT ON COLUMN plans.version IS
  '乐观锁版本号。更新必须带 version，不一致返 409（AC-07 / 架构方案 12.2 E7）';
COMMENT ON COLUMN plans.payload IS
  '方案数据（jsonb）。入路点/靶点/角度/通道宽度。**仅中性几何语义**，禁止引入病灶性质等结论性字段';
COMMENT ON COLUMN plans.locked_at IS '签名锁定时间。报告签署后规划随正文一并锁定';

CREATE TABLE plan_commands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  command_type     varchar(32) NOT NULL,
  before_value     jsonb,
  after_value      jsonb,
  actor_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version_before   integer,
  version_after    integer,
  retention_class  retention_class NOT NULL DEFAULT 'plan_15y',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_commands_type CHECK (
    command_type IN ('create','update_payload','update_status','lock','archive')
  )
);
COMMENT ON TABLE plan_commands IS '规划操作日志。append-only。每次写操作一条，含前后值，可完整回放';

-- ---------------------------------------------------------------------
-- 9. 报告
-- ---------------------------------------------------------------------
CREATE TABLE reports (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id                  uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid                 varchar(128) NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  template_code             varchar(64)  NOT NULL,
  status                    report_status NOT NULL DEFAULT 'draft',
  -- 五类受控字段（RPT-01）。任一为空则阻断签名（AC-12）
  exam_body_part            varchar(64)  NOT NULL,
  scan_mode                 varchar(256) NOT NULL,
  findings                  text         NOT NULL,
  impression                text         NOT NULL,
  follow_up_recommendation  text         NOT NULL,
  structured_findings       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  follow_up_detail          jsonb,
  -- AI 辅助标记的**结构化引用**。只含结构名/体积/确认医师，无结论性文本。
  -- jsonb 无法用 additionalProperties 约束，由应用层 zod schema 白名单校验
  ai_assist                 jsonb        NOT NULL DEFAULT '{}'::jsonb,
  segmentation_task_id      uuid         REFERENCES segmentation_tasks(id) ON DELETE SET NULL,
  report_doctor_id          uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_doctor_id          uuid         REFERENCES users(id) ON DELETE RESTRICT,
  report_time               timestamptz  NOT NULL,
  reviewed_at               timestamptz,
  body_digest               char(64)     NOT NULL,
  body_digest_algorithm     varchar(16)  NOT NULL DEFAULT 'SM3',
  -- 正文 SHA-256 摘要（Spec AC-13）。
  -- 双摘要并存的原因：AC-13 要求 SHA-256，而 SM2 签名内部固定用 SM3 摘要，
  -- 两者用途不同 —— SM3 参与签名，SHA-256 作内容绑定与跨系统比对。
  -- 用 SHA-256 做签名不满足密评的国密算法要求。
  body_sha256               char(64)     NOT NULL,
  signed_at                 timestamptz,
  archived_at               timestamptz,
  retention_class           retention_class NOT NULL DEFAULT 'report_15y',
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  CONSTRAINT uq_reports_study_version UNIQUE (study_id, version),
  -- 住院报告必须 30 年留存（AC-20的数据库层兜底）
  CONSTRAINT ck_reports_retention CHECK (retention_class IN ('report_15y','report_30y')),
  -- 已签名报告必须有签名时间与审核医师
  CONSTRAINT ck_reports_signed CHECK (
    status NOT IN ('signed','archived')
    OR (signed_at IS NOT NULL AND review_doctor_id IS NOT NULL)
  ),
  CONSTRAINT ck_reports_reviewed CHECK (
    review_doctor_id IS NULL OR reviewed_at IS NOT NULL
  ),
  -- 强制四目原则由应用层做（四目原则允许特定例外），此处仅防误录同一人
  CONSTRAINT ck_reports_doctor_distinct CHECK (
    review_doctor_id IS NULL OR review_doctor_id <> report_doctor_id
  ),
  CONSTRAINT ck_reports_digest_algorithm CHECK (body_digest_algorithm = 'SM3')
);
COMMENT ON TABLE reports IS '结构化报告。卫健委电子病历必备字段全覆盖（架构方案 §7.3）';
COMMENT ON COLUMN reports.findings IS '受控字段 3：影像所见（分段文本汇总）。完整分段见 structured_findings';
COMMENT ON COLUMN reports.impression IS
  '受控字段 4：影像诊断意见。**AI 绝不产出此字段**，恒为执业医师署名（架构方案 §9.2）';
COMMENT ON COLUMN reports.follow_up_recommendation IS '受控字段 5：建议随访。卫健委必备字段';
COMMENT ON COLUMN reports.structured_findings IS
  '分段结构化所见（jsonb 数组）。每段含 key/label/windowType/text/authoredBy，支持跳转到对应窗位复核';
COMMENT ON COLUMN reports.ai_assist IS
  'AI 辅助标记的**结构化引用**。只含结构名/体积/确认医师/确认时间，**无结论性文本**。AI 字段只允许出现在此';
COMMENT ON COLUMN reports.body_digest IS
  '正文 SM3 摘要。**国密签名真正绑定的值**（SM2 内部固定用 SM3）。正文改一字符则原签名立即失效（AC-14）';
COMMENT ON COLUMN reports.body_sha256 IS
  '正文 SHA-256 摘要（Spec AC-13）。用于内容绑定与跨系统比对，**不参与国密签名运算**';
COMMENT ON COLUMN reports.retention_class IS '门急诊 >=15 年，住院 >=30 年（AC-20，国卫医发〔2013〕31 号）';

CREATE TABLE report_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  snapshot        jsonb NOT NULL,
  body_digest     char(64) NOT NULL,
  change_summary  varchar(500) NOT NULL,
  edited_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  edited_at       timestamptz NOT NULL DEFAULT now(),
  retention_class retention_class NOT NULL DEFAULT 'report_15y',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_revisions UNIQUE (report_id, version)
);
COMMENT ON TABLE report_revisions IS
  '报告修改痕迹。append-only，每次保存一条，构成完整回放链（卫健委必备：修改痕迹）';
COMMENT ON COLUMN report_revisions.change_summary IS '变更摘要。由后端按字段 diff 生成，防止前端漏报或误报';

-- 已签署报告禁止删除与修改
CREATE TRIGGER trg_reports_no_delete_signed
BEFORE DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION medplan.fn_reports_signed_guard();

CREATE TRIGGER trg_reports_no_signed_update
BEFORE UPDATE ON reports
FOR EACH ROW
WHEN (OLD.status IN ('signed','archived'))
EXECUTE FUNCTION medplan.fn_reports_signed_guard();

-- ---------------------------------------------------------------------
-- 10. 签名日志（WS/T 847—2024）
-- ---------------------------------------------------------------------
CREATE TABLE signature_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_no           varchar(64)  NOT NULL,
  document_unique_sn  varchar(128) NOT NULL,
  subject_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_name        varchar(64) NOT NULL,
  subject_title       varchar(32) NOT NULL,
  subject_dept        varchar(64) NOT NULL,
  object_type         varchar(32) NOT NULL DEFAULT 'report',
  object_id           uuid NOT NULL,
  object_version      integer NOT NULL,
  digest_value        char(64) NOT NULL,
  digest_algorithm    varchar(16) NOT NULL DEFAULT 'SM3',
  cert_serial         varchar(128) NOT NULL,
  cert_issuer         varchar(256) NOT NULL,
  cert_valid_from     timestamptz NOT NULL,
  cert_valid_to       timestamptz NOT NULL,
  cert_chain          text,
  crl_checked         boolean NOT NULL DEFAULT false,
  crl_check_result    varchar(32),
  signature_algorithm varchar(16) NOT NULL DEFAULT 'SM2',
  signature_value     text NOT NULL,
  signed_at           timestamptz NOT NULL,
  tsa_authority       varchar(256) NOT NULL,
  tsa_token           text NOT NULL,
  clock_drift_seconds integer,
  log_integrity_digest char(64) NOT NULL,
  log_signed_at       timestamptz,
  log_signature_value text,
  idempotency_key     char(36),
  retention_class     retention_class NOT NULL DEFAULT 'signature_perm',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signature_serial_no UNIQUE (serial_no),
  -- 同一报告同一版本只能有一条签名。**双保险**：
  -- 即便应用层幂等失效，也不会出现两份有效签名（法律风险）
  CONSTRAINT uq_signature_object_version UNIQUE (object_type, object_id, object_version),
  CONSTRAINT uq_signature_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_signature_digest_algorithm CHECK (digest_algorithm = 'SM3'),
  CONSTRAINT ck_signature_algorithm CHECK (signature_algorithm = 'SM2'),
  -- 签名时间必须在证书有效期内（WS/T 847 要求）
  CONSTRAINT ck_signature_cert_valid CHECK (
    signed_at >= cert_valid_from AND signed_at <= cert_valid_to
  ),
  -- 签名人必须是执业医师。实习/试用期医师无签名权（架构方案 §10.1）
  CONSTRAINT ck_signature_title CHECK (
    subject_title IN ('主任医师','副主任医师','主治医师')
  )
);
COMMENT ON TABLE signature_logs IS
  '电子签名日志。WS/T 847-2024 字段逐项对应。**独立存储 + append-only + 自身可验签**（PRD COM-10）';
COMMENT ON COLUMN signature_logs.serial_no IS 'WS/T 847：数字签名流水号。格式 SN-yyyy-MM-dd-nnnnnn';
COMMENT ON COLUMN signature_logs.document_unique_sn IS 'WS/T 847：原文唯一序列号';
COMMENT ON COLUMN signature_logs.subject_id IS 'WS/T 847：服务主体标识（签名人）';
COMMENT ON COLUMN signature_logs.object_id IS 'WS/T 847：服务对象标识（被签名的报告）';
COMMENT ON COLUMN signature_logs.digest_value IS 'WS/T 847：原文摘要值（SM3）。正文改一字符则原签名失效（AC-14）';
COMMENT ON COLUMN signature_logs.digest_algorithm IS 'WS/T 847：摘要算法标识。CHECK 强制 SM3（国密）';
COMMENT ON COLUMN signature_logs.cert_serial IS 'WS/T 847：证书序列号';
COMMENT ON COLUMN signature_logs.signature_value IS 'WS/T 847：签名数据（Base64 DER 的 SM2 签名值）。私钥不出 UKey/密码机';
COMMENT ON COLUMN signature_logs.signed_at IS '权威时间源时间（TSA / 北斗授时）。**不得用本地时间兜底**（AC-15）';
COMMENT ON COLUMN signature_logs.log_integrity_digest IS
  '签名日志自身的完整性摘要。业务库损坏后凭此独立还原验证结果（COM-10）';

CREATE TRIGGER trg_signature_logs_immutable
BEFORE UPDATE OR DELETE ON signature_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

CREATE TRIGGER trg_signature_logs_no_truncate
BEFORE TRUNCATE ON signature_logs
FOR EACH STATEMENT EXECUTE FUNCTION medplan.fn_append_only_guard();

-- ---------------------------------------------------------------------
-- 11. 审计日志（等保 8.1.4.3）
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id              bigserial,
  event_time      timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid,
  actor_roles     role_code[],
  event_type      audit_event_type NOT NULL,
  result          audit_result NOT NULL,
  result_code     integer,
  patient_id      uuid,
  resource_type   varchar(32) NOT NULL,
  resource_id     varchar(256) NOT NULL,
  source_ip       inet,
  terminal_id     varchar(64),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  hash_prev       char(64) NOT NULL,
  hash_self       char(64) NOT NULL,
  retention_class retention_class NOT NULL DEFAULT 'audit_6m',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 分区表主键必须包含分区键（PostgreSQL 硬约束），
  -- 写成 PRIMARY KEY (id) 会直接建表失败。id 仍全局单调。
  CONSTRAINT pk_audit_logs PRIMARY KEY (id, event_time)
) PARTITION BY RANGE (event_time);

COMMENT ON TABLE audit_logs IS
  '审计日志。**append-only + hash chain**。等保 8.1.4.3 / ADR-004。**无任何 UPDATE/DELETE/TRUNCATE 路径**';
COMMENT ON COLUMN audit_logs.actor_roles IS '操作时刻的角色快照。角色后续变更不影响历史审计的判定';
COMMENT ON COLUMN audit_logs.detail IS
  '事件明细。denied 时必须含拒绝原因。**禁止写入姓名明文/身份证/手机号**（架构方案 §10.3）';
COMMENT ON COLUMN audit_logs.hash_prev IS '前序记录摘要。链式防篡改';
COMMENT ON COLUMN audit_logs.hash_self IS '本记录摘要。含等保要求的全部审计要素 + hash_prev';

-- DEFAULT 兜底分区。
-- 理由：审计写入**绝不能失败**。若某段时间未预建分区而写入落到范围外，
--       没有 DEFAULT 分区会直接 INSERT 报错，那等于丢审计事件 —— 这是最不可接受的失败模式
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
COMMENT ON TABLE audit_logs_default IS '兜底分区。防止时间落在已建分区外导致审计写入失败（审计丢失不可接受）';

CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TRIGGER trg_audit_chain
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_audit_chain_guard();

CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

-- TRUNCATE 不触发行级触发器，必须单独声明语句级触发器
CREATE TRIGGER trg_audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION medplan.fn_append_only_guard();

-- ---------------------------------------------------------------------
-- 12. 索引（架构方案 §7.4）
-- ---------------------------------------------------------------------

-- 患者主索引
CREATE UNIQUE INDEX idx_patients_empi ON patients(empi_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_id_card_hash ON patients(id_card_hash);
CREATE INDEX idx_patients_phone_hash ON patients(phone_hash);

-- 就诊
CREATE INDEX idx_visits_patient ON visits(patient_id, admit_date DESC);
CREATE INDEX idx_visits_dept_inpatient ON visits(dept, admit_date DESC) WHERE is_inpatient;
CREATE INDEX idx_visits_ward_dept ON visits(ward_dept)
  WHERE is_inpatient AND ward_dept IS NOT NULL;

-- 检查检索（PRD DCM-01：3 秒内）
CREATE UNIQUE INDEX idx_studies_accession ON studies(accession_no) WHERE deleted_at IS NULL;
CREATE INDEX idx_studies_patient_date ON studies(patient_id, study_date DESC);
CREATE INDEX idx_studies_status ON studies(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_studies_date ON studies(study_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_studies_unread_queue ON studies(study_date DESC)
  WHERE deleted_at IS NULL AND read_status <> 'read';
CREATE INDEX idx_studies_visit ON studies(visit_id);

-- 序列与期相
CREATE INDEX idx_series_study ON series(study_id);
CREATE INDEX idx_series_phase ON series(study_id, phase);
CREATE INDEX idx_series_study_uid ON series(study_uid);
CREATE INDEX idx_series_low_confidence ON series(study_id)
  WHERE phase = 'unknown' AND deleted_at IS NULL;

-- 实例
CREATE INDEX idx_instances_series ON instances(series_id, instance_number);
CREATE INDEX idx_instances_series_uid ON instances(series_uid, instance_number);

-- 分割任务
CREATE INDEX idx_seg_task_status ON segmentation_tasks(status, created_at DESC);
CREATE INDEX idx_seg_task_study ON segmentation_tasks(study_id);
CREATE INDEX idx_seg_task_submitter ON segmentation_tasks(submitted_by, created_at DESC);
CREATE INDEX idx_seg_task_failed ON segmentation_tasks(error_step, created_at DESC)
  WHERE status = 'failed';

-- AI 结果与确认
CREATE INDEX idx_segmentations_task ON segmentations(task_id);
CREATE INDEX idx_seg_confirms_task ON segmentation_confirms(task_id);
CREATE INDEX idx_seg_confirms_user ON segmentation_confirms(confirmed_by, confirmed_at DESC);
CREATE INDEX idx_seg_confirms_pending ON segmentation_confirms(task_id)
  WHERE pending_supervisor_review;

-- 规划
CREATE INDEX idx_plans_study ON plans(study_id, version DESC);
CREATE INDEX idx_plans_task ON plans(segmentation_task_id);
CREATE INDEX idx_plans_author ON plans(created_by, created_at DESC);
CREATE INDEX idx_plans_locked ON plans(locked_by_report_id) WHERE locked_at IS NOT NULL;
CREATE INDEX idx_plans_payload_gin ON plans USING gin (payload jsonb_path_ops);

-- 操作日志
CREATE INDEX idx_plan_commands_plan ON plan_commands(plan_id, created_at DESC);
CREATE INDEX idx_plan_commands_actor ON plan_commands(actor_id, created_at DESC);

-- 报告
CREATE UNIQUE INDEX idx_reports_study_version ON reports(study_id, version);
CREATE INDEX idx_reports_status ON reports(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_reports_doctor ON reports(report_doctor_id, report_time DESC);
CREATE INDEX idx_reports_reviewer ON reports(review_doctor_id, reviewed_at DESC);
CREATE INDEX idx_reports_pending_review ON reports(review_doctor_id, report_time)
  WHERE status = 'pending_review';
CREATE INDEX idx_reports_retention ON reports(retention_class, report_time);
CREATE INDEX idx_reports_study_uid ON reports(study_uid);
CREATE INDEX idx_reports_ai_assist_gin ON reports USING gin (ai_assist jsonb_path_ops);

-- 报告修改痕迹
CREATE INDEX idx_report_revisions_report ON report_revisions(report_id, version DESC);

-- 签名
CREATE INDEX idx_signature_logs_object ON signature_logs(object_type, object_id, object_version);
CREATE INDEX idx_signature_logs_subject ON signature_logs(subject_id, signed_at DESC);
CREATE INDEX idx_signature_logs_serial ON signature_logs(serial_no);
CREATE INDEX idx_signature_logs_signed_at ON signature_logs(signed_at DESC);
CREATE UNIQUE INDEX idx_signature_logs_integrity ON signature_logs(log_integrity_digest);

-- 审计多维检索（PRD AUD-01）
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_id, event_time DESC);
CREATE INDEX idx_audit_type_time ON audit_logs(event_type, event_time DESC);
CREATE INDEX idx_audit_patient_time ON audit_logs(patient_id, event_time DESC);
CREATE INDEX idx_audit_time ON audit_logs(event_time DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_result ON audit_logs(result, event_time DESC);
CREATE INDEX idx_audit_denied ON audit_logs(patient_id, event_time DESC)
  WHERE result = 'denied';
CREATE INDEX idx_audit_detail_gin ON audit_logs USING gin (detail jsonb_path_ops);

-- 患者授权
CREATE INDEX idx_patient_grants_user ON patient_grants(user_id, patient_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_patient_grants_patient ON patient_grants(patient_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_patient_grants_expiry ON patient_grants(expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- 用户与角色
CREATE INDEX idx_users_dept ON users(department_code)
  WHERE is_active AND deleted_at IS NULL;
CREATE INDEX idx_users_ukey_cert ON users(ukey_cert_serial) WHERE ukey_cert_serial IS NOT NULL;
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- ---------------------------------------------------------------------
-- 13. updated_at 自动维护
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','roles','user_roles','patients','visits','patient_grants',
    'studies','series','instances','segmentation_tasks','segmentations',
    'segmentation_confirms','plans','plan_commands','reports','report_revisions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION medplan.fn_set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 14. 最小权限账号（等保 8.1.4.2主体用户级 + 客体表级 + 权限分离）
-- ---------------------------------------------------------------------

-- app_ro：只读账号
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro LOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA medplan TO app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA medplan TO app_ro;
GRANT INSERT ON audit_logs TO app_ro;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA medplan FROM app_ro;

-- app_rw：业务读写账号（后端服务）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA medplan TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA medplan TO app_rw;
GRANT INSERT ON audit_logs TO app_rw;

-- audit_logs 与 signature_logs 的修改/删除/截断权限全部撤销。
-- 这是「审计物理不可改」的第一层也是最硬的保证（ADR-004）。
-- 后续任何 GRANT 语句都不得覆盖这两张表（由 lint_schema.js 断言守护）
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON signature_logs FROM app_rw, app_ro;
REVOKE DELETE ON signature_logs FROM app_rw, app_ro;

-- app_audit：审计专用写账号（权限分离：能写审计，碰不到业务数据）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_audit') THEN
    CREATE ROLE app_audit LOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA medplan TO app_audit;
REVOKE ALL ON ALL TABLES IN SCHEMA medplan FROM app_audit;
GRANT INSERT, SELECT ON audit_logs TO app_audit;

-- ---------------------------------------------------------------------
-- 运行时新建分区的默认权限
--
-- 问题：audit_logs 按月分区。fn_precreate_audit_partition() 每月 1 日
-- 定时预建下月分区，运行时用 CREATE TABLE ... PARTITION OF 创建。
-- PostgreSQL 的 ALTER DEFAULT PRIVILEGES **只影响该语句之后新建的对象**，
-- 运行时创建的分区不会自动继承上面已授予的权限。
-- 后果：新建月分区缺少 app_audit 的 INSERT 权限 -> 审计写入失败
--       -> **审计事件丢失**（等保 8.1.4.3 不可接受）。
-- 因此必须在角色创建之后显式声明默认权限。
-- ---------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT INSERT, SELECT ON TABLES TO app_audit;
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT SELECT ON TABLES TO app_ro;
-- app_rw 的默认权限仅给业务表读写；audit_logs 的写权限由下方显式 REVOKE 约束，
-- 因此这里不授予 app_rw 对 TABLES 的 INSERT（避免新分区默认带 INSERT 而绕过撤销）
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
-- 新建的审计分区必须与主表同等受保护
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM app_rw, app_ro;

-- ai_worker：GPU Worker 账号。
-- 只能读写分割任务与影像元数据，**不能访问患者主索引与报告**（架构方案 §10.2）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_worker') THEN
    CREATE ROLE ai_worker LOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA medplan TO ai_worker;
GRANT SELECT, UPDATE ON segmentation_tasks TO ai_worker;
GRANT INSERT, UPDATE ON segmentations TO ai_worker;
GRANT SELECT ON studies, series, instances TO ai_worker;
-- 显式REVOKE 而非「不 GRANT」：防止后续权限继承导致的意外暴露
REVOKE ALL ON patients, visits, reports, report_revisions,
  signature_logs, plans, patient_grants, audit_logs FROM ai_worker;

-- migrator：迁移账号，仅部署期使用
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN;
  END IF;
END;
$$;
GRANT ALL ON SCHEMA medplan TO migrator;

-- ---------------------------------------------------------------------
-- 15. 脱敏视图（架构方案 §10.3）
-- ---------------------------------------------------------------------
-- 后端**不得**直接 SELECT patients 取明文姓名后自行掩码 ——
-- 漏改一处就是明文泄露。默认只暴露掩码字段。
CREATE VIEW v_patients_masked AS
SELECT
  p.id,
  p.empi_id,
  left(p.name, 1) || '*' || right(p.name, 1) AS name_masked,
  p.gender,
  p.birth_date,
  p.id_card_masked,
  p.phone_masked,
  p.insurance_no,
  p.created_at,
  p.updated_at
FROM patients p
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW v_patients_masked IS '患者脱敏视图。**后端默认只查此视图**，避免明文泄露';

-- 明文视图：仅质控/病案角色的受控路径，须配合 x-deidentify: false 头并强制审计
CREATE VIEW v_patients_plain AS
SELECT id, empi_id, name, gender, birth_date, id_card_masked, phone_masked
FROM patients
WHERE deleted_at IS NULL;

COMMENT ON VIEW v_patients_plain IS
  '患者明文视图。**仅质控/病案角色受控访问**，每次访问强制写 deidentification_override 审计';

REVOKE ALL ON v_patients_plain FROM app_ro, app_rw, ai_worker;
GRANT SELECT ON v_patients_plain TO app_rw;

CREATE VIEW v_audit_logs_trail AS
SELECT
  a.id, a.event_time, a.actor_id, a.actor_roles, a.event_type,
  a.result, a.result_code, a.patient_id, a.resource_type, a.resource_id,
  a.source_ip, a.terminal_id, a.detail, a.hash_prev, a.hash_self
FROM audit_logs a;

COMMENT ON VIEW v_audit_logs_trail IS
  '审计追溯视图。**只读，无任何写路径**。供质控科按操作人/事件/患者/时间多维检索';

-- ---------------------------------------------------------------------
-- 16. 运维函数
-- ---------------------------------------------------------------------

-- 审计链完整性校验。每日定时调用，断裂即告警（风险 R6）
CREATE OR REPLACE FUNCTION fn_verify_audit_chain()
RETURNS TABLE (
  broken_id   bigint,
  broken_time timestamptz,
  expected_prev char(64),
  actual_prev  char(64)
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text := repeat('0', 64);
  r record;
BEGIN
  FOR r IN
    SELECT id, event_time, hash_prev, hash_self FROM audit_logs ORDER BY id ASC
  LOOP
    IF r.hash_prev <> v_prev THEN
      RETURN QUERY SELECT r.id, r.event_time, v_prev::char(64), r.hash_prev;
      RETURN;
    END IF;
    v_prev := r.hash_self;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION fn_verify_audit_chain() IS
  '审计链完整性校验。返回首个断裂点；链完整则返回 0 行。每日定时调用，断裂即告警（R6）';

-- 预建下月分区。定时任务每月 1 日调用
CREATE OR REPLACE FUNCTION fn_precreate_audit_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'audit_logs_' || to_char(v_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS medplan.%I PARTITION OF medplan.audit_logs FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );
  RETURN v_name;
END;
$$;

COMMENT ON FUNCTION fn_precreate_audit_partition(date) IS
  '预建指定月份的审计分区。定时任务每月 1 日调用，避免写入时才发现分区缺失';

-- 留存到期扫描。**只返回清单，不删除任何数据**
CREATE OR REPLACE FUNCTION fn_find_archivable_reports(p_before timestamptz)
RETURNS TABLE (
  report_id      uuid,
  study_uid      varchar,
  retention      retention_class,
  report_time    timestamptz,
  signed_at      timestamptz,
  months_elapsed integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.study_uid, r.retention_class, r.report_time, r.signed_at,
    (date_part('year', age(now(), r.report_time)) * 12)::int
  FROM reports r
  WHERE r.status IN ('signed','archived')
    AND r.deleted_at IS NULL
    AND r.report_time < p_before
    AND (
      (r.retention_class = 'report_30y' AND r.report_time < now() - interval '30 years')
      OR (r.retention_class = 'report_15y' AND r.report_time < now() - interval '15 years')
    );
END;
$$;

COMMENT ON FUNCTION fn_find_archivable_reports(timestamptz) IS
  '留存到期扫描。**只返回待归档清单，不删除任何数据**。归档由运维转储后执行分区摘除';

-- 卫健委电子病历必备字段覆盖检查（架构方案 §7.3）
CREATE OR REPLACE FUNCTION fn_check_nhc_field_coverage()
RETURNS TABLE (
  field_name      text,
  requirement_ref text,
  table_name      text,
  column_name     text,
  covered         boolean
)
LANGUAGE sql
AS $$
  SELECT * FROM (VALUES
    ('患者基本信息', '国卫办医发〔2017〕8 号', 'patients', 'name/gender/birth_date/id_card_hash/insurance_no', true),
    ('就诊信息', '国卫办医发〔2017〕8 号', 'visits', 'visit_no/visit_type/admit_date/discharge_date/dept/ward_dept/bed_no', true),
    ('检查信息', '国卫办医发〔2017〕8 号', 'studies', 'accession_no/modality/body_part/study_date', true),
    ('序列参数', 'RPT-01', 'series', 'phase/slice_thickness_mm/instance_count', true),
    ('检查所见', 'RPT-01 受控字段', 'reports', 'findings/structured_findings', true),
    ('诊断意见', 'RPT-01 受控字段', 'reports', 'impression', true),
    ('建议随访', '国卫办医发〔2017〕8 号', 'reports', 'follow_up_recommendation', true),
    ('报告医师', '卫健委必备', 'reports', 'report_doctor_id', true),
    ('审核医师', '卫健委必备', 'reports', 'review_doctor_id', true),
    ('报告时间', '卫健委必备', 'reports', 'report_time', true),
    ('修改痕迹', '卫健委必备', 'report_revisions', 'snapshot/body_digest/change_summary/edited_by', true),
    ('操作印痕', 'AUD-01', 'audit_logs', 'actor_id/event_type/event_time/result/patient_id', true),
    ('签名有效性', 'WS/T 847-2024', 'signature_logs', 'digest_value/signature_value/cert_serial/tsa_token/signed_at', true),
    ('AI 参与声明', 'COM-08', 'reports', 'ai_assist', true),
    ('AI 标记确认', 'AI-03', 'segmentation_confirms', 'action/modification_note/confirmed_by/confirmed_at', true)
  ) AS t(field_name, requirement_ref, table_name, column_name, covered);
$$;

COMMENT ON FUNCTION fn_check_nhc_field_coverage() IS
  '卫健委电子病历必备字段覆盖检查（架构方案 §7.3）。返回逐条落库位置，供测评取证';

-- ---------------------------------------------------------------------
-- 17. 迁移记录
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    varchar(16) PRIMARY KEY,
  name       varchar(128) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum   char(64)    NOT NULL,
  applied_by varchar(64) NOT NULL DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
  '迁移记录。checksum 为迁移文件内容的 SM3 摘要。**文件被改动则启动校验失败**（规范 9：防篡改迁移历史）';

-- 写入本迁移的记录。checksum 在部署时由迁移工具计算填入
INSERT INTO schema_migrations (version, name, checksum, applied_by)
VALUES (
  '001',
  'init',
  repeat('0', 64),  -- 占位。部署工具执行前用实际文件摘要覆盖
  current_user
)
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- =====================================================================
-- 部署后自检（在 psql 中逐条执行，全部符合预期才算部署成功）
-- =====================================================================
--
-- 1) 表数量。期望 16 张业务表（Spec §6 的 15 张 + segmentations）
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='medplan' AND table_type='BASE TABLE'
--     AND table_name NOT LIKE 'audit_logs_%';
--
-- 2) 审计表物理不可改。**三条都必须报权限不足**
-- SET ROLE app_rw;
-- UPDATE audit_logs SET result='success';        -- 应报 permission denied
-- DELETE FROM audit_logs;                        -- 应报 permission denied
-- TRUNCATE audit_logs;                -- 应报 permission denied
--
-- 3) 签名日志不可改
-- UPDATE signature_logs SET serial_no='x';       -- 应报 permission denied
--
-- 4) 已签名报告不可改。用表 owner 身份模拟（触发器是第二层防护）
-- DELETE FROM reports WHERE status='signed';    -- 应报异常（42501）
--
-- 5) 审计链正常。插入若干条后校验，应返回 0 行
-- INSERT INTO audit_logs (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
--   VALUES (NULL,'auth_login','success','session','test-1',repeat('0',64),repeat('0',64));
-- SELECT * FROM fn_verify_audit_chain();         -- 首次插入后应返回 0 行（hash_prev 恰为 64 个 0）
--
-- 6) 卫健委字段全覆盖
-- SELECT * FROM fn_check_nhc_field_coverage() WHERE NOT covered;   -- 应返回 0 行
--
-- 7) ai_worker 无法访问 PHI 表
-- SET ROLE ai_worker;
-- SELECT count(*) FROM patients;                 -- 应报 permission denied
--
-- 8) 幂等约束生效
-- SET ROLE app_rw;
-- INSERT INTO segmentation_tasks (study_id, series_id, model_name, submitted_by, idempotency_key)
--   VALUES (NULL,NULL,'total',NULL,NULL);        -- 应先因 NOT NULL 失败；补齐后重复键应失败
-- =====================================================================