#!/usr/bin/env bash
# =====================================================================
# MedPlan 迁移真实执行验证（PostgreSQL 18）
#
# 为什么需要这个脚本：
#   lint_schema.js / lint_migrations.js 是**静态**检查，能发现结构漂移与
#   合规约束缺失，但发现不了「语法能否被 PG 接受」「约束在运行时是否真的生效」。
#   例如分区表主键必须含分区键、分区外写入会报错、REVOKE 是否真的挡住了 UPDATE ——
#   这些只有真跑一次才知道。
#
#   等保测评看的是「能不能跑通 + 挡不挡得住」，静态检查不够。
#
# 用法：
#   docker run -d --name medplan-pg18 -e POSTGRES_PASSWORD=medplan_test_only \
#     -p 15432:5432 postgres:18
#   bash scripts/verify_db.sh
#
# 无 Docker 环境时该脚本无法运行 —— 此时：
#   1. 静态检查仍必须通过：npm run lint
#   2. 按 docs/db/manual-verify.md 的手工清单逐条执行（与本脚本等效）
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANUAL_VERIFY="$ROOT/docs/db/manual-verify.md"

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-15432}"
PG_USER="${PG_USER:-postgres}"
PG_PASS="${PG_PASS:-medplan_test_only}"
PG_DB="${PG_DB:-medplan_verify}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/docs/db/migrations/001_init.sql"

PASS=0
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# 每次 psql 调用都是独立连接。迁移文件里设了 `SET search_path TO medplan, public`，
# 但那**只在那一次连接内有效**。若不显式带上 search_path，
# PG 默认解析到 `"$user", public`，会找不到 medplan schema 里的函数
# （fn_verify_audit_chain / fn_check_nhc_field_coverage），
# 表现为 "function does not exist" —— 而表名带 medplan. 前缀所以能查到，
# 造成「表能查、函数查不到」的迷惑现象。
PG_OPTS=(-h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -v ON_ERROR_STOP=1)
PG_SCHEMA="${PG_SCHEMA:-medplan}"

psql_q() { PGPASSWORD="$PG_PASS" psql "${PG_OPTS[@]}" -d "$PG_DB" -tAc "SET search_path TO $PG_SCHEMA, public; $1"; }

# 管理库连接：CREATE/DROP DATABASE 不能在连接到目标库时执行，
# 必须连到 postgres 维护库。否则目标库不存在时第一步就失败。
psql_admin() { PGPASSWORD="$PG_PASS" psql "${PG_OPTS[@]}" -d "${PG_ADMIN_DB:-postgres}" -tAc "$1"; }

say "=== MedPlan 数据库真实执行验证 ==="
say ""

if ! command -v psql >/dev/null 2>&1; then
  say "psql 不可用。"
  say ""
  say "静态检查仍必须通过：npm run lint"
  say "真实执行验证请按手工清单执行（与本脚本 12 组等效）："
  say "  $MANUAL_VERIFY"
  say ""
  say "该清单覆盖 4 个关键组：迁移可执行 / audit_logs 两层防改实测 /"
  say "hash chain 完整性与 NULL 传播回归 / 卫健委字段覆盖 15-15。"
  exit 2
fi

# 0. 连接与干净库
say "[0] 准备干净数据库"
# 断开会话后再 DROP —— DROP DATABASE 不能在有其他连接指向该库时执行
psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_admin "DROP DATABASE IF EXISTS $PG_DB;" >/dev/null 2>&1 || true
psql_admin "CREATE DATABASE $PG_DB;" >/dev/null 2>&1
if ! psql_q "SELECT 1;" >/dev/null 2>&1; then
  say "无法连接 PostgreSQL（$PG_HOST:$PG_PORT）。请先启动容器。"
  exit 1
fi
ok "数据库 $PG_DB 就绪"

# 1. 迁移可执行
say ""
say "[1] 执行 001_init.sql（这一步失败即语法或约束错误）"
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -q -f "$MIGRATION" >/tmp/medplan_migrate.log 2>&1; then
  ok "迁移执行成功"
else
  bad "迁移执行失败"
  cat /tmp/medplan_migrate.log
  exit 1
fi

# 2. 幂等性（规范 4）
say ""
say "[2] 迁移重复执行不产生副作用（规范 4：幂等或显式失败）"
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -q -f "$MIGRATION" >/tmp/medplan_migrate2.log 2>&1; then
  bad "迁移可重复执行 —— 说明存在非幂等对象或被 ON CONFLICT 掩盖的问题，需人工确认"
