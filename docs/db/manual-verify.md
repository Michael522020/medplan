# MedPlan 数据库真实执行验证 —— 手工执行清单

> **为什么需要这份文档**：`scripts/lint_schema.js` / `lint_migrations.js` 是**静态**检查，能发现结构漂移与合规约束缺失，但发现不了「语法能否被 PG 接受」「约束在运行时是否真的生效」。
> 等保测评看的是「能不能跑通 + 挡不挡得住」，静态断言证明不了。
> 本清单是 `scripts/verify_db.sh` 的**手工等价物**，在无 Docker 的开发机上逐条执行，结果等效。

---

## 状态

| 项 | 状态 | 说明 |
|---|---|---|
| 静态检查（895 断言） | **已通过** | `npm run lint` — openapi 560 + schema 191 + migrations 144 |
| 类型检查（13 条负向断言） | **已通过** | `npm run verify:types` — `tsc --strict` |
| **真实执行验证（本清单）** | **未执行** | 产出环境无 Docker 引擎、无 psql，需在有 PG18 的环境补跑 |
| 目标环境 | PostgreSQL **18** | 项目锁定版本；< 18 行为差异可能导致误判 |

**执行人**：______**日期**：______**结果**：[ ] 全通过　[ ] 有失败（记录第 ___ 组）

---

## 准备

```bash
# 方式 A：Docker（推荐）
docker run -d --name medplan-pg18 -e POSTGRES_PASSWORD=medplan_verify_only \
  -p 15432:5432 postgres:18

# 方式 B：本机 PostgreSQL 18
createdb medplan_verify
```

连接参数：`host=127.0.0.1 port=15432 user=postgres db=medplan_verify`

---

## 关键组 1：迁移可执行（失败即语法或约束错误）

```bash
psql -h 127.0.0.1 -p 15432 -U postgres -d medplan_verify \
     -v ON_ERROR_STOP=1 -f docs/db/migrations/001_init.sql
```

**必须通过的理由**（以下三点是静态检查抓不到、只有真实执行才会炸的类型）：
- 分区表主键必须含分区键。`audit_logs` 主键为 `(id, event_time)`，若误改为 `(id)` PG 会直接建表失败
- `hash_self` 计算链中若 `NEW.actor_id::text` 未 coalesce，`actor_id` 为空时整串拼接变 NULL，触发 `NOT NULL` 违约——**系统账号事件恰好踩中**
- `TRUNCATE` 不触发行级触发器，必须有 `BEFORE TRUNCATE` 语句级触发器兜底

期望：命令返回 0，无ERROR

---

## 关键组 2：审计表物理不可改（等保 8.1.4.3 / ADR-004）—— **本清单核心**

必须验证**两层都拦住**，只验一层等于没验。

### 2a. 权限层（用 app_rw 角色）

```sql
SET ROLE app_rw;
UPDATE medplan.audit_logs SET result = 'success';   -- 期望：ERROR permission denied
RESET ROLE;

SET ROLE app_rw;
DELETE FROM medplan.audit_logs;                     -- 期望：ERROR permission denied
RESET ROLE;

SET ROLE app_rw;
TRUNCATE medplan.audit_logs;                        -- 期望：ERROR permission denied
RESET ROLE;
```

### 2b. 触发器层（用表 owner 绕过权限层，验证第二层仍拦住）

```sql
-- 以 owner 身份执行
DELETE FROM medplan.audit_logs;                     -- 期望：ERROR，触发器拦截
TRUNCATE medplan.audit_logs;                        -- 期望：ERROR，trg_audit_logs_no_truncate 拦截
```

**为什么两层都要测**：架构师的论证是「只有权限控制的话，拿到超级用户权限可直接 DROP TABLE 重建，权限与触发器一并消失；hash chain 让整表重建也可检出」。**若只测权限层，第2 层是否真的生效将永远未知。**

期望：6 条语句全部报ERROR，无一条成功

---

## 关键组 3：hash chain 完整性与 NULL 传播回归

```sql
-- 造两条审计记录（actor_id 留空，模拟系统账号事件）
INSERT INTO medplan.audit_logs
  (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
VALUES
  (NULL, 'auth_login',  'success', 'session', 'sess-1', repeat('0',64), repeat('0',64));

INSERT INTO medplan.audit_logs
  (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
VALUES
  (NULL, 'auth_logout', 'success', 'session', 'sess-1', repeat('0',64), repeat('0',64));

-- 断言 1：首条 hash_prev 为 64 个 0（空链标记）
SELECT hash_prev FROM medplan.audit_logs ORDER BY id LIMIT 1;
-- 期望：0000000000000000000000000000000000000000000000000000000000000000

-- 断言 2：第二条 hash_prev 指向第一条 hash_self（链式衔接）
SELECT (SELECT hash_prev FROM medplan.audit_logs ORDER BY id OFFSET 1 LIMIT 1)
     = (SELECT hash_self FROM medplan.audit_logs ORDER BY id LIMIT 1) AS chain_ok;
-- 期望：t

-- 断言 3：actor_id 为空时 hash_self 仍正常计算（NULL 传播回归测试）
SELECT count(*) AS null_hash
FROM medplan.audit_logs
WHERE actor_id IS NULL AND hash_self IS NULL;
-- 期望：0（非 0 说明 coalesce 失效，审计写入会在系统事件上全部失败）

-- 断言 4：全链校验
SELECT count(*) AS broken FROM fn_verify_audit_chain();
-- 期望：0
```

**断言 3 是回归测试**：架构师上轮自查修的就是这个 bug——`actor_id` 为 NULL 时字符串拼接产生 NULL，触发 `hash_self NOT NULL` 违约。**这是会在真实执行时才炸、静态断言抓不到的类型。**

---

## 关键组 4：卫健委电子病历必备字段覆盖

```sql
SELECT * FROM fn_check_nhc_field_coverage();
-- 期望：15 行，全部 covered = t

SELECT count(*) AS missing
FROM fn_check_nhc_field_coverage() WHERE NOT covered;
-- 期望：0
```

**这是测评取证函数**，输出可直接作为等保/互联互通测评的证据材料。

---

## 补充组（有时间则跑，同属 verify_db.sh 的第 5–12 组）

### 5. 签名日志不可改（WS/T 847—2024）

```sql
SET ROLE app_rw;
UPDATE medplan.signature_logs SET serial_no = 'x';  -- 期望：ERROR
RESET ROLE;
```

### 7. 分区兜底（不丢审计事件）

```sql
SELECT count(*) FROM pg_class WHERE relname = 'audit_logs_default';
-- 期望：1（DEFAULT 兜底分区存在，时间落在分区外也不丢审计）

-- 超出已建分区范围的时间应能写入（落兜底分区）
INSERT INTO medplan.audit_logs
  (actor_id, event_type, result, resource_type, resource_id, hash_prev, hash_self)
VALUES
  (NULL, 'auth_login', 'success', 'session', 'sess-future',
   repeat('0',64), repeat('0',64)) RETURNING 1;
-- 期望：返回 1 行
```

### 8. 模型版本锁（算法升级需变更审批）

```sql
SELECT count(*) FROM pg_constraint WHERE conname = 'ck_seg_task_model_version';
-- 期望：1（锁 2.18.0）
```

### 10. AI Worker 与 PHI 隔离（本项目最重要的架构隔离）

```sql
SET ROLE ai_worker;
SELECT count(*) FROM medplan.patients;   -- 期望：ERROR permission denied
RESET ROLE;

-- ai_worker 不应被授予患者明文视图
SELECT count(*) FROM information_schema.role_table_grants
WHERE table_name = 'v_patients_plain' AND grantee = 'ai_worker';
-- 期望：0
```

**这一组验证的是「GPU 推理Worker 不接触患者身份数据」**——分割任务只需要影像像素与结构名，不需要知道这是谁。

---

## 全部通过后的操作

1. 把本文档顶部的「状态」表更新为已执行，填入执行人与日期
2. 在 `docs/Spec.md` §14 变更记录补一行：`verify_db` 真实执行通过（日期 + 环境）
3. 更新 `.workbuddy/memory/pitfalls.jsonl` 中相关坑的 `validated` 字段为 `true`
4. Phase 3 开发启动前把本文件作为 CI 前置检查项

---

## 一句话结论

**895 条静态断言证明了结构正确；这 13 条真实执行断言证明结构生效。缺后者，等保测评现场会挂。**