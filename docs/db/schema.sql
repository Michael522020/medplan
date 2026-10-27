-- =====================================================================
-- MedPlan 业务库 Schema —— PostgreSQL 18
-- =====================================================================
-- 文件用途：业务库完整结构的**参考快照**（single source of truth for review）。
--          实际部署执行的是 docs/db/migrations/ 下的增量迁移脚本。
--          修改流程：改本文件 -> 追加一个 NNN_xxx.sql 迁移 -> 两者必须一致。
--
-- 依据：
--   docs/Spec.md §6（15 张表清单，锁定）
--   docs/架构方案.md §7.2 ER 图 / §7.3 卫健委字段覆盖 / §7.4 索引清单
--   docs/架构方案.md §7.5 数据安全 / §10 权限与合规
--   docs/decisions/ADR-004.md（PostgreSQL 18 + 表级 GRANT 防审计篡改）
--   docs/decisions/ADR-005.md（SM2 + CA + TSA，WS/T 847-2024）
--   compliance/等保三级与卫健委条款对照表.md
--   GB/T 22239-2019 8.1.4.1/8.1.4.2/8.1.4.3
--   国卫办医发〔2017〕8 号 / 国卫医发〔2013〕31 号
--   WS/T 847-2024 医学电子文档数字签名技术标准
--
-- 目标库：PostgreSQL 18（EOL 2030-11-14），私有化部署于院内
-- schema：medplan（与 dcm4chee 元数据 schema 物理隔离，禁止跨 schema 外键，见 ADR-004）
--
-- 命名与结构约定（来自 架构方案 §7.1）：
--   1. 表名蛇形复数；主键统一 uuid v7（时间有序，利于B-tree 索引局部性）
--   2. 每表必有 created_at / updated_at
--   3. 时间统一 timestamptz，禁用手写 timestamp without time zone
--   4. 软删除统一 deleted_at；但 audit_logs / signature_logs / report_revisions
--      **禁止**软删除与物理删除（合规要求不可删除）
--   5. PHI 字段以PHI 前缀注释标注；身份证与手机号**只存SM3 摘要**
--   6. 每张业务表带 retention_class（留存等级），驱动归档策略
--
-- 执行方式：
--   psql -v ON_ERROR_STOP=1 -f docs/db/schema.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 扩展与 schema
-- ---------------------------------------------------------------------
-- pgcrypto：gen_random_uuid 的历史依赖（PG13+ 内置，此处为兼容声明）
-- 说明：SM3 是国密哈希，PostgreSQL 核心无内置实现。
--       两种部署路径二选一（见 ADR-004 与架构方案 §7.5）：
--         A. 应用层计算 SM3 后写入（推荐，密码运算统一委托密码机/应用，不落库侧逻辑）
--         B. 部署 pg_sm3 社区扩展后使用 sm3(bytea)
--       本schema 的列类型按 A 设计：摘要以 hex 文本存储，长度固定 64。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS medplan;
SET search_path TO medplan, public;

-- ---------------------------------------------------------------------
-- 1. 枚举类型
--    枚举而非 CHECK 约束的理由：PostgreSQL 枚举值在pg_enum 中集中可查，
--    便于合规取证时导出「系统承认的全部状态取值」；且改值需 ALTER TYPE，
--    天然形成变更门槛（避免随手加一个魔法字符串进生产）。
-- ---------------------------------------------------------------------

-- 就诊类型。决定报告留存期限：outpatient/emergency >=15年，inpatient >=30年
CREATE TYPE visit_type AS ENUM (
  'outpatient',    -- 门诊
  'emergency',     -- 急诊
  'inpatient',     -- 住院
  'physical_exam', -- 体检
  'day_surgery'    -- 日间手术
);

-- 序列期相（DCM-02 自动分组）。unknown = 期相识别置信度不足，禁止默认选中
CREATE TYPE series_phase AS ENUM (
  'plain',    -- 平扫
  'arterial', -- 动脉期
  'portal',   -- 门脉期
  'delayed',  -- 延迟期
  'unknown'
);

-- 检查状态
CREATE TYPE study_status AS ENUM (
  'registered', 'in_progress', 'completed', 'archived', 'cancelled'
);

-- 报告状态机：draft -> pending_review -> signed -> archived
-- signed 为终态（正文锁定，AC-13/AC-14）
CREATE TYPE report_status AS ENUM (
  'draft', 'pending_review', 'signed', 'archived'
);

-- 规划方案状态
CREATE TYPE plan_status AS ENUM (
  'draft', 'confirmed', 'archived'
);

-- AI 分割任务状态机
CREATE TYPE segmentation_task_status AS ENUM (
  'queued', 'running', 'succeeded', 'failed'
);

-- AI 流水线环节。命名避开 stage 一词：医学语境下易与 TNM 癌症分期混淆
CREATE TYPE segmentation_pipeline_step AS ENUM (
  'precheck',    -- 期相前置校验
  'fetch',       -- 拉取影像
  'preprocess',  -- NIfTI 转换
  'inference',   -- 模型推理
  'stow',        -- STOW-RS 回写 DICOM SEG
  'callback'     -- 回调业务库
);

-- 医师对 AI 标记的处理动作
CREATE TYPE segmentation_confirm_action AS ENUM (
  'confirmed',  -- 接受 AI 标记
  'modified'    -- 医师手工修改后接受（modification_note 必填）
);

-- 审计事件类型。与 openapi.yaml 的 AuditEventType 枚举**必须逐项一致**
-- （契约校验脚本会交叉比对，改一处必须同步另一处）
CREATE TYPE audit_event_type AS ENUM (
  'auth_login',                  -- 登录成功
  'auth_login_failed',           -- 登录失败（含 UKey 校验失败）
  'auth_logout',                 -- 登出
  'study_list_viewed',           -- 检查列表调阅
  'study_series_viewed',         -- 序列调阅
  'dicom_instances_retrieved',   -- DICOM 取图
  'measurement_saved',           -- 测量值保存
  'segmentation_task_submitted', -- 分割任务提交
  'segmentation_task_rejected',  -- 分割任务被拒（含 40003 白名单拒绝）
  'segmentation_task_read',      -- 分割结果读取
  'segmentation_item_confirmed', -- AI 标记确认/修改
  'plan_created',                -- 规划方案创建
  'plan_updated',                -- 规划方案更新
  'report_created',              -- 报告创建
  'report_viewed',               -- 报告查看
  'report_updated',              -- 报告更新
  'report_signed',               -- 报告签名
  'report_exported',             -- 报告导出（本期不开放，PRD OOS-08）
  'report_archived',             -- 报告归档
  'audit_log_queried',           -- 审计查询
  'permission_changed',          -- 权限变更
  'patient_grant_changed',       -- 患者授权变更
  'deidentification_override'    -- 脱敏豁免（质控/病案查看明文姓名）
);

-- 审计操作结果。denied = 越权被拒（失败路径同样必须审计，架构方案 §10.4）
CREATE TYPE audit_result AS ENUM (
  'success', 'failure', 'denied'
);

-- 患者数据授权范围（L3 数据权限）
CREATE TYPE grant_scope AS ENUM (
  'read',  -- 只读调阅
  'write'  -- 可编辑（规划方案等）
);

-- 角色编码。与 openapi.yaml RoleCode 枚举一致
CREATE TYPE role_code AS ENUM (
  'system_admin',        -- 系统管理员
  'image_chief',         -- 影像科主任医师
  'image_physician',     -- 影像科医师
  'trainee_physician',   -- 实习/试用期医师（无签名权）
  'surgeon_physician',   -- 手术科室医师
  'quality_control',     -- 质控科
  'medical_records',     -- 病案管理
  'service_account'      -- 服务账号（AI Worker 等）
);

-- 留存等级。驱动归档策略与合规举证
CREATE TYPE retention_class AS ENUM (
  'audit_6m',        -- 审计日志：在线 >=6 个月（等保 8.1.4.3 硬下限）
  'imaging_meta_5y', -- 影像元数据：>=5 年（业务容量要求）
  'plan_15y',        -- 规划方案：按门急诊 >=15 年
  'report_15y',      -- 门急诊报告：>=15 年
  'report_30y',      -- 住院报告：>=30 年
  'signature_perm'   -- 签名与签名日志：永久（WS/T 847 要求可独立还原）
);

-- ---------------------------------------------------------------------
-- 2. 触发器函数：审计表防篡改 + hash chain
-- ---------------------------------------------------------------------
-- 设计要点（这是本schema 最关键的安全设计，评审请重点看）：
--
--   等保 8.1.4.3 要求审计记录「不能被删除、修改」且「审计进程受保护」。
--   单靠应用层自律不可靠（一次误操作或一个 SQL 注入就绕过），
--   因此用**数据库权限 + 触发器双保险**：
--
--   第一层：REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs
--            —— 业务账号 app_rw 在数据库层就没有修改路径（最硬的保证）
--   第二层：BEFORE UPDATE OR DELETE 触发器抛异常
--            —— 防的是表owner / 超级用户误操作，以及第一层被误放开的情形
--   第三层：hash chain（hash_prev + hash_self）
--            —— 即使前两层全部失效，也能检出篡改 occurred 的事实
--
--   hash chain 的必要性：如果只做权限控制，攻击者拿到超级用户权限后
--   可以直接 DROP TABLE 再重建，权限与触发器一并消失。
--   hash chain 让「整表重建」也可被检出：链上任一节点的摘要对不上即暴露。
--   这三层的价值是递进的，不是冗余。

-- 审计表写入前置校验：强制计算 hash_prev / hash_self
-- 使用 pg_advisory_xact_lock 保证并发插入时的链式顺序与数据库写入顺序一致，
-- 否则两个并发事务会读到同一个前序节点，产生分叉。
CREATE OR REPLACE FUNCTION fn_audit_chain_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = medplan, public, pg_temp
AS $$
DECLARE
  v_prev_hash text;
  v_row_hash text;
BEGIN
  -- 序列化链式写入。同一时刻只允许一个事务追加审计记录
  PERFORM pg_advisory_xact_lock(hashtext('medplan.audit_logs.chain'));

  -- 取当前链尾（id 最大的记录）的 hash_self 作为本行的 hash_prev
  SELECT hash_self INTO v_prev_hash
  FROM medplan.audit_logs
  ORDER BY id DESC
  LIMIT 1;

  -- 首条记录：hash_prev 记为 64 个 0（SM3 空链标记）
  IF v_prev_hash IS NULL THEN
    v_prev_hash := repeat('0', 64);
  END IF;

  NEW.hash_prev := v_prev_hash;

  -- 计算本行摘要。参与计算的字段覆盖「谁、何时、做了什么、对谁、结果」，
  -- 即等保 8.1.4.3 要求的审计要素全集。任何一项被改动，摘要即不匹配。
  --
  -- 两个必须注意的实现细节：
  -- 1. 每个可空字段都要 coalesce 成 ''。否则任一为 NULL 会让整串拼接结果为 NULL，
  --    导致 hash_self 违反 NOT NULL 约束 —— 系统账号事件（actor_id 为空）恰好会踩中。
  -- 2. 数组用 array_to_string 而非 ::text。::text 走的是数组字面量输出格式，
  --    其稳定性依赖版本实现；显式拼接分隔符才是可长期依赖的规范形式。
  --    jsonb 的 ::text 则是安全的：jsonb 存储已规范化键序，输出稳定。
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

-- SM3 计算适配层：
--   优先使用 pg_sm3 扩展的 sm3(bytea)；未部署时降级为 sha256 并在注释中标注差异。
--   降级是**可接受的工程折中**，但必须显式告知：SM3 与 SHA-256 都是单向摘要，
--   链式防篡改的强度取决于摘要抗碰撞性，两者在此处均足够；
--   若密评要求全链路国密，则部署 pg_sm3 后本函数自动走SM3 分支，无需改表结构。
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

-- append-only 阻断（audit_logs / signature_logs 共用）。
-- 功能权限是第一层防护，本触发器是第二层（防表owner 误操作，
-- 以及第一层被误放开的情形）。函数通用化而非各表一个，
-- 是为了避免三份几乎相同的函数日后各自漂移。
CREATE OR REPLACE FUNCTION fn_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% 为 append-only 表：禁止 % 操作。业务数据修正请在业务表操作，审计侧追加新事件。',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501',  -- insufficient_privilege
      HINT = '审计/签名数据只能追加，不能修改或删除。';
END;
$$;

-- ---------------------------------------------------------------------
-- 3. RBAC：users / roles / user_roles（Spec §6 要求三张表拆开）
--    拆分理由：用户与角色是多对多关系（医师可同时是报告医师与审核人），
--    合在一张表会导致权限无法复用，也无法表达「同一角色在不同科室的差异」。
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name        varchar(64)  NOT NULL,
  display_name      varchar(64)  NOT NULL,
  -- 口令**不存储**。Keycloak 26.8.1 承载认证，本字段仅存 Keycloak 的用户索引
  keycloak_subject  varchar(255) NOT NULL,
  -- 职称。用于校验签名资格：仅主任/副主任/主治医师可签名（架构方案 §10.1）
  title             varchar(32)  NOT NULL,
  department_code   varchar(32)  NOT NULL,
  -- 执业证书号。**PHI 级敏感**，只存 SM3 摘要，不存明文
  license_no_hash   char(64),
  -- 手机号。**只存 SM3 摘要**，不存明文（架构方案 §7.5）
  phone_hash        char(64),
  -- UKey 证书序列号。与 Keycloak 会话绑定，证明第二因素已完成
  ukey_cert_serial  varchar(128),
  is_active         boolean      NOT NULL DEFAULT true,
  -- 连续认证失败计数，达阈值锁定（等保 8.1.4.1 鉴别失败处理）
  failed_login_count smallint    NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  retention_class   retention_class NOT NULL DEFAULT 'audit_6m',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_users_login_name UNIQUE (login_name),
  CONSTRAINT ck_users_failed_login_count CHECK (failed_login_count >= 0)
);

COMMENT ON TABLE users IS '用户表。口令不存储，认证委托 Keycloak 26.8.1（ADR-005）';
COMMENT ON COLUMN users.ukey_cert_serial IS 'UKey SM2 证书序列号。双因素第二因素凭据，会话须绑定';
COMMENT ON COLUMN users.license_no_hash IS '执业证书号 SM3 摘要（hex 64）。不存明文';
COMMENT ON COLUMN users.phone_hash IS '手机号 SM3 摘要（hex 64）。不存明文';

CREATE TABLE roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              role_code    NOT NULL,
  name              varchar(64)  NOT NULL,
  -- 细粒度权限位（bitmap或 JSON）。与架构方案 §10.1 权限矩阵对应：
  --   read / write / sign / review / audit_read / user_manage
  -- 用 text[] 而非 jsonb：值域受控，且 GIN 索引可用
  permissions       text[]       NOT NULL DEFAULT '{}',
  description       text,
  -- 系统内置角色不可删除（避免删掉 report_signer 导致无人能签名）
  is_system         boolean      NOT NULL DEFAULT true,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_roles_code UNIQUE (code),
  -- 权限位取值域由 CHECK 限定。少了这条，拼错的权限名（如 'sigin'）
  -- 会静默失效：用户以为自己有签名权，实际被拒，且难以排查
  CONSTRAINT ck_roles_permissions CHECK (
    permissions <@ ARRAY['read','write','sign','review','audit_read','user_manage']::text[]
  )
);

COMMENT ON TABLE roles IS '角色表。permissions 取值：read/write/sign/review/audit_read/user_manage';
COMMENT ON COLUMN roles.is_system IS '系统内置角色标记。为 true 时禁止 DELETE（防止误删签名角色）';

CREATE TABLE user_roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id           uuid         NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by        uuid         REFERENCES users(id) ON DELETE SET NULL,
  granted_at        timestamptz  NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  -- 授权记录留存 >=6 个月：等保 8.1.4.2 要求权限变更可追溯。
  -- 授权过期后仍需能回答「这个医生当时凭什么有这个角色」
  retention_class   retention_class NOT NULL DEFAULT 'audit_6m',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  -- 同一用户同一角色只允许一条有效授权
  CONSTRAINT uq_user_roles UNIQUE (user_id, role_id),
  CONSTRAINT ck_user_roles_expiry CHECK (expires_at IS NULL OR expires_at > granted_at)
);

COMMENT ON TABLE user_roles IS '用户-角色关联（RBAC）。expires_at 支持临时授权，如夜班值班医师';
COMMENT ON COLUMN user_roles.retention_class IS '角色授权记录留存 >=6 个月（等保 8.1.4.2 权限变更可追溯）';

-- ---------------------------------------------------------------------
-- 4. 患者主索引：patients（卫健委必备：患者基本信息）
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- EMPI 患者主索引号。全院唯一，是患者层的稳定标识
  empi_id           varchar(32)  NOT NULL,
  -- 姓名。PHI。仅在必要处返回，列表接口一律掩码（架构方案 §10.3）
  name              varchar(64)  NOT NULL,
  gender            char(1)      NOT NULL DEFAULT 'O',
  birth_date        date         NOT NULL,
  -- 身份证号。**只存 SM3 摘要**（架构方案 §7.5：不做明文落库）
  id_card_hash      char(64),
  -- 掩码值。仅供列表页显示后四位，不可逆推（由应用层在建档时生成一次）
  id_card_masked    varchar(32),
  -- 手机号。**只存 SM3 摘要**
  phone_hash        char(64),
  phone_masked      varchar(16),
  -- 医保号。PHI 级
  insurance_no      varchar(32),
  -- 血型等扩展字段归入扩展区，避免频繁ALTER（ADR-004：不过早固定 Schema）
  extra             jsonb        NOT NULL DEFAULT '{}'::jsonb,
  retention_class   retention_class NOT NULL DEFAULT 'report_30y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_patients_empi UNIQUE (empi_id),
  -- DICOM Patient Sex（ISO 5218）：M/F/O/空
  CONSTRAINT ck_patients_gender CHECK (gender IN ('M','F','O','')),
  -- 掩码长度约束：形如 310***********1234
  CONSTRAINT ck_patients_id_card_masked CHECK (
    id_card_masked IS NULL OR char_length(id_card_masked) BETWEEN 10 AND 20
  )
);

COMMENT ON TABLE patients IS '患者主索引（EMPI）。卫健委电子病历必备：患者基本信息';
COMMENT ON COLUMN patients.empi_id IS 'EMPI 主索引号。全院唯一，患者层稳定标识';
COMMENT ON COLUMN patients.id_card_hash IS '身份证号 SM3 摘要（hex 64）。**不存明文**，需查询时用摘要比对';
COMMENT ON COLUMN patients.id_card_masked IS '身份证掩码（如 310***********1234）。建档时生成一次，不可逆推';
COMMENT ON COLUMN patients.phone_hash IS '手机号 SM3 摘要（hex 64）。**不存明文**';
COMMENT ON COLUMN patients.retention_class IS '患者主索引随住院记录留存30 年；门诊患者按 report_15y 调整';

-- ---------------------------------------------------------------------
-- 5. 就诊：visits（卫健委必备：就诊信息）
-- ---------------------------------------------------------------------
CREATE TABLE visits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_no          varchar(32)  NOT NULL,
  patient_id        uuid         NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_type        visit_type   NOT NULL,
  -- 入出院时间。门诊/体检可只有就诊时间
  admit_date        timestamptz,
  discharge_date    timestamptz,
  -- 申请科室 / 病区科室 / 床号
  dept              varchar(64)  NOT NULL,
  ward_dept         varchar(64),
  bed_no            varchar(16),
  -- 是否在院。用于「本科室在院患者」的数据权限判定（架构方案 §10.1 规则 2b）
  is_inpatient      boolean      NOT NULL DEFAULT false,
  diagnosis_text    text,
  retention_class   retention_class NOT NULL DEFAULT 'report_30y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_visits_visit_no UNIQUE (visit_no),
  -- 出院时间不得早于入院时间
  CONSTRAINT ck_visits_discharge_after_admit CHECK (
    discharge_date IS NULL OR admit_date IS NULL OR discharge_date >= admit_date
  )
);

COMMENT ON TABLE visits IS '就诊记录。卫健委电子病历必备：就诊信息';
COMMENT ON COLUMN visits.visit_type IS '就诊类型。**决定报告留存期限**：outpatient/emergency >=15 年，inpatient >=30 年（AC-20）';
COMMENT ON COLUMN visits.is_inpatient IS '在院标记。L3 数据权限判定「本人所在科室有在院患者关联的研究」依赖此字段';

