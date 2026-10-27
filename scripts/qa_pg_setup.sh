#!/usr/bin/env bash
# Phase 4 QA —— 一键重建 QA 专用 PG18 环境（可重复执行）
#
# 为什么单独写这个脚本：
#   项目自带的 scripts/verify_db_local.sh 会 `docker rm -f` 所有匹配
#   `^medplan-pg` 的容器 —— 包括**别人**正在用的容器。QA 用独立命名前缀
#   （qa-pg-）与端口（15533）避开，避免互相踩踏。
#
# 用法：bash scripts/qa_pg_setup.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="qa-pg-medplan"
PORT="15533"
PASS="qa_rw_pw_2026"
IMG="postgres:18"

say() { printf '%s\n' "$*"; }

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  say "启动 $CONTAINER ..."
  MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=medplan_ci_only \
    -p "$PORT:5432" \
    -v "$ROOT/docs/db/migrations:/migrations:ro" \
    "$IMG" >/dev/null || { say "启动失败"; exit 1; }
else
  say "复用 $CONTAINER"
  docker start "$CONTAINER" >/dev/null 2>&1
fi

for i in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && { say "  就绪（${i}s）"; break; }
  [ "$i" = "60" ] && { say "  超时"; exit 1; }
  sleep 1
done

# ---- 两个业务库：每次**重建**，保证可重复 ----
# 重建而不是复用，是因为 reports 表有 append-only 触发器（DELETE 一律拒绝），
# 种子脚本无法幂等清理已插入的报告。
for db in medplan_qa medplan_noschema; do
  docker exec "$CONTAINER" psql -U postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid<>pg_backend_pid();" >/dev/null 2>&1
  docker exec "$CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1
  docker exec "$CONTAINER" psql -U postgres -c "CREATE DATABASE $db;" >/dev/null 2>&1
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 \
    -f /migrations/001_init.sql >/dev/null 2>&1 && say "  $db: 001_init 已应用"
  # 增量迁移：按文件名顺序逐个应用（002 = AI 任务投递 outbox）
  for extra in docs/db/migrations/0*.sql; do
    base=$(basename "$extra")
    [ "$base" = "001_init.sql" ] && continue
    MSYS_NO_PATHCONV=1 docker cp "$extra" "$CONTAINER":"/migrations/$base" >/dev/null 2>&1
    MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 \
      -f "/migrations/$base" >/dev/null 2>&1 && say "  $db: $base 已应用"
  done
done
# medplan_qa：DB 级补 search_path（用于跑通其余验证）
docker exec "$CONTAINER" psql -U postgres -d medplan_qa -c \
  "ALTER DATABASE medplan_qa SET search_path TO medplan, public;" >/dev/null 2>&1
# medplan_noschema：**不**设 DB 级 search_path —— 等价于「按 .env.example 部署」的现场

# ---- 角色口令 ----
for db in medplan_qa medplan_noschema; do
  docker exec "$CONTAINER" psql -U postgres -d "$db" -c \
    "ALTER ROLE app_rw PASSWORD '$PASS'; ALTER ROLE app_audit PASSWORD '$PASS';" >/dev/null 2>&1
done

# ---- 种子数据 ----
MSYS_NO_PATHCONV=1 docker cp scripts/qa_seed_timing.sql "$CONTAINER":/tmp/seed.sql >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres -d medplan_qa -v ON_ERROR_STOP=1 -f /tmp/seed.sql >/dev/null 2>&1 \
  && say "  medplan_qa: 时序种子已装载"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres -d medplan_noschema -v ON_ERROR_STOP=1 -f /tmp/seed.sql >/dev/null 2>&1 \
  && say "  medplan_noschema: 时序种子已装载"

# ---- 规模化数据（只装 medplan_qa，验证时序差异是否随数据量放大）----
if [ "${QA_BULK:-1}" = "1" ]; then
  MSYS_NO_PATHCONV=1 docker cp scripts/qa_seed_bulk.sql "$CONTAINER":/tmp/bulk.sql >/dev/null
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres -d medplan_qa -v ON_ERROR_STOP=1 -f /tmp/bulk.sql >/dev/null 2>&1 \
    && say "  medplan_qa: 规模化数据已装载（6 万检查 / 4 万就诊 / 2 万报告）"
fi

say ""
say "QA 环境就绪："
say "  端口 $PORT  容器 $CONTAINER  口令 $PASS"
say "  业务库     postgres://postgres:medplan_ci_only@127.0.0.1:$PORT/medplan_qa"
say "  无 search_path 库 postgres://postgres:medplan_ci_only@127.0.0.1:$PORT/medplan_noschema"
