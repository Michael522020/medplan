-- Phase 4 QA：作用域查询的确定性执行计划对比
-- 使用 PREPARE + EXPLAIN EXECUTE，与 node-postgres 的扩展查询协议（参数化）一致。
SET search_path TO medplan, public;

PREPARE q_scope (uuid, varchar, boolean, boolean, varchar) AS
SELECT s.study_uid, s.accession_no, s.modality, s.study_description,
       COALESCE(SUM(se.instance_count), 0)::int AS total_instances
  FROM studies s
  LEFT JOIN series se ON se.study_id = s.id AND se.deleted_at IS NULL
 WHERE (
    CASE WHEN $4::boolean THEN
      ( EXISTS (SELECT 1 FROM patient_grants g WHERE g.patient_id = s.patient_id AND g.user_id = $1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))
        OR ( EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = s.patient_id AND v.deleted_at IS NULL AND v.dept = $2)
             AND EXISTS (SELECT 1 FROM reports r JOIN studies s2 ON s2.id = r.study_id WHERE s2.patient_id = s.patient_id AND r.deleted_at IS NULL AND (r.report_doctor_id = $1 OR r.review_doctor_id = $1)) ) )
    ELSE
      ( $3::boolean
        OR EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = s.patient_id AND v.deleted_at IS NULL AND (v.dept = $2 OR (v.is_inpatient AND v.ward_dept = $2)))
        OR EXISTS (SELECT 1 FROM reports r JOIN studies s2 ON s2.id = r.study_id WHERE s2.patient_id = s.patient_id AND r.deleted_at IS NULL AND (r.report_doctor_id = $1 OR r.review_doctor_id = $1))
        OR EXISTS (SELECT 1 FROM patient_grants g WHERE g.patient_id = s.patient_id AND g.user_id = $1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))
      )
    END
  )
   AND s.deleted_at IS NULL
   AND s.study_uid = $5
 GROUP BY s.id, s.study_uid, s.accession_no, s.modality, s.study_description;

\echo '########## A：存在且有权限（正常 200）##########'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE q_scope('11111111-1111-4111-8111-111111111111', 'RADIOLOGY', false, false, '1.2.840.10008.5.1.4.1.1.2.9001');

\echo '########## B：存在但无权限（越权 10004）##########'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE q_scope('11111111-1111-4111-8111-111111111111', 'RADIOLOGY', false, false, '1.2.840.10008.5.1.4.1.1.2.9002');

\echo '########## C：完全不存在（10005）##########'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE q_scope('11111111-1111-4111-8111-111111111111', 'RADIOLOGY', false, false, '1.2.840.10008.5.1.4.1.1.2.9999');