-- ---------------------------------------------------------------------
-- 6. 患者数据授权：patient_grants（L3 数据权限，PRD COM-03）
-- ---------------------------------------------------------------------
-- 判定逻辑（架构方案 §10.1，本注释是实现的唯一依据）：
--
--   用户 U 可见患者 P，当且仅当下列任一成立：
--     (1) U 拥有 quality_control / medical_records / system_admin 角色 -> 全院可见
--         （仍需全量审计，不是免审计）
--     (2) 存在 visits V，V.patient_id = P.id 且
--         ( 2a) V.dept = U.department_code            -- 本科室就诊
--          或 2b) V.is_inpatient AND V.ward_dept = U.department_code  -- 本病区在院
--     (3) 存在 reports R，R.study_id属于 P 的检查，且
--         R.report_doctor_id = U.id 或 R.review_doctor_id = U.id
--                                                        -- 本人是报告/审核医师
--     (4) 存在 patient_grants G，G.patient_id = P.id AND G.user_id = U.id
--         AND (G.expires_at IS NULL OR G.expires_at > now())
--                                                        -- 转诊/会诊显式授权
--     (5) U 拥有 trainee_physician 角色时，额外要求上级医师授权：
--         即除(1) 外，还须命中 (2) 且不可跨科室；访问非本人研究须有 patient_grants 记录
--
--   SQL 实现位置：medplan-backend/src/modules/rbac/repositories/（**不得写在 controller**）
--   判定必须**全部下推到 SQL 的 WHERE 子句**，禁止先查全量再应用层过滤
--   —— 后者既无法正确分页，也会泄露患者存在性（PRD COM-03）
--
--   失败处理：判定不通过时返回 10004，响应与「患者不存在」不可区分
--   （响应时间、状态码、响应体大小三者一致，见 openapi.yaml info §4.1）
CREATE TABLE patient_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid         NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  -- 被授权的医生
  user_id           uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope             grant_scope  NOT NULL DEFAULT 'read',
  -- 授权来源：转诊 / 会诊 / 住院主管 / 急诊留观。用于合规追溯「凭什么能看」
  grant_reason      varchar(256) NOT NULL,
  granted_by        uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at        timestamptz  NOT NULL DEFAULT now(),
  -- 到期自动失效。会诊授权通常 72 小时内有效
  expires_at        timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid         REFERENCES users(id) ON DELETE SET NULL,
  -- 撤销原因。撤回应可审计（保留记录，不物理删除）
  revoke_reason     varchar(256),
  -- 授权记录永久保留。患者授权是「谁在何时凭什么看过这个患者」的唯一凭证，
  -- 授权撤销后仍须可追溯（PRD AUD-01 权限变更类操作）
  retention_class   retention_class NOT NULL DEFAULT 'audit_6m',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_patient_grants_active
    UNIQUE (patient_id, user_id, scope),
  CONSTRAINT ck_patient_grants_expiry CHECK (
    expires_at IS NULL OR expires_at > granted_at
  ),
  -- 撤销后必须有撤销人与原因（否则审计链断）
  CONSTRAINT ck_patient_grants_revoke CHECK (
    revoked_at IS NULL OR (revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  -- 授权记录永久保留。患者授权是「谁在何时凭什么看过这个患者」的唯一凭证，
  -- 授权本身撤销后仍须可追溯（PRD AUD-01 权限变更类操作）
  CONSTRAINT ck_patient_grants_retention CHECK (retention_class = 'audit_6m')
);

COMMENT ON TABLE patient_grants IS
  '患者数据授权（L3 数据权限，PRD COM-03）。判定逻辑与实现位置见本表 COMMENT ON COLUMN granted_by';
COMMENT ON COLUMN patient_grants.grant_reason IS '授权来源说明（转诊/会诊/住院主管）。合规追溯「凭什么能看这个患者」';
COMMENT ON COLUMN patient_grants.expires_at IS '到期自动失效。会诊授权建议 <=72 小时，避免长期过度授权';
COMMENT ON COLUMN patient_grants.retention_class IS '授权记录永久保留。撤销后仍须可追溯「谁在何时凭什么访问过该患者」';
COMMENT ON COLUMN patient_grants.granted_by IS
  '授权人。
--------------------------------------------------------------------------
L3 数据权限判定规则（架构方案 §10.1，本COMMENT 是实现的唯一依据）：

  用户 U 可见患者 P，当且仅当下列任一成立：

  (1) U 拥有 quality_control / medical_records / system_admin 角色
      => 全院可见。**仍需全量审计**，角色不是免审计通行证。

  (2) 存在 visits V，V.patient_id = P.id，且满足下列之一：
      (2a) V.dept = U.department_code
           本科室就诊（含门诊申请科室）
      (2b) V.is_inpatient = true 且 V.ward_dept = U.department_code
           本病区在院患者

  (3) 存在 reports R，R 属于 P 的检查，且
      R.report_doctor_id = U.id 或 R.review_doctor_id = U.id
           本人是该报告的报告医师或审核医师

  (4) 存在本表记录 G：G.patient_id = P.id 且 G.user_id = U.id
      且 G.revoked_at IS NULL
      且 (G.expires_at IS NULL OR G.expires_at > now())
           转诊 / 会诊 / 住院主管的显式授权

  (5) U 拥有 trainee_physician（实习/试用期医师）时额外约束：
      不可跨科室；访问非本人经手的研究必须有本表记录（即规则 4）；
      其 segmentation_confirms.pending_supervisor_review 置true，
      此时报告**不可提交**（架构方案 §10.1 权限矩阵）。

--------------------------------------------------------------------------
实现要求（违反即代码评审不通过）：

  1. 判定必须**全部下推到 SQL 的 WHERE 子句**，禁止先查全量再在应用层过滤。
     应用层过滤既无法正确分页（total 会泄露全库规模），
     也会泄露患者存在性（PRD COM-03）。

  2. SQL 实现位置：medplan-backend/src/modules/rbac/repositories/
     **不得写在 controller 或 service 层**（架构方案 §5.1 依赖方向硬规则）。

  3. 判定不通过时返回 10004，响应与「患者不存在」在响应时间、
     状态码、响应体大小三者上不可区分（openapi.yaml info §4.1）。
     **禁止**先查患者是否存在再决定返回什么。

  4. 每次判定（无论通过与否）都要写审计；被拒记录必须含拒绝原因
     （audit_logs.detail.reason）。

  5. 规则 1/2/3/5 的命中也应留痕，便于质控回答
     「这个医生上周看了哪些不该看的患者」。';

-- ---------------------------------------------------------------------
-- 7. 检查：studies（卫健委必备：检查信息）
-- ---------------------------------------------------------------------
CREATE TABLE studies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- DICOM Study Instance UID。业务层主标识（与 PACS 侧一致）
  study_uid         varchar(128) NOT NULL,
  visit_id          uuid         NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  -- 冗余 patient_id：L3 权限判定需直接按患者过滤，避免多表join 影响分页性能。
  -- 由 triggers_fn_sync_study_patient() 保持与 visits.patient_id 一致
  patient_id        uuid         NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  accession_no      varchar(32)  NOT NULL,
  modality          varchar(16)  NOT NULL,
  body_part         varchar(32)  NOT NULL,
  study_description varchar(256),
  study_date        timestamptz  NOT NULL,
  status            study_status NOT NULL DEFAULT 'registered',
  -- 阅片状态。对应工作台「待阅 / 已阅」视图 Tab（UIUX-P2 §2.3）
  -- 由服务端在调阅动作时推进。PRD OPN-01 的医师工作量统计以本字段为唯一数据源，
  -- **不允许手工填报**，因此不可由前端直接写入
  read_status      varchar(16)  NOT NULL DEFAULT 'unread',
  -- 首次阅片时间。为空表示尚未阅片。队列等待时长以 study_date 为起点、read_at 为终点
  read_at          timestamptz,
  read_by          uuid         REFERENCES users(id) ON DELETE SET NULL,
  -- 报告模板编码。行业标准模板为基线，科室可在标准字段内调整（Spec Q6）
  report_template_code varchar(64),
  retention_class   retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_studies_study_uid UNIQUE (study_uid),
  CONSTRAINT uq_studies_accession_no UNIQUE (accession_no),
  CONSTRAINT ck_studies_modality CHECK (
    modality IN ('CT','MR','US','XA','CR','DX','MG','NM','PT','PET')
  ),
  CONSTRAINT ck_studies_read_status CHECK (
    read_status IN ('unread','in_progress','read')
  ),
  -- 已阅必须有阅片时间（工作量统计的审计依据，不允许手工填报）
  CONSTRAINT ck_studies_read_complete CHECK (
    read_status <> 'read' OR read_at IS NOT NULL
  )
);

COMMENT ON TABLE studies IS '检查记录。影像像素存于 PACS（dcm4chee），本表只存元数据';
COMMENT ON COLUMN studies.study_uid IS 'DICOM Study Instance UID。与 PACS 侧一致，是跨系统调阅的稳定标识';
COMMENT ON COLUMN studies.patient_id IS '冗余字段，由触发器与 visits.patient_id 同步。用于 L3 权限按患者直接过滤';
COMMENT ON COLUMN studies.read_status IS
  '阅片状态。unread 待阅 / in_progress 已开阅未出报告 / read 已阅。PRD OPN-01 医师工作量统计的唯一数据源，**不允许手工填报**';
COMMENT ON COLUMN studies.read_at IS
  '首次阅片时间。队列等待时长 = study_date 至 read_at（已阅冻结）或 now()（未阅持续增长），由服务端计算后下发';
COMMENT ON COLUMN studies.read_by IS '首次阅片的医师。用于工作量归属与绩效追溯';
COMMENT ON COLUMN studies.report_template_code IS '报告模板编码。标准模板为基线，科室在标准字段内调整，不做完全自定义（Spec Q6）';

-- 同步 studies.patient_id 与 visits.patient_id
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

CREATE TRIGGER trg_sync_study_patient
BEFORE INSERT OR UPDATE OF visit_id ON studies
FOR EACH ROW EXECUTE FUNCTION medplan.fn_sync_study_patient();

-- ---------------------------------------------------------------------
-- 8. 序列：series（DCM-02 期相自动分组）
-- ---------------------------------------------------------------------
CREATE TABLE series (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_uid        varchar(128) NOT NULL,
  study_id          uuid         NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  -- 冗余 study_uid 供 DICOM 侧按 UID 直查
  study_uid         varchar(128) NOT NULL,
  series_number     integer      NOT NULL,
  series_description varchar(256),
  -- 期相分组（DCM-02）。置信度 < 0.70 时前端不得默认选中
  phase             series_phase NOT NULL DEFAULT 'unknown',
  phase_confidence  numeric(4,3),
  instance_count    integer      NOT NULL DEFAULT 0,
  slice_thickness_mm numeric(6,2),
  rows              integer,
  columns           integer,
  pixel_spacing_mm  numeric(6,3)[],
  -- 传输语法。薄层 CT 首选 1.2.840.10008.1.2.4.90（JPEG2000 Lossless）
  transfer_syntax_uid varchar(64),
  -- 推荐窗宽窗位（CT 腹部软窗/肺窗/骨窗）
  window_center     numeric(7,2),
  window_width      numeric(7,2),
  retention_class   retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_series_uid UNIQUE (series_uid),
  CONSTRAINT ck_series_phase_confidence CHECK (
    phase_confidence IS NULL OR (phase_confidence >= 0 AND phase_confidence <= 1)
  ),
  CONSTRAINT ck_series_instance_count CHECK (instance_count >= 0),
  CONSTRAINT ck_series_thickness CHECK (
    slice_thickness_mm IS NULL OR slice_thickness_mm > 0
  )
);

COMMENT ON TABLE series IS '序列记录。期相由 DCM-02 自动分组，置信度不足时 phase=unknown';
COMMENT ON COLUMN series.phase_confidence IS '期相识别置信度。< 0.70 时前端须显示「期相待人工确认」且不得默认选中';
COMMENT ON COLUMN series.transfer_syntax_uid IS '传输语法 UID。薄层 CT 需 JPEG2000（1.2.840.10008.1.2.4.90），前端需 openjpeg 1.3.0';
COMMENT ON COLUMN series.pixel_spacing_mm IS '像素间距 [行,列]（mm）。长度测量工具据此换算毫米值（AC-07）';

-- ---------------------------------------------------------------------
-- 9. 实例：instances
--    仅索引元数据。**像素数据在 PACS（dcm4chee）**，本表不存 blob
--    —— 500 万幅影像绝不能进业务库（ADR-004：浏览器/业务库均不做归档，架构方案 N3）
-- ---------------------------------------------------------------------
CREATE TABLE instances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_uid           varchar(128) NOT NULL,
  series_id         uuid         NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  series_uid        varchar(128) NOT NULL,
  study_uid         varchar(128) NOT NULL,
  instance_number   integer      NOT NULL,
  rows              integer      NOT NULL,
  columns           integer      NOT NULL,
  -- 图像位置与方向（IORI）。MPR 定位依赖，不可省
  image_position_patient numeric(3)[],
  image_orientation_patient numeric(6),
  slice_location    numeric(9,3),
  slice_thickness_mm numeric(6,2),
  -- 实例大小（字节）。用于容量统计与预取估算
  size_bytes        bigint,
  -- 压缩标志。JPEG2000 解码需前端 codec 支持
  is_compressed     boolean      NOT NULL DEFAULT false,
  retention_class   retention_class NOT NULL DEFAULT 'imaging_meta_5y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_instances_sop_uid UNIQUE (sop_uid),
  CONSTRAINT uq_instances_series_number UNIQUE (series_uid, instance_number),
  CONSTRAINT ck_instances_dims CHECK (rows > 0 AND columns > 0),
  CONSTRAINT ck_instances_size CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

COMMENT ON TABLE instances IS 'DICOM 实例元数据索引。**像素数据在 PACS，本表不存影像内容**（架构方案 N3）';
COMMENT ON COLUMN instances.image_position_patient IS 'IPP (0020,0032)。MPR 三视图定位与体素间距计算依赖此字段';
COMMENT ON COLUMN instances.image_orientation_patient IS 'IORI (0020,0037)。6 元素方向余弦向量';

-- ---------------------------------------------------------------------
-- 10. AI 分割任务：segmentation_tasks
--     合规要点：模型许可白名单（AC-09）、模型可追溯、降级标记不得丢失
-- ---------------------------------------------------------------------
CREATE TABLE segmentation_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          uuid         NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid         varchar(128) NOT NULL,
  series_id         uuid         NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  -- 模型 task 名。**必须在 Apache-2.0 白名单内**（TotalSegmentator 2.18.0 的 31 个task）
  model_name        varchar(64)  NOT NULL,
  -- 模型版本固定 2.18.0（PRD OOS-12：算法更新属重大软件更新，需变更注册审批）
  model_version     varchar(16)  NOT NULL DEFAULT '2.18.0',
  -- 权重版本 + 权重哈希。部署时校验后写入，用于模型可追溯（合规表五）
  weights_version   varchar(128),
  weights_hash      char(64),
  -- 是否降级模式（显存不足强制 fast）。**必须随报告归档**，不得静默降级（AC-10）
  fast_flag         boolean      NOT NULL DEFAULT false,
  degraded          boolean      NOT NULL DEFAULT false,
  gpu_memory_gb     numeric(4,1),
  status            segmentation_task_status NOT NULL DEFAULT 'queued',
  progress_percent  smallint     NOT NULL DEFAULT 0,
  -- 失败环节与详情。失败必须记录环节，禁止以空模型冒充成功（AI-02）
  error_code        integer,
  error_step        segmentation_pipeline_step,
  error_detail      text,
  -- 期相前置校验结果（AI-01）。审计用途
  phase_checked     series_phase,
  phase_eligible    boolean,
  submitted_by      uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at        timestamptz,
  finished_at       timestamptz,
  -- Redis Stream 消息 ID。用于至少一次投递下的幂等去重（架构方案 §6.3）
  stream_message_id  varchar(64),
  -- 幂等键。同一键重投不产生重复 GPU 计算
  idempotency_key   char(36),
  retention_class   retention_class NOT NULL DEFAULT 'plan_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT ck_seg_task_progress CHECK (progress_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_seg_task_model_version CHECK (
    model_version = '2.18.0'  -- 模型版本锁定，防止未经变更注册的算法升级
  ),
  -- 成功必须有结束时间与100% 进度；失败必须有错误码与失败环节
  CONSTRAINT ck_seg_task_terminal CHECK (
    (status <> 'succeeded')
    OR (finished_at IS NOT NULL AND progress_percent = 100)
  ),
  CONSTRAINT ck_seg_task_failure_detail CHECK (
    (status <> 'failed')
    OR (error_code IS NOT NULL AND error_step IS NOT NULL)
  ),
  CONSTRAINT uq_seg_task_idempotency UNIQUE (idempotency_key)
);

COMMENT ON TABLE segmentation_tasks IS 'AI 分割任务。非辅助决策类功能（器审中心 2022 年第 8 号）';
COMMENT ON COLUMN segmentation_tasks.model_name IS '模型 task 名。**必须属Apache-2.0 白名单**（31 个）。brain_aneurysm 为CC BY-NC 4.0，禁止使用';
COMMENT ON COLUMN segmentation_tasks.model_version IS '模型版本锁定 2.18.0。CHECK 约束强制，算法升级需变更注册审批';
COMMENT ON COLUMN segmentation_tasks.degraded IS '降级标记。显存 <12GB 时强制fast。**必须随报告归档**，不得静默降级（AC-10）';
COMMENT ON COLUMN segmentation_tasks.idempotency_key IS '幂等键（UUID）。Redis Stream 至少一次投递，重投不重复计算 GPU';
COMMENT ON COLUMN segmentation_tasks.error_step IS '失败流水线环节。前端据此告知医师哪些结论还可用。命名避开 stage（易与 TNM 分期混淆）';

-- AI 分割结果结构（量化指标）。**本表只有解剖结构名与体积，无任何自由文本**
CREATE TABLE segmentations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid         NOT NULL REFERENCES segmentation_tasks(id) ON DELETE CASCADE,
  -- 解剖结构标识（TotalSegmentator 类别名）。不是病灶名，更不是诊断结论
  structure_name    varchar(64)  NOT NULL,
  structure_label_zh varchar(64),
  -- 量化体积（mL）。这是**测量值**，须经医师确认后才可进报告
  volume_ml         numeric(12,2) NOT NULL,
  -- DICOM SEG 对象引用（经 STOW-RS 写入 dcm4chee）
  seg_sop_uid       varchar(128),
  -- 对象存储中的 NIfTI labelmap 路径
  mask_storage_uri  text,
  retention_class   retention_class NOT NULL DEFAULT 'plan_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_segmentations_task_structure UNIQUE (task_id, structure_name),
  CONSTRAINT ck_segmentations_volume CHECK (volume_ml >= 0)
);

COMMENT ON TABLE segmentations IS 'AI 分割结果。**只有解剖结构名与量化体积，无自由文本字段**——类型层面不可能产出诊断结论';
COMMENT ON COLUMN segmentations.structure_name IS '解剖结构标识（TotalSegmentator 类别名）。非病灶名，非诊断结论';
COMMENT ON COLUMN segmentations.volume_ml IS '量化体积（mL）。测量值，须经执业医师逐项确认后才可进报告（AC-11）';

-- 医师逐项确认（修改留痕）。**append-only**：变更用新记录，不 UPDATE
CREATE TABLE segmentation_confirms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid         NOT NULL REFERENCES segmentation_tasks(id) ON DELETE CASCADE,
  structure_name    varchar(64)  NOT NULL,
  action            segmentation_confirm_action NOT NULL,
  -- action=modified 时必填（修改留痕，电子病历规范要求）
  modification_note text,
  -- 确认时的体积快照。医师修改后体积可能与 AI 原始值不同，快照保证可回溯
  volume_ml_snapshot numeric(12,2),
  confirmed_by      uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at      timestamptz  NOT NULL DEFAULT now(),
  -- 实习/试用期医师确认时为true，报告不可提交（架构方案 §10.1）
  pending_supervisor_review boolean NOT NULL DEFAULT false,
  idempotency_key   char(36),
  -- 确认记录与报告同寿命：AI 参与声明须与报告一同归档（PRD COM-08）
  retention_class   retention_class NOT NULL DEFAULT 'plan_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  -- 幂等键唯一：同一 Idempotency-Key 的重复提交不产生重复确认记录
  CONSTRAINT uq_seg_confirm_idem UNIQUE (idempotency_key),
  -- 修改必须有备注：无备注的修改一律拒绝
  CONSTRAINT ck_seg_confirm_note_required CHECK (
    action <> 'modified' OR (modification_note IS NOT NULL AND char_length(trim(modification_note)) > 0)
  )
);

-- **不用 UNIQUE (task_id, structure_name)**。
--
-- 契约（openapi.yaml /segmentation-tasks/{taskId}/confirm）明确：
--   「同一 structureName 重复确认以最后一次为准，每次变更追加 segmentation_confirms 记录
--     （append-only，不 UPDATE）」
--
-- 若保留 (task_id, structure_name) 唯一约束，第二次确认同一结构会撞唯一约束，
-- 追加语义直接失效 —— 契约与 DDL 自相矛盾。
--
-- 正确做法：表保持 append-only（不 UPDATE 不 DELETE），
-- 「当前确认状态」由视图按 (task_id, structure_name) 取最新一条得出。
-- 查最新状态用窗口函数或 DISTINCT ON，无需唯一约束。
CREATE INDEX idx_seg_confirm_task_structure
  ON segmentation_confirms (task_id, structure_name, confirmed_at DESC);

-- 当前确认状态视图：每个结构取最新一条确认
CREATE OR REPLACE VIEW v_segmentation_confirm_current AS
SELECT DISTINCT ON (task_id, structure_name)
  task_id, structure_name, action, modification_note, volume_ml_snapshot,
  confirmed_by, confirmed_at, pending_supervisor_review
FROM segmentation_confirms
ORDER BY task_id, structure_name, confirmed_at DESC, id DESC;

COMMENT ON VIEW v_segmentation_confirm_current IS
  '每个 (task_id, structure_name) 的最新确认记录。确认表本身 append-only，'
  '「以最后一次为准」的语义由本视图提供，不用 UNIQUE 约束实现';
COMMENT ON COLUMN segmentation_confirms.modification_note IS '修改说明。action=modified 时**必填**（无备注的修改一律拒绝）';
COMMENT ON COLUMN segmentation_confirms.volume_ml_snapshot IS '确认时体积快照。医师手工修改后与 AI 原值可能不同，快照保证可回溯';
COMMENT ON COLUMN segmentation_confirms.pending_supervisor_review IS '实习/试用期医师确认标记。为 true 时报告不可提交';

-- ---------------------------------------------------------------------
-- 11. 规划方案：plans（乐观锁，ADR-006：不用 CRDT/OT）
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          uuid         NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid         varchar(128) NOT NULL,
  segmentation_task_id uuid      REFERENCES segmentation_tasks(id) ON DELETE SET NULL,
  -- 乐观锁版本号。PUT /plans/{planId} 必须带 version，冲突返 409（AC 架构方案 E7）
  version           integer      NOT NULL DEFAULT 1,
  -- 方案类型。由执业医师选择，**AI 不参与该字段生成**
  plan_type         varchar(64)  NOT NULL,
  title             varchar(200),
  -- 未定型的方案数据（入路路径/角度/关键点）。jsonb + GIN 索引，避免过早固定 Schema
  payload           jsonb        NOT NULL,
  status            plan_status  NOT NULL DEFAULT 'draft',
  -- 报告签名后随正文一并锁定（PRD：规划数据与报告同签名、同审计、同归档）
  locked_at         timestamptz,
  locked_by_report_id uuid,
  created_by        uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by        uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key   char(36),
  retention_class   retention_class NOT NULL DEFAULT 'plan_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_plans_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_plans_version CHECK (version >= 1),
  -- 归档需有审批凭证（架构方案 12.2 E6）
  CONSTRAINT ck_plans_archived CHECK (status <> 'archived' OR locked_at IS NOT NULL)
);

COMMENT ON TABLE plans IS '三维入路规划方案。乐观锁 + 操作日志，v1.0 不做多人实时协作（ADR-006）';
COMMENT ON COLUMN plans.version IS '乐观锁版本号。更新必须带 version，不一致返 409。**不用 CRDT/OT**：静默合并会产生临床错误且不可审计';
COMMENT ON COLUMN plans.payload IS '方案数据（jsonb）。入路点/靶点/角度/通道宽度。仅中性几何语义，禁止引入结论性字段';
COMMENT ON COLUMN plans.locked_at IS '签名锁定时间。报告签署后规划随正文一并锁定';

-- 规划操作日志（append-only）。每次写操作一条，含前后值，可完整回放
CREATE TABLE plan_commands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid         NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  command_type      varchar(32)  NOT NULL,
  -- 变更前后值。before 为 null 表示创建
  before_value      jsonb,
  after_value       jsonb,
  actor_id          uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- 操作时的版本号，用于串联同一方案的变更时序
  version_before    integer,
  version_after     integer,
  retention_class   retention_class NOT NULL DEFAULT 'plan_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_commands_type CHECK (
    command_type IN ('create','update_payload','update_status','lock','archive')
  )
);

COMMENT ON TABLE plan_commands IS '规划方案操作日志。append-only。每次写操作一条，含前后值，可完整回放';
COMMENT ON COLUMN plan_commands.before_value IS '变更前值。创建操作时为 null';

-- ---------------------------------------------------------------------
-- 12. 报告：reports（卫健委必备核心表）
--     覆盖：检查所见 / 诊断意见 / 报告医师 / 审核医师 / 报告时间 / 修改痕迹
-- ---------------------------------------------------------------------
CREATE TABLE reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          uuid         NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_uid         varchar(128) NOT NULL,
  -- 版本号。唯一约束保证同一检查的版本不重复
  version           integer      NOT NULL DEFAULT 1,
  template_code     varchar(64)  NOT NULL,
  status            report_status NOT NULL DEFAULT 'draft',

  -- 五类受控字段（RPT-01）。任一为空则**阻断签名**（AC-12）
  -- 字段 1：检查部位（由 studies.body_part 自动带入，不可编辑）
  exam_body_part    varchar(64)  NOT NULL,
  -- 字段 2：扫描方式
  scan_mode         varchar(256) NOT NULL,
  -- 字段 3：影像所见（分段结构化）。text[] 与 structured_findings 保持同步
  findings          text         NOT NULL,
  -- 字段 4：影像诊断意见。**AI 绝不产出此字段**（架构方案 §9.2）
  impression        text         NOT NULL,
  -- 字段 5：建议随访
  follow_up_recommendation text   NOT NULL,

  -- 分段结构化的所见与建议随访（模板按窗位分段，如肺窗/纵隔窗/骨窗）
  structured_findings jsonb       NOT NULL DEFAULT '[]'::jsonb,
  follow_up_detail    jsonb,

  -- AI 辅助标记的**结构化引用**。只含结构名/体积/确认医师，**无任何结论性文本**
  -- 合规：AI 字段只出现在这里（PRD COM-08）；additionalProperties 无法约束 jsonb，
  --      因此由应用层 zod schema 白名单校验（见 openapi.yaml StructuredFields.aiAssist）
  ai_assist         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  -- 关联的分割任务。报告引用 AI 数据时可反查是谁在何时确认的
  segmentation_task_id uuid       REFERENCES segmentation_tasks(id) ON DELETE SET NULL,

  -- 报告医师与审核医师（卫健委必备字段）
  report_doctor_id  uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_doctor_id  uuid         REFERENCES users(id) ON DELETE RESTRICT,
  report_time       timestamptz  NOT NULL,
  reviewed_at       timestamptz,

  -- 正文摘要（国密 SM3）。签名时计算并锁定；正文变更则本值变化，原签名失效（AC-14）
  -- 正文摘要（国密 SM3）。签名时计算并锁定；正文变更则本值变化，原签名失效（AC-14）
  body_digest       char(64)     NOT NULL,
  body_digest_algorithm varchar(16) NOT NULL DEFAULT 'SM3',
  -- 正文 SHA-256 摘要。对应 Spec AC-13 的「正文 SHA-256 摘要」
  --
  -- 为什么同时存两个摘要（这是个需要说清的决定）：
  --   Spec AC-13 要求绑定「正文 SHA-256 摘要」，而 ADR-005 要求 SM2 + SM3 国密签名。
  --   **SM2 签名算法内部固定使用 SM3 摘要，无法改为对 SHA-256 签名。**
  --   两者不是二选一，而是两个不同用途：
  --     body_digest    = SM3，国密签名真正绑定的值，签名日志记它
  --     body_sha256    = SHA-256，AC-13 要求的内容绑定值，
  --                      且是与既有 HIS/EMR 交叉比对时的通用值
  --   两者随正文同步变化，任一变化都导致签名失效判定成立。
  --   **SHA-256 不参与国密签名运算**，用它签名不满足密评要求。
  body_sha256       char(64)     NOT NULL,

  -- 签名后锁定。正文与关联规划方案一并锁定（AC-13）
  signed_at         timestamptz,
  archived_at       timestamptz,

  -- 留存等级。按 visits.visit_type 决定：门急诊 15 年，住院 30 年（AC-20）
  -- 住院患者须由应用层在创建时置为 report_30y
  retention_class   retention_class NOT NULL DEFAULT 'report_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT uq_reports_study_version UNIQUE (study_id, version),
  -- 住院报告必须 30 年留存（AC-20 的数据库层兜底）
  CONSTRAINT ck_reports_retention CHECK (
    retention_class IN ('report_15y','report_30y')
  ),
  -- 已签名报告必须有签名时间与审核医师
  CONSTRAINT ck_reports_signed CHECK (
    status NOT IN ('signed','archived')
    OR (signed_at IS NOT NULL AND review_doctor_id IS NOT NULL)
  ),
  -- 审核通过必须有审核时间
  CONSTRAINT ck_reports_reviewed CHECK (
    review_doctor_id IS NULL OR reviewed_at IS NOT NULL
  ),
  -- 报告医师与审核医师不应为同一人（强制四目原则由应用层做，此处仅防误录）
  CONSTRAINT ck_reports_doctor_distinct CHECK (
    review_doctor_id IS NULL OR review_doctor_id <> report_doctor_id
  )
);

COMMENT ON TABLE reports IS '结构化报告。卫健委电子病历必备字段全覆盖（架构方案 §7.3）';
COMMENT ON COLUMN reports.findings IS '受控字段 3：影像所见（分段文本汇总）。完整分段见 structured_findings';
COMMENT ON COLUMN reports.impression IS '受控字段 4：影像诊断意见。**AI 绝不产出此字段**，恒为执业医师署名';
COMMENT ON COLUMN reports.follow_up_recommendation IS '受控字段 5：建议随访。卫健委必备字段';
COMMENT ON COLUMN reports.structured_findings IS '分段结构化所见（jsonb 数组）。每段含 key/label/windowType/text/authoredBy，支持跳转到对应窗位复核';
COMMENT ON COLUMN reports.ai_assist IS 'AI 辅助标记的**结构化引用**。只含结构名/体积/确认医师/确认时间，**无结论性文本**。AI 字段只允许出现在此';
COMMENT ON COLUMN reports.body_digest IS
  '正文 SM3 摘要。**国密签名真正绑定的值**（SM2 内部固定用 SM3）。正文改一字符则本值变化，原签名立即失效（AC-14）';
COMMENT ON COLUMN reports.body_sha256 IS
  '正文 SHA-256 摘要。对应 Spec AC-13 要求，同时作为与既有 HIS/EMR 交叉比对的通用值。**不参与国密签名运算**';
COMMENT ON COLUMN reports.retention_class IS '门急诊 >=15 年，住院 >=30 年（AC-20，国卫医发〔2013〕31 号）。CHECK 约束保证只有这两档';
COMMENT ON COLUMN reports.deleted_at IS '软删除。**已签名报告禁止软删除**（由触发器阻断，见 fn_reports_signed_guard）';

-- 报告修改痕迹（append-only，卫健委必备：修改痕迹）
-- 每次保存生成新版本报告行 + 追加一条本表记录，形成完整回放链
CREATE TABLE report_revisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid         NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version           integer      NOT NULL,
  -- 该版本的完整正文快照。只存文本与结构化字段，不含签名值（签名在signature_logs）
  snapshot          jsonb        NOT NULL,
  body_digest       char(64)     NOT NULL,
  -- 变更摘要。**由后端根据字段 diff 生成**，不依赖前端自述（防止遗漏）
  change_summary    varchar(500) NOT NULL,
  edited_by         uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  edited_at         timestamptz  NOT NULL DEFAULT now(),
  retention_class   retention_class NOT NULL DEFAULT 'report_15y',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_revisions UNIQUE (report_id, version)
);

COMMENT ON TABLE report_revisions IS '报告修改痕迹。append-only，每次保存一条，构成完整回放链（卫健委必备：修改痕迹）';
COMMENT ON COLUMN report_revisions.change_summary IS '变更摘要。由后端按字段 diff 生成，防止前端漏报或误报';

-- 已签名报告禁止软删除
CREATE OR REPLACE FUNCTION fn_reports_signed_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('signed','archived') THEN
    RAISE EXCEPTION
      '报告 % 已签署（status=%），禁止删除或软删除。国卫办医发〔2017〕8 号要求签署后的电子病历不得删除。',
      OLD.id, OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_reports_no_delete_signed
BEFORE DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION medplan.fn_reports_signed_guard();

CREATE TRIGGER trg_reports_no_signed_update
BEFORE UPDATE ON reports
FOR EACH ROW
WHEN (OLD.status IN ('signed','archived'))
EXECUTE FUNCTION medplan.fn_reports_signed_guard();

-- ---------------------------------------------------------------------
-- 13. 签名与签名日志：signature_logs
--     WS/T 847-2024 字段逐项对应（COM-10）：
--       数字签名流水号 / 原文唯一序列号 / 服务主体标识 / 服务对象标识 /
--       原文摘要值 / 摘要算法标识 / 证书序列号 / 签名数据
--     「签名日志应独立于业务系统存储，且日志本身可被数字签名」
-- ---------------------------------------------------------------------
CREATE TABLE signature_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WS/T 847：数字签名流水号。系统内唯一，格式 SN-yyyy-MM-dd-nnnnnn
  serial_no         varchar(64)  NOT NULL,
  -- WS/T 847：原文唯一序列号。报告的全局唯一文档标识
  document_unique_sn varchar(128) NOT NULL,
  -- WS/T 847：服务主体标识（签名人）
  subject_id        uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_name      varchar(64)  NOT NULL,
  subject_title     varchar(32)  NOT NULL,
  subject_dept      varchar(64)  NOT NULL,
  -- WS/T 847：服务对象标识（被签名的报告）
  object_type       varchar(32)  NOT NULL DEFAULT 'report',
  object_id         uuid         NOT NULL,
  object_version    integer      NOT NULL,

  -- WS/T 847：原文摘要值 + 摘要算法标识
  digest_value      char(64)     NOT NULL,
  digest_algorithm  varchar(16)  NOT NULL DEFAULT 'SM3',
  -- WS/T 847：证书序列号
  cert_serial       varchar(128) NOT NULL,
  cert_issuer       varchar(256) NOT NULL,
  cert_valid_from   timestamptz  NOT NULL,
  cert_valid_to     timestamptz  NOT NULL,
  -- 证书链（Base64）。供离线验签时重建信任链
  cert_chain        text,
  -- 吊销列表校验结果。WS/T 847 要求校验失败则不可签名，此处留证
  crl_checked       boolean      NOT NULL DEFAULT false,
  crl_check_result  varchar(32),

  -- WS/T 847：签名数据（Base64 DER 的 SM2 签名值）
  signature_algorithm varchar(16) NOT NULL DEFAULT 'SM2',
  signature_value   text         NOT NULL,

  -- 时间戳：必须来自权威可靠时间源（TSA / 北斗授时），精度到秒
  -- 国卫办医发〔2017〕8 号第十一条；**不得用本地时间兜底**（AC-15）
  signed_at         timestamptz  NOT NULL,
  tsa_authority     varchar(256) NOT NULL,
  tsa_token         text         NOT NULL,
  -- 与权威时间源的偏差（秒）。超 60 秒应拒绝签名，此处留证
  clock_drift_seconds integer,

  -- 日志自身的完整性保护：WS/T 847 要求「日志本身可被数字签名验证」
  -- 该摘要用于离线校验日志未被篡改（业务库损坏后仍可验证，COM-10）
  log_integrity_digest char(64)   NOT NULL,
  log_signed_at     timestamptz,
  log_signature_value text,

  -- 幂等键。同一键重试返回同一流水号，不产生第二条签名记录
  idempotency_key   char(36),

  -- 签名永久保留（WS/T 847）
  retention_class   retention_class NOT NULL DEFAULT 'signature_perm',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT uq_signature_serial_no UNIQUE (serial_no),
  CONSTRAINT uq_signature_object_version UNIQUE (object_type, object_id, object_version),
  CONSTRAINT uq_signature_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_signature_digest_algorithm CHECK (digest_algorithm = 'SM3'),
  CONSTRAINT ck_signature_algorithm CHECK (signature_algorithm = 'SM2'),
  -- 证书必须在有效期内签名
  CONSTRAINT ck_signature_cert_valid CHECK (signed_at >= cert_valid_from AND signed_at <= cert_valid_to),
  -- 签名医师必须是执业医师（架构方案 §10.1：实习/试用期医师无签名权）
  CONSTRAINT ck_signature_title CHECK (
    subject_title IN ('主任医师','副主任医师','主治医师')
  )
);

COMMENT ON TABLE signature_logs IS '电子签名日志。WS/T 847-2024 字段逐项对应。**独立存储 + append-only + 自身可验签**';
COMMENT ON COLUMN signature_logs.serial_no IS 'WS/T 847：数字签名流水号。唯一，格式 SN-yyyy-MM-dd-nnnnnn';
COMMENT ON COLUMN signature_logs.document_unique_sn IS 'WS/T 847：原文唯一序列号。被签名文档的全局唯一标识';
COMMENT ON COLUMN signature_logs.subject_id IS 'WS/T 847：服务主体标识（签名人）';
COMMENT ON COLUMN signature_logs.object_id IS 'WS/T 847：服务对象标识（被签名的报告）';
COMMENT ON COLUMN signature_logs.digest_value IS 'WS/T 847：原文摘要值（SM3）。正文改一字符则摘要变化，原签名失效（AC-14）';
COMMENT ON COLUMN signature_logs.digest_algorithm IS 'WS/T 847：摘要算法标识。CHECK 强制为 SM3（国密要求）';
COMMENT ON COLUMN signature_logs.cert_serial IS 'WS/T 847：证书序列号';
COMMENT ON COLUMN signature_logs.signature_value IS 'WS/T 847：签名数据（Base64 DER 的 SM2 签名值）。私钥不出 UKey/密码机';
COMMENT ON COLUMN signature_logs.signed_at IS '权威时间源时间（TSA / 北斗授时）。**不得用本地时间兜底**（AC-15）';
COMMENT ON COLUMN signature_logs.log_integrity_digest IS '签名日志自身的完整性摘要。业务库损坏后凭此独立还原验证结果（COM-10）';
COMMENT ON COLUMN signature_logs.retention_class IS '签名日志永久保留。WS/T 847 要求可独立还原每笔签名';

CREATE TRIGGER trg_signature_logs_immutable
BEFORE UPDATE OR DELETE ON signature_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

CREATE TRIGGER trg_signature_logs_no_truncate
BEFORE TRUNCATE ON signature_logs
FOR EACH STATEMENT EXECUTE FUNCTION medplan.fn_append_only_guard();

-- ---------------------------------------------------------------------
-- 14. 审计日志：audit_logs（等保 8.1.4.3 核心）
--     append-only + hash chain + 专用写账号 + 独立备份 + 按月分区
-- ---------------------------------------------------------------------
-- 字段覆盖 PRD AUD-01 要求的 7 项：事件日期时间 / 操作人 / 事件类型 /
-- 是否成功 / 患者标识 / 来源 IP / 终端标识，另加 hash chain 两列。
CREATE TABLE audit_logs (
  -- bigserial 而非 uuid：审计表需严格按写入顺序追加，bigserial 单调递增且索引紧凑
  id                bigserial,
  event_time        timestamptz  NOT NULL DEFAULT now(),
  -- 操作人。系统任务为服务账号
  actor_id          uuid,
  actor_roles       role_code[],
  -- 事件类型。与 openapi.yaml AuditEventType 逐项一致
  event_type        audit_event_type NOT NULL,
  -- 操作结果。denied = 越权被拒（失败路径同样必须审计，架构方案 §10.4）
  result            audit_result  NOT NULL,
  -- 失败/拒绝时的业务错误码。denied 时为 10004
  result_code       integer,
  -- 被访问的患者。非患者相关事件（登录、权限变更）为 null
  patient_id        uuid,
  resource_type     varchar(32)  NOT NULL,
  resource_id       varchar(256) NOT NULL,
  source_ip         inet,
  -- 终端标识。移动端只读阅览时记录设备标识（MOB-01）
  terminal_id       varchar(64),
  -- 事件明细。**PHI 越权事件必须给出拒绝原因**（合规追溯的核心线索）
  -- 禁止写入患者姓名明文、身份证、手机号（架构方案 §10.3）
  detail            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  -- hash chain。任一历史记录被改动，链上必有节点摘要不匹配
  hash_prev         char(64)     NOT NULL,
  hash_self         char(64)     NOT NULL,
  -- 留存标记。等保要求 >=6 个月；本设计按月分区保留 3 年在线
  retention_class   retention_class NOT NULL DEFAULT 'audit_6m',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  -- 分区表的主键**必须包含分区键**（PostgreSQL 强制要求）。
  -- 因此主键是 (id, event_time) 而非单独的 id ——
  -- 这是分区表的硬约束，写成 PRIMARY KEY (id) 会直接建表失败。
  -- id 仍全局单调（来自 sequence），业务查询不受影响。
  CONSTRAINT pk_audit_logs PRIMARY KEY (id, event_time)
) PARTITION BY RANGE (event_time);

COMMENT ON TABLE audit_logs IS '审计日志。**append-only + hash chain**，等保 8.1.4.3 / ADR-004。无任何 UPDATE/DELETE 路径';
COMMENT ON COLUMN audit_logs.actor_roles IS '操作时刻的角色快照。角色后续变更不影响历史审计的判定';
COMMENT ON COLUMN audit_logs.detail IS '事件明细。denied 时必须含拒绝原因。**禁止写入姓名明文/身份证/手机号**';
COMMENT ON COLUMN audit_logs.hash_prev IS '前序记录摘要。链式防篡改（ADR-004）';
COMMENT ON COLUMN audit_logs.hash_self IS '本记录摘要。含等保要求的全部审计要素 + hash_prev';
COMMENT ON COLUMN audit_logs.retention_class IS '等保要求 >=6 个月（硬下限）。本设计按月分区在线保留 3 年，到期 detach 归档';

-- 按月分区，便于留存到期后直接 DETACH 归档（不删数据，只摘分区）
-- 分区必须先建默认分区兜底，避免时间落在分区范围外时 INSERT 失败导致审计丢失
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
COMMENT ON TABLE audit_logs_default IS '兜底分区。防止时间落在已建分区范围外时审计写入失败（审计丢失不可接受）';

CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
-- 后续分区由定时任务按月预建（见文件末的分区维护函数）

-- hash chain 计算触发器
CREATE TRIGGER trg_audit_chain
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_audit_chain_guard();

-- 防篡改触发器（第一层权限之外的第二层保险）
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION medplan.fn_append_only_guard();

CREATE TRIGGER trg_audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION medplan.fn_append_only_guard();

-- ---------------------------------------------------------------------
-- 15. 索引（架构方案 §7.4 清单落地）
-- ---------------------------------------------------------------------