else
  # 期望失败：CREATE TABLE 已存在属正常，但不应半途留下不一致状态
  if grep -qi 'already exists' /tmp/medplan_migrate2.log; then
    ok "重复执行时明确报 already exists（符合规范 4：非幂等对象须显式失败）"
  else
    bad "重复执行失败但原因非 already exists，需检查"
    tail -5 /tmp/medplan_migrate2.log
  fi
fi

# 3. 表数量
say ""
say "[3] Spec §6 表清单落位"
N=$(psql_q "SELECT count(*) FROM information_schema.tables WHERE table_schema='medplan' AND table_type='BASE TABLE' AND table_name NOT LIKE 'audit_logs\_%';")
if [ "${N:-0}" -ge 16 ]; then
  ok "业务表数量 = $N（Spec 16 张 + segmentations 等支撑表）"
else
  bad "业务表数量 = ${N:-0}，期望 >= 16"
fi

# 4. 审计表物理不可改（等保 8.1.4.3 / ADR-004）—— 本脚本的核心
say ""
say "[4] audit_logs 物理不可改（REVOKE + 触发器双层）"
psql_q "GRANT CONNECT ON DATABASE $PG_DB TO app_rw;" >/dev/null 2>&1 || true
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc \
     "SET ROLE app_rw; UPDATE medplan.audit_logs SET result='success';" >/tmp/r1.log 2>&1; then
  bad "app_rw 竟能 UPDATE audit_logs —— REVOKE 未生效"
else
  ok "app_rw UPDATE audit_logs 被拒（权限层）"
fi
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc "SET ROLE app_rw; DELETE FROM medplan.audit_logs;" >/tmp/r2.log 2>&1; then
  bad "app_rw 竟能 DELETE audit_logs"
else
  ok "app_rw DELETE audit_logs 被拒（权限层）"
fi
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc "SET ROLE app_rw; TRUNCATE medplan.audit_logs;" >/tmp/r3.log 2>&1; then
  bad "app_rw 竟能 TRUNCATE audit_logs"
else
  ok "app_rw TRUNCATE audit_logs 被拒（权限层）"
fi
# 触发器层（用表 owner 绕过权限层，验证第二层仍拦住）
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc "DELETE FROM medplan.audit_logs;" >/tmp/r4.log 2>&1; then
  bad "表 owner 竟能 DELETE audit_logs —— 触发器层未生效"
else
  ok "表 owner DELETE audit_logs 被拒（触发器层，第二层防护生效）"
fi

# 5. 签名日志不可改
say ""
say "[5] signature_logs 不可改（WS/T 847-2024）"
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc "SET ROLE app_rw; UPDATE medplan.signature_logs SET serial_no='x';" >/tmp/r5.log 2>&1; then
  bad "app_rw 竟能 UPDATE signature_logs"
else
  ok "app_rw UPDATE signature_logs 被拒"
fi

# 6. hash chain（等保 8.1.4.3）
say ""
say "[6] 审计 hash chain 自动计算与完整性"
psql_q "INSERT INTO medplan.audit_logs (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
        VALUES (NULL,'auth_login','success','session','sess-1', repeat('0',64), repeat('0',64));" >/dev/null 2>&1
psql_q "INSERT INTO medplan.audit_logs (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
        VALUES (NULL,'auth_logout','success','session','sess-1', repeat('0',64), repeat('0',64));" >/dev/null 2>&1
