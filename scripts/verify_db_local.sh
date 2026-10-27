#!/usr/bin/env bash
# 本地在 Docker 里跑 PostgreSQL 18 并执行迁移真实执行验证。
#
# 为什么需要这个脚本：
#   迁移的运行时行为（分区路由、触发器是否生效、REVOKE 是否真挡住、
#   扩展函数能否解析）**只有真跑一次才知道**，静态 lint 证明不了。
#
#   之前只能靠 CI 往返验证，一轮 2 分钟，且失败时要等下一轮才能拿到诊断 ——
#   2026-10-27 那次连续三轮 CI 才定位到根因。
#   本机有 Docker，直接跑容器验证，**秒级出结果**。
#
# 用法：
#   bash scripts/verify_db_local.sh          # 起容器 + 跑验证 + 保留容器
#   bash scripts/verify_db_local.sh --clean  # 跑完删掉容器
#
# 前置：Docker 可用（docker version）。镜像 postgres:18 首次会拉取（约 100MB）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${MEDPLAN_PG_CONTAINER:-medplan-pg-verify}"
IMAGE="${MEDPLAN_PG_IMAGE:-postgres:18}"
PG_PORT="${PG_PORT:-15432}"
PG_PASS="${PG_PASS:-medplan_ci_only}"
DB="${PG_DB:-medplan_verify}"

CLEAN=0
[ "${1:-}" = "--clean" ] && CLEAN=1

say() { printf '%s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "错误：未找到 docker。请安装 Docker Desktop，或改用 CI 跑（.github/workflows/contract-guard.yml）。"
  exit 127
fi

# 复用已存在的容器
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  say "复用已有容器 $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null 2>&1
fi

# 端口可能被其他容器占用（如手工调试留下的 medplan-pg），
# 释放掉同名 medplan-pg* 容器，否则 docker run 会报
# "Bind for 0.0.0.0:15432 failed: port is already allocated"
STALE=$(docker ps -a --format '{{.Names}}' | grep -E '^medplan-pg' | grep -vx "$CONTAINER" || true)
if [ -n "$STALE" ]; then
  say "清理占用同端口的旧容器: $(echo "$STALE" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  docker rm -f $STALE >/dev/null 2>&1 || true
fi

say "启动 PostgreSQL 18 容器 ..."
# MSYS_NO_PATHCONV=1：Git Bash 会把 -v 的 Windows 路径参数转换掉，
# 导致挂载到容器里的路径不存在。同样要关掉转换。
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -p "$PG_PORT:5432" \
  -v "$ROOT/scripts:/scripts:ro" \
  -v "$ROOT/docs/db/migrations:/migrations:ro" \
  "$IMAGE" >/dev/null || {
  say "容器启动失败"
  exit 1
}

say "等待数据库就绪 ..."
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    say "  就绪（${i}s）"
    break
  fi
  if [ "$i" = "60" ]; then
    say "  超时未就绪"
    docker logs "$CONTAINER" --tail 20
    exit 1
  fi
  sleep 1
done

say ""
say "=== 执行迁移真实执行验证 ==="
say ""
# MSYS_NO_PATHCONV=1：Git Bash 会把 /scripts、/migrations 这类路径参数
# 转换成 Windows 路径（C:/...），docker 收到后当成主机路径去找，
# 容器里当然不存在。关掉转换即可。
MSYS_NO_PATHCONV=1 docker exec \
  -e MEDPLAN_ROOT=/ \
  -e MIGRATION=/migrations/001_init.sql \
  -e PG_HOST=127.0.0.1 \
  -e PG_PORT=5432 \
  -e PG_USER=postgres \
  -e PG_PASS="$PG_PASS" \
  -e PG_DB="$DB" \
  "$CONTAINER" bash /scripts/verify_db.sh
RC=$?

if [ "$CLEAN" = "1" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  say ""
  say "容器已清理"
else
  say ""
  say "容器保留中（调试用）：docker exec -it $CONTAINER psql -U postgres -d $DB"
  say "清理：docker rm -f $CONTAINER"
fi

exit $RC
