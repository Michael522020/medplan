-- ============================================================
-- Phase 4 QA 种子数据：越权时序不可区分性实测
-- ============================================================
-- 三种场景：
--   患者 A / STUDY_A  —— 攻击者**有权限**（通过 patient_grants 授权）
--   患者 B / STUDY_B  —— 患者**存在但无权限**（越权 -> 期望 10004）
--   患者 C / STUDY_C  —— **完全不存在**（期望 10004）
--
-- 用户 DR_QA 在 dept = 'RADIOLOGY'，非全局角色，非实习医师。
-- 攻击者 = DR_QA（只能看 A，看不到 B，C 不存在）。
-- ============================================================

SET search_path TO medplan, public;

-- 幂等：先清空 QA 相关数据（保留 schema_migrations 与角色定义）
-- 注意：不能用 TRUNCATE ... CASCADE —— 它会级联到 signature_logs，
-- 而该表有 append-only 触发器会拒绝 TRUNCATE（此处恰好验证了防护生效）。
DELETE FROM medplan.reports;
DELETE FROM medplan.series;
DELETE FROM medplan.studies;
DELETE FROM medplan.patient_grants;
DELETE FROM medplan.visits;
DELETE FROM medplan.patients;
DELETE FROM medplan.user_roles;
DELETE FROM medplan.users;

-- ---- 用户 ----
INSERT INTO users (id, login_name, display_name, keycloak_subject, title, department_code)
VALUES ('11111111-1111-4111-8111-111111111111', 'dr.qa', 'QA 测试医师', 'kc-qa-1', 'attending', 'RADIOLOGY');

-- ---- 患者 A（已授权） / 患者 B（存在但无授权） ----
INSERT INTO patients (id, empi_id, name, gender, birth_date, id_card_masked)
VALUES
  ('22222222-2222-4222-8222-222222222222', 'EMPI0000000001', '患者甲', 'M', '1980-01-01', '310***********0001'),
  ('33333333-3333-4333-8333-333333333333', 'EMPI0000000002', '患者乙', 'F', '1975-06-15', '310***********0002');

-- ---- 就诊：A 在 RADIOLOGY 科室（dept 规则也会放行），B 在 CARDIOLOGY ----
-- 注意：A 同时被 grant 规则授权，保证「有权限」路径确实走 EXISTS 分支。
INSERT INTO visits (id, visit_no, patient_id, visit_type, admit_date, dept, ward_dept, is_inpatient)
VALUES
  ('44444444-4444-4444-8444-444444444444', 'V-QA-A', '22222222-2222-4222-8222-222222222222', 'outpatient', '2026-10-20', 'RADIOLOGY', NULL, false),
  ('55555555-5555-4555-8555-555555555555', 'V-QA-B', '33333333-3333-4333-8333-333333333333', 'outpatient', '2026-10-21', 'CARDIOLOGY', NULL, false);

-- ---- 授权：DR_QA 对患者 A 有 read 授权 ----
INSERT INTO patient_grants (patient_id, user_id, scope, grant_reason, granted_by)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'read', 'QA 时序基线：授权场景', '11111111-1111-4111-8111-111111111111');

-- ---- 检查 A（有权限）/ 检查 B（存在但无权限） ----
INSERT INTO studies (id, study_uid, visit_id, patient_id, accession_no, modality, body_part, study_description, study_date)
VALUES
  ('66666666-6666-4666-8666-666666666666', '1.2.840.10008.5.1.4.1.1.2.9001', '44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'ACC-QA-A', 'CT', 'ABDOMEN', 'QA 授权基线检查', '2026-10-20 08:00:00+08'),
  ('77777777-7777-4777-8777-777777777777', '1.2.840.10008.5.1.4.1.1.2.9002', '55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', 'ACC-QA-B', 'CT', 'CHEST', 'QA 越权基线检查', '2026-10-21 08:00:00+08');

-- ---- 序列：A 有 3 个序列（含期相），B 有 1 个序列 ----
INSERT INTO series (series_uid, study_id, study_uid, series_number, series_description, phase, phase_confidence, instance_count, slice_thickness_mm, rows, columns)
VALUES
  ('SER-QA-A1', '66666666-6666-4666-8666-666666666666', '1.2.840.10008.5.1.4.1.1.2.9001', 1, '平扫', 'plain', 0.950, 120, 5.00, 512, 512),
  ('SER-QA-A2', '66666666-6666-4666-8666-666666666666', '1.2.840.10008.5.1.4.1.1.2.9001', 2, '动脉期', 'arterial', 0.910, 120, 5.00, 512, 512),
  ('SER-QA-A3', '66666666-6666-4666-8666-666666666666', '1.2.840.10008.5.1.4.1.1.2.9001', 3, '门脉期', 'portal', 0.880, 120, 5.00, 512, 512),
  ('SER-QA-B1', '77777777-7777-4777-8777-777777777777', '1.2.840.10008.5.1.4.1.1.2.9002', 1, '平扫', 'plain', 0.930, 90, 5.00, 512, 512);

-- ---- 报告：给 A 建一份报告（reportRule 分支）----
-- 目的：让 reportRule EXISTS 子查询在 A 场景命中，B 场景不命中。
INSERT INTO reports (id, study_id, study_uid, version, template_code, exam_body_part, scan_mode, findings, impression, follow_up_recommendation, structured_findings, report_doctor_id, report_time, body_digest, body_sha256, status)
VALUES ('88888888-8888-4888-8888-888888888888', '66666666-6666-4666-8666-666666666666', '1.2.840.10008.5.1.4.1.1.2.9001', 1, 'abdomen_liver_ct_v3', '上腹部', 'CT', 'QA 基线所见', 'QA 基线', '随访', '[]'::jsonb, '11111111-1111-4111-8111-111111111111', '2026-10-20 09:00:00+08', repeat('a', 64), repeat('b', 64), 'draft');

-- ---- 供脚本读取的固定 ID ----
SELECT 'QA_USER'   AS k, '11111111-1111-4111-8111-111111111111'::text AS v
UNION ALL SELECT 'STUDY_A', '1.2.840.10008.5.1.4.1.1.2.9001'
UNION ALL SELECT 'STUDY_B', '1.2.840.10008.5.1.4.1.1.2.9002'
UNION ALL SELECT 'STUDY_C', '1.2.840.10008.5.1.4.1.1.2.9999'
UNION ALL SELECT 'PATIENT_A', 'EMPI0000000001'
UNION ALL SELECT 'PATIENT_B', 'EMPI0000000002'
UNION ALL SELECT 'PATIENT_C', 'EMPI0000000099';