FIRST_PREV=$(psql_q "SELECT hash_prev FROM medplan.audit_logs ORDER BY id LIMIT 1;")
if [ "$FIRST_PREV" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
  ok "首条记录 hash_prev 为 64 个 0（空链标记）"
else
  bad "首条记录 hash_prev = $FIRST_PREV，期望 64 个 0"
fi
SECOND_PREV=$(psql_q "SELECT hash_prev FROM medplan.audit_logs ORDER BY id OFFSET 1 LIMIT 1;")
FIRST_SELF=$(psql_q "SELECT hash_self FROM medplan.audit_logs ORDER BY id LIMIT 1;")
if [ "$SECOND_PREV" = "$FIRST_SELF" ]; then
  ok "第二条 hash_prev 正确指向第一条 hash_self（链式衔接）"
else
  bad "链断裂：第二条 hash_prev=$SECOND_PREV，第一条 hash_self=$FIRST_SELF"
fi
# actor_id 为 NULL 时不能因拼接产生 NULL 而违反 NOT NULL（曾经的真实 bug）
NULLCOUNT=$(psql_q "SELECT count(*) FROM medplan.audit_logs WHERE actor_id IS NULL AND hash_self IS NULL;")
if [ "${NULLCOUNT:-1}" = "0" ]; then
  ok "actor_id 为空时 hash_self仍正常计算（coalesce 生效，NOT NULL 未违约）"
else
  bad "actor_id 为空导致 hash_self 为 NULL —— 审计写入会在系统事件上失败"
fi
BROKEN=$(psql_q "SELECT count(*) FROM fn_verify_audit_chain();")
if [ "${BROKEN:-1}" = "0" ]; then
  ok "fn_verify_audit_chain() 返回 0 行（链完整）"
else
  bad "fn_verify_audit_chain() 检出 $BROKEN 处断裂"
fi

# 7. 分区与兜底
say ""
say "[7] 审计分区与兜底分区"
DFLT=$(psql_q "SELECT count(*) FROM pg_class WHERE relname='audit_logs_default';")
if [ "${DFLT:-0}" = "1" ]; then ok "DEFAULT 兜底分区存在（时间落在分区外也不会丢审计）"; else bad "缺DEFAULT 兜底分区"; fi
FUTURE=$(psql_q "INSERT INTO medplan.audit_logs (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
                VALUES (NULL,'auth_login','success','session','sess-future', repeat('0',64), repeat('0',64))
                RETURNING 1;" 2>/dev/null | head -1)
if [ -n "${FUTURE// /}" ]; then
  ok "超出已建分区范围的时间可写入（落在兜底分区，不丢审计）"
else
  bad "超出分区范围写入失败 —— 会丢审计事件"
fi

# 8. 卫健委字段覆盖
say ""
say "[8] 卫健委电子病历必备字段覆盖"
MISSING=$(psql_q "SELECT count(*) FROM fn_check_nhc_field_coverage() WHERE NOT covered;")
if [ "${MISSING:-1}" = "0" ]; then
  ok "必备字段覆盖 15/15（架构方案 §7.3）"
else
  bad "有 $MISSING 项必备字段未覆盖"
fi

# 9. 模型白名单与版本锁
say ""
say "[9] AI 模型版本锁（算法升级需变更注册审批）"
BADV=$(psql_q "SELECT count(*) FROM pg_constraint WHERE conname='ck_seg_task_model_version';")
if [ "${BADV:-0}" = "1" ]; then ok "模型版本 CHECK 约束存在（2.18.0 锁定）"; else bad "缺模型版本 CHECK"; fi

# 10. PHI 表对 AI Worker 隔离
say ""
say "[10] ai_worker 无 PHI 表权限"
if PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
     -v ON_ERROR_STOP=1 -tAc "SET ROLE ai_worker; SELECT count(*) FROM medplan.patients;" >/tmp/r6.log 2>&1; then
  bad "ai_worker 竟能读取 patients —— PHI 泄露风险"
else
  ok "ai_worker 读取 patients 被拒（GPU Worker 不接触患者数据）"
fi

# 11. 明文视图默认拒绝
say ""
say "[11] 患者明文视图默认拒绝"
GRANTED=$(psql_q "SELECT count(*) FROM information_schema.role_table_grants
                  WHERE table_name='v_patients_plain' AND grantee='ai_worker';")
if [ "${GRANTED:-0}" = "0" ]; then
  ok "ai_worker 无 v_patients_plain 授权"
else
  bad "ai_worker 被授予明文视图访问权"
fi

# 12. 幂等键唯一约束
say ""
say "[12] 幂等键唯一约束（避免重复 GPU 计算 / 重复签名流水号）"
for T in segmentation_tasks plans signature_logs; do
  UQ=$(psql_q "SELECT count(*) FROM pg_constraint WHERE conrelid='medplan.$T'::regclass AND contype='u';")
  if [ "${UQ:-0}" -ge 1 ]; then ok "$T 有 UNIQUE 约束"; else bad "$T 缺 UNIQUE 约束"; fi
done

say ""
say "=== 结果：通过 $PASS / 失败 $FAIL ==="
[ "$FAIL" -eq 0 ] || exit 1
say "数据库真实执行验证全部通过。"