-- Phase 4 QA：规模化数据装载（验证越权时序差异是否随数据量放大）
--
-- 真实医院量级参考：单院年检查量十万级，patients 十万级，visits 百万级。
-- 本脚本装载到较小但已足以暴露「全表扫描」的数量级。
SET search_path TO medplan, public;

-- 清掉 QA 小种子（保留 bulk 标记之外的）
DELETE FROM medplan.series WHERE study_uid LIKE 'BULK-%';
DELETE FROM medplan.studies WHERE study_uid LIKE 'BULK-%';
DELETE FROM medplan.visits WHERE visit_no LIKE 'BULK-%';
DELETE FROM medplan.patients WHERE empi_id LIKE 'BULK-%';
DELETE FROM medplan.reports WHERE study_uid LIKE 'BULK-%';

-- ---- 20000 患者 ----
INSERT INTO medplan.patients (id, empi_id, name, gender, birth_date, id_card_masked)
SELECT
  ('b' || lpad((i)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-P-' || lpad(i::text, 6, '0'),
  '患者' || i, 'M', date '1960-01-01' + (i % 20000),
  '310***********' || lpad((i % 10000)::text, 4, '0')
FROM generate_series(1, 20000) AS i;

-- ---- 40000 就诊：大部分在 RADIOLOGY（攻击者的科室），部分在别处 ----
INSERT INTO medplan.visits (id, visit_no, patient_id, visit_type, admit_date, dept, is_inpatient)
SELECT
  ('c' || lpad((i)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-V-' || lpad(i::text, 7, '0'),
  ('b' || lpad(((i - 1) % 20000 + 1)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'outpatient', timestamptz '2026-01-01' + (i * interval '1 day'),
  CASE WHEN i % 3 = 0 THEN 'CARDIOLOGY' WHEN i % 3 = 1 THEN 'RADIOLOGY' ELSE 'NEUROLOGY' END,
  false
FROM generate_series(1, 40000) AS i;

-- ---- 60000 检查 ----
INSERT INTO medplan.studies (id, study_uid, visit_id, patient_id, accession_no, modality, body_part, study_description, study_date)
SELECT
  ('d' || lpad((i)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-S-' || lpad(i::text, 7, '0'),
  ('c' || lpad(((i - 1) % 40000 + 1)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  ('b' || lpad(((i - 1) % 20000 + 1)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-ACC-' || lpad(i::text, 7, '0'),
  'CT', 'ABDOMEN', '规模化基线检查', timestamptz '2026-01-01' + (i * interval '1 day')
FROM generate_series(1, 60000) AS i;

-- ---- 60000 序列 ----
INSERT INTO medplan.series (series_uid, study_id, study_uid, series_number, series_description, phase, phase_confidence, instance_count, slice_thickness_mm, rows, columns)
SELECT
  'BULK-SER-' || lpad(i::text, 7, '0'),
  ('d' || lpad(i::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-S-' || lpad(i::text, 7, '0'),
  1, '平扫', 'plain', 0.93, 120, 5.00, 512, 512
FROM generate_series(1, 60000) AS i;

-- ---- 20000 报告（reportRule 分支的负载）----
INSERT INTO medplan.reports (id, study_id, study_uid, version, template_code, exam_body_part, scan_mode, findings, impression, follow_up_recommendation, structured_findings, report_doctor_id, report_time, body_digest, body_sha256, status)
SELECT
  ('e' || lpad((i)::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  ('d' || lpad(i::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'BULK-S-' || lpad(i::text, 7, '0'), 1, 'abdomen_liver_ct_v3', '上腹部', 'CT',
  '所见', '意见', '随访', '[]'::jsonb,
  '11111111-1111-4111-8111-111111111111',
  timestamptz '2026-01-01' + (i * interval '1 day'),
  repeat('a', 64), repeat('b', 64), 'draft'
FROM generate_series(1, 20000) AS i;

-- ---- 目标患者 B 保留在 CARDIOLOGY（无权限）；另建 BULK 目标用于批量场景 ----
ANALYZE medplan.studies;
ANALYZE medplan.visits;
ANALYZE medplan.reports;
ANALYZE medplan.patient_grants;
ANALYZE medplan.patients;

SELECT 'patients' t, count(*) FROM medplan.patients
UNION ALL SELECT 'visits', count(*) FROM medplan.visits
UNION ALL SELECT 'studies', count(*) FROM medplan.studies
UNION ALL SELECT 'series', count(*) FROM medplan.series
UNION ALL SELECT 'reports', count(*) FROM medplan.reports;