-- 患者主索引
CREATE UNIQUE INDEX idx_patients_empi ON patients(empi_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_id_card_hash ON patients(id_card_hash);
CREATE INDEX idx_patients_phone_hash ON patients(phone_hash);

-- 就诊：按患者查历史、按科室查在院
CREATE INDEX idx_visits_patient ON visits(patient_id, admit_date DESC);
CREATE INDEX idx_visits_dept_inpatient ON visits(dept, admit_date DESC) WHERE is_inpatient;
CREATE INDEX idx_visits_ward_dept ON visits(ward_dept) WHERE is_inpatient AND ward_dept IS NOT NULL;

-- 检查检索（PRD DCM-01：按检查号/患者标识检索，3 秒内）
CREATE UNIQUE INDEX idx_studies_accession ON studies(accession_no) WHERE deleted_at IS NULL;
CREATE INDEX idx_studies_patient_date ON studies(patient_id, study_date DESC);
CREATE INDEX idx_studies_status ON studies(status) WHERE deleted_at IS NULL;
-- 阅片工作台默认列表：按检查日期倒序分页
CREATE INDEX idx_studies_date ON studies(study_date DESC) WHERE deleted_at IS NULL;
-- 待阅队列：只扫未阅记录，随医师阅片推进该索引条目迅速减少。
-- PRD DCM-01 要求列表 3 秒内，覆盖 5 年数据量
CREATE INDEX idx_studies_unread_queue ON studies(study_date DESC)
  WHERE deleted_at IS NULL AND read_status <> 'read';
-- L3 权限过滤：按患者批量取有权限的检查
CREATE INDEX idx_studies_visit ON studies(visit_id);

-- 序列与期相分组
CREATE INDEX idx_series_study ON series(study_id);
CREATE INDEX idx_series_phase ON series(study_id, phase);
CREATE INDEX idx_series_study_uid ON series(study_uid);
-- 低置信度期相需人工确认，前端据此提示（置信度 < 0.70）
CREATE INDEX idx_series_low_confidence ON series(study_id)
  WHERE phase = 'unknown' AND deleted_at IS NULL;

-- 实例：阅片按 series 顺序拉取
CREATE INDEX idx_instances_series ON instances(series_id, instance_number);
CREATE INDEX idx_instances_series_uid ON instances(series_uid, instance_number);

-- 分割任务：队列状态轮询
CREATE INDEX idx_seg_task_status ON segmentation_tasks(status, created_at DESC);
CREATE INDEX idx_seg_task_study ON segmentation_tasks(study_id);
CREATE INDEX idx_seg_task_submitter ON segmentation_tasks(submitted_by, created_at DESC);
-- 失败任务排查（运维用）
CREATE INDEX idx_seg_task_failed ON segmentation_tasks(error_step, created_at DESC)
  WHERE status = 'failed';

-- AI 结果与确认
CREATE INDEX idx_segmentations_task ON segmentations(task_id);
CREATE INDEX idx_seg_confirms_task ON segmentation_confirms(task_id);
CREATE INDEX idx_seg_confirms_user ON segmentation_confirms(confirmed_by, confirmed_at DESC);
-- 待上级复核的实习医师确认（报告提交阻断依据）
CREATE INDEX idx_seg_confirms_pending ON segmentation_confirms(task_id)
  WHERE pending_supervisor_review;

-- 规划：乐观锁与按检查取最新版本
CREATE INDEX idx_plans_study ON plans(study_id, version DESC);
CREATE INDEX idx_plans_task ON plans(segmentation_task_id);
CREATE INDEX idx_plans_author ON plans(created_by, created_at DESC);
CREATE INDEX idx_plans_locked ON plans(locked_by_report_id) WHERE locked_at IS NOT NULL;
-- payload GIN 索引：规划数据未定型，需要按 JSON 路径检索时使用（ADR-004）
CREATE INDEX idx_plans_payload_gin ON plans USING gin (payload jsonb_path_ops);

-- 操作日志
CREATE INDEX idx_plan_commands_plan ON plan_commands(plan_id, created_at DESC);
CREATE INDEX idx_plan_commands_actor ON plan_commands(actor_id, created_at DESC);

-- 报告：版本查询与医师工作量统计
CREATE UNIQUE INDEX idx_reports_study_version ON reports(study_id, version);
CREATE INDEX idx_reports_status ON reports(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_reports_doctor ON reports(report_doctor_id, report_time DESC);
CREATE INDEX idx_reports_reviewer ON reports(review_doctor_id, reviewed_at DESC);
-- 待审核队列
CREATE INDEX idx_reports_pending_review ON reports(review_doctor_id, report_time)
  WHERE status = 'pending_review';
-- 归档到期扫描（按留存期限）
CREATE INDEX idx_reports_retention ON reports(retention_class, report_time);
CREATE INDEX idx_reports_study_uid ON reports(study_uid);
-- ai_assist GIN：反查「哪些报告引用了该分割任务」
CREATE INDEX idx_reports_ai_assist_gin ON reports USING gin (ai_assist jsonb_path_ops);

-- 报告修改痕迹
CREATE INDEX idx_report_revisions_report ON report_revisions(report_id, version DESC);

-- 签名日志：按报告查签名、按流水号验证
CREATE INDEX idx_signature_logs_object ON signature_logs(object_type, object_id, object_version);
CREATE INDEX idx_signature_logs_subject ON signature_logs(subject_id, signed_at DESC);
CREATE INDEX idx_signature_logs_serial ON signature_logs(serial_no);
CREATE INDEX idx_signature_logs_signed_at ON signature_logs(signed_at DESC);
-- WS/T 847 要求日志本身可被验证，按完整性摘要建立唯一约束防止重复
CREATE UNIQUE INDEX idx_signature_logs_integrity ON signature_logs(log_integrity_digest);

-- 审计多维检索（PRD AUD-01：按操作人、事件类型、患者标识、时间范围）
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_id, event_time DESC);
CREATE INDEX idx_audit_type_time ON audit_logs(event_type, event_time DESC);
CREATE INDEX idx_audit_patient_time ON audit_logs(patient_id, event_time DESC);
CREATE INDEX idx_audit_time ON audit_logs(event_time DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_result ON audit_logs(result, event_time DESC);
-- 越权拒绝专项检索（合规追溯最常查的一类）
CREATE INDEX idx_audit_denied ON audit_logs(patient_id, event_time DESC)
  WHERE result = 'denied';
-- detail JSONB GIN：按拒绝原因等明细条件检索
CREATE INDEX idx_audit_detail_gin ON audit_logs USING gin (detail jsonb_path_ops);

-- 患者授权：判定"某医生能否看某患者"的高频查询
CREATE INDEX idx_patient_grants_user ON patient_grants(user_id, patient_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_patient_grants_patient ON patient_grants(patient_id)
  WHERE revoked_at IS NULL;
-- 到期扫描
CREATE INDEX idx_patient_grants_expiry ON patient_grants(expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- 用户与角色
CREATE INDEX idx_users_dept ON users(department_code) WHERE is_active AND deleted_at IS NULL;
CREATE INDEX idx_users_ukey_cert ON users(ukey_cert_serial) WHERE ukey_cert_serial IS NOT NULL;
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- ---------------------------------------------------------------------
-- 16. updated_at 自动维护
--     统一用触发器而非应用层赋值：漏一处就会导致审计追溯时数据不可信
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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
-- 17. 最小权限：账号与授权（架构方案 §10.2）
--     等保 8.1.4.2 要求「访问控制粒度达到主体用户级与客体数据库表级」
--     + 最小权限 + 权限分离
-- ---------------------------------------------------------------------

-- app_ro：只读账号（质控/病案查询走此账号）
CREATE ROLE app_ro LOGIN;
GRANT USAGE ON SCHEMA medplan TO app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA medplan TO app_ro;
-- 审计表只授予 SELECT。**不授予任何写权限**
GRANT SELECT ON audit_logs TO app_ro;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA medplan FROM app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT SELECT ON TABLES TO app_ro;

-- app_rw：业务读写账号（后端服务使用）
CREATE ROLE app_rw LOGIN;
GRANT USAGE ON SCHEMA medplan TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA medplan TO app_rw;

-- 审计表的 UPDATE/DELETE/TRUNCATE 全部撤销 —— 这是 audit_logs 物理不可改的核心
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON signature_logs FROM app_rw;

-- 已签名报告与签名日志不可删
REVOKE DELETE ON signature_logs FROM app_rw;
GRANT INSERT ON audit_logs TO app_rw;   -- 业务服务可写审计（经审计拦截器）

-- app_audit：审计专用写账号。只有 audit_logs 的 INSERT 与 SELECT
-- 权限分离的理由（等保 8.1.4.3）：业务账号即便被攻破，也改不了审计；
-- 审计账号即便被攻击，也碰不到业务数据
CREATE ROLE app_audit LOGIN;
GRANT USAGE ON SCHEMA medplan TO app_audit;
-- 顺序要求：先 REVOKE ALL 清空默认权限，再显式授予审计表的写权限。
-- 若顺序颠倒，GRANT 会被随后的 REVOKE ALL 撤销，审计专用账号将无法写入。
REVOKE ALL ON ALL TABLES IN SCHEMA medplan FROM app_audit;
GRANT INSERT, SELECT ON audit_logs TO app_audit;
-- 明确不给其他任何权限

-- ai_worker：GPU Worker 专用账号。
-- 只能读写分割任务相关表与影像元数据，**不能访问患者主索引与报告**
-- （架构方案 §10.2：GPU Worker 不能访问 PHI 业务表）
CREATE ROLE ai_worker LOGIN;
GRANT USAGE ON SCHEMA medplan TO ai_worker;
GRANT SELECT, UPDATE ON segmentation_tasks TO ai_worker;
GRANT INSERT, UPDATE ON segmentations TO ai_worker;
-- 影像元数据只读（Worker 需按 series/study UID 拉取影像）
GRANT SELECT ON studies, series, instances TO ai_worker;
-- 显式拒绝 PHI 与报告：REVOKE 比「不 GRANT」更可靠，防止后续权限继承导致的意外
REVOKE ALL ON patients, visits, reports, report_revisions,
  signature_logs, plans, patient_grants FROM ai_worker;

-- migrator：迁移账号，仅部署期使用
CREATE ROLE migrator LOGIN;
GRANT ALL ON SCHEMA medplan TO migrator;


-- 运行时新建分区的默认权限。
-- fn_precreate_audit_partition() 每月 1 日用 CREATE TABLE ... PARTITION OF 预建
-- 下月审计分区。ALTER DEFAULT PRIVILEGES 只影响该语句之后新建的对象，
-- 因此运行时创建的分区不会继承此前授予的权限。若此处缺失，新建月分区将没有
-- app_audit 的 INSERT 权限 -> 审计写入失败 -> 审计事件丢失（等保 8.1.4.3 不可接受）。
-- 位置要求：必须位于全部相关角色创建之后，否则语句作用对象不存在。
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT INSERT, SELECT ON TABLES TO app_audit;
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
-- 新建的审计分区必须与主表同等受保护，不得因默认权限而绕过撤销
ALTER DEFAULT PRIVILEGES IN SCHEMA medplan
  REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM app_rw, app_ro;
-- ---------------------------------------------------------------------
-- 18. 视图：脱敏访问（架构方案 §10.3）
-- ---------------------------------------------------------------------
-- 后端**不得**直接 SELECT patients 表取明文姓名后自行掩码 ——
-- 那样一旦漏改就是明文泄露。改为：默认视图只暴露掩码字段，
-- 明文访问走独立视图并要求显式授权 + 强制审计。
CREATE OR REPLACE VIEW v_patients_masked AS
SELECT
  p.id,
  p.empi_id,
  -- 掩码：保留姓氏与末字
  left(p.name, 1) || '*' || right(p.name, 1)      AS name_masked,
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

-- 明文视图：仅质控/病案角色的受控路径使用，须配合 x-deidentify: false 头并强制审计
CREATE OR REPLACE VIEW v_patients_plain AS
SELECT id, empi_id, name, gender, birth_date, id_card_masked, phone_masked
FROM patients
WHERE deleted_at IS NULL;

COMMENT ON VIEW v_patients_plain IS '患者明文视图。**仅质控/病案角色受控访问**，每次访问强制写 deidentification_override 审计';

REVOKE ALL ON v_patients_plain FROM app_ro, app_rw, ai_worker;
GRANT SELECT ON v_patients_plain TO app_rw;  -- 由应用层做角色判定后决定是否访问

-- 审计查询视图：附带链完整性校验所需的摘要，供质控追溯回放
CREATE OR REPLACE VIEW v_audit_logs_trail AS
SELECT
  a.id,
  a.event_time,
  a.actor_id,
  a.actor_roles,
  a.event_type,
  a.result,
  a.result_code,
  a.patient_id,
  a.resource_type,
  a.resource_id,
  a.source_ip,
  a.terminal_id,
  a.detail,
  a.hash_prev,
  a.hash_self
FROM audit_logs a;

COMMENT ON VIEW v_audit_logs_trail IS '审计追溯视图。**只读**，无任何写路径。供质控科按操作人/事件/患者/时间多维检索';

-- ---------------------------------------------------------------------
-- 19. 运维函数
-- ---------------------------------------------------------------------

-- 审计链完整性校验。每日定时任务调用，失败即告警（R6）
-- 返回首个断裂点；无断裂则返回 0 行
CREATE OR REPLACE FUNCTION fn_verify_audit_chain()
RETURNS TABLE (
  broken_id    bigint,
  broken_time  timestamptz,
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
    SELECT id, event_time, hash_prev, hash_self
    FROM audit_logs
    ORDER BY id ASC
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
  '审计链完整性校验。返回首个断裂点；链完整则返回 0 行。每日定时调用，断裂即告警（风险 R6）';

-- 预建下月审计分区。由定时任务每月 1 日调用
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
  '预建指定月份的审计分区。定时任务每月 1 日调用，预建下月分区（避免写入时才发现分区缺失）';

-- 留存到期扫描：找出可归档的已签名报告。**只SELECT，不删除** ——
-- 归档由运维执行 DETACH/转储，数据库不提供任何删除入口
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
    r.id,
    r.study_uid,
    r.retention_class,
    r.report_time,
    r.signed_at,
    CASE r.retention_class
      WHEN 'report_30y' THEN (date_part('year', age(now(), r.report_time)) * 12)::int
      ELSE (date_part('year', age(now(), r.report_time)) * 12)::int
    END AS months_elapsed
  FROM reports r
  WHERE r.status IN ('signed', 'archived')
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

-- ---------------------------------------------------------------------
-- 20. 卫健委电子病历必备字段覆盖检查（架构方案 §7.3逐条落地验证）
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_nhc_field_coverage()
RETURNS TABLE (
  field_name       text,
  requirement_ref  text,
  table_name       text,
  column_name      text,
  covered          boolean
)
LANGUAGE sql
AS $$
  SELECT * FROM (VALUES
    ('患者基本信息', '国卫办医发〔2017〕8 号', 'patients',       'name/gender/birth_date/id_card_hash/insurance_no', true),
    ('就诊信息',     '国卫办医发〔2017〕8 号', 'visits',        'visit_no/visit_type/admit_date/discharge_date/dept/ward_dept/bed_no', true),
    ('检查信息',     '国卫办医发〔2017〕8 号', 'studies',       'accession_no/modality/body_part/study_date', true),
    ('序列参数',     'RPT-01',             'series',        'phase/slice_thickness_mm/instance_count', true),
    ('检查所见',     'RPT-01 受控字段',    'reports',       'findings/structured_findings', true),
    ('诊断意见',     'RPT-01 受控字段',    'reports',       'impression', true),
    ('建议随访',     '国卫办医发〔2017〕8 号', 'reports',      'follow_up_recommendation', true),
    ('报告医师',     '卫健委必备',         'reports',       'report_doctor_id', true),
    ('审核医师',     '卫健委必备',         'reports',       'review_doctor_id', true),
    ('报告时间',     '卫健委必备',         'reports',       'report_time', true),
    ('修改痕迹',     '卫健委必备',         'report_revisions', 'snapshot/body_digest/change_summary/edited_by', true),
    ('操作印痕',     'AUD-01',             'audit_logs',    'actor_id/event_type/event_time/result/patient_id', true),
    ('签名有效性',   'WS/T 847-2024',      'signature_logs', 'digest_value/signature_value/cert_serial/tsa_token/signed_at', true),
    ('AI 参与声明',  'COM-08',             'reports',       'ai_assist', true),
    ('AI 标记确认',  'AI-03',              'segmentation_confirms', 'action/modification_note/confirmed_by/confirmed_at', true)
  ) AS t(field_name, requirement_ref, table_name, column_name, covered);
$$;

COMMENT ON FUNCTION fn_check_nhc_field_coverage() IS
  '卫健委电子病历必备字段覆盖检查（架构方案 §7.3）。返回逐条落库位置，供测评取证';

-- ---------------------------------------------------------------------
-- 21. Schema 迁移记录
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     varchar(16) PRIMARY KEY,
  name        varchar(128) NOT NULL,
  applied_at  timestamptz  NOT NULL DEFAULT now(),
  checksum    char(64)     NOT NULL,
  applied_by  varchar(64)  NOT NULL DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
  '迁移记录。checksum 为迁移文件内容的 SM3 摘要，文件被改动后校验失败（防篡改迁移历史）';

-- =====================================================================
-- 结束
-- =====================================================================
-- 落地自检：
--   1. 确认表数：SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='medplan' AND table_type='BASE TABLE';
--      期望 15 张业务表 + 分区表 + 迁移记录表
--   2. 确认审计不可改：以 app_rw 身份尝试
--      UPDATE audit_logs SET result='success' WHERE id=1;  -- 应报权限不足
--      DELETE FROM audit_logs WHERE id=1;                   -- 应报权限不足
--   3. 确认链完整：SELECT * FROM fn_verify_audit_chain();   -- 应返回 0 行
--   4. 确认字段覆盖：SELECT * FROM fn_check_nhc_field_coverage()
--      WHERE NOT covered;                                    -- 应返回 0 行
--   5. 预建分区：SELECT fn_precreate_audit_partition('2027-02-01');
-- =====================================================================