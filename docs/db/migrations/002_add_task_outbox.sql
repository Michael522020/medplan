-- =====================================================================
-- 002_add_task_outbox.sql — AI 分割任务投递 outbox
-- =====================================================================
-- 目标库：PostgreSQL 18（私有化部署，院内）
--
-- 【为什么需要 outbox】
--
-- 分割任务要投递给 GPU Worker，走 Redis Stream（架构方案 §6.3）。
-- 但「任务落库」与「投递到队列」跨两个系统（PostgreSQL + Redis），
-- **无法放进同一个事务** —— Redis 不支持两阶段提交。
--
-- 若按「先投递再落库」：Worker 拉取时任务还不存在 -> 空转。
-- 若按「先落库再投递」且投递失败：任务躺在库里没人做 -> 静默丢任务。
--
-- outbox 模式把「待投递」这件事**持久化到业务库**：
--   1. 同一事务内写 segmentation_tasks + outbox 行 + 审计行
--   2. 事务提交后，后台扫描器扫 outbox 投递到 Redis Stream
--   3. 投递成功后标记 outbox 行已发送
--
-- 这样得到一个可查的不变量：
--   **任务存在 ⟺ 队列有消息**（未投递的 outbox 行就是「待补偿」的凭据）
--
-- 幂等衔接：segmentation_tasks.idempotency_key 的唯一约束
-- （uq_seg_task_idempotency）保证重复投递不产生重复 GPU 计算。
--
-- 执行：
--   psql -v ON_ERROR_STOP=1 -f docs/db/migrations/002_add_task_outbox.sql
--
-- 遵循 docs/db/migrations/001_init.sql 头部的增量迁移规范：
--   规范 3：一个迁移只做一件事（本迁移只加 outbox 表及其索引与授权）
--   规范 4：幂等对象用 IF NOT EXISTS
--   规范 5：全文包在 BEGIN / COMMIT 中
--   规范 6：只加不改
-- =====================================================================

BEGIN;

SET search_path TO medplan, public;

-- ---------------------------------------------------------------------
-- 1. outbox 表
-- ---------------------------------------------------------------------
-- 【为什么单独一张表而不是复用 segmentation_tasks】
--
-- segmentation_tasks 已经能表达「任务存在」，但它无法表达
-- 「这个任务**还没**投递到队列」。缺这个状态就无法区分：
--   - 刚落库、投递器还没跑到        -> 需要投递
--   - 投递成功、扫描器又扫到了        -> 不需要投递（重复投递虽被幂等键兜住，
--                                        但会浪费一次 Worker 拉取与一次 GPU 检查）
--
-- 单独一张表让「待投递集合」可以用一条索引查询直接得出，
-- 不需要在 segmentation_tasks 上加状态位（那会让任务状态机多一个维度）。
--
-- 【只存投递所需的最少信息】
--
-- 不存任务内容 —— 任务内容在 segmentation_tasks 里。
-- outbox 只负责「提醒：有个任务该投递了」。避免两份真相。
CREATE TABLE IF NOT EXISTS task_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 业务任务 id。指向 segmentation_tasks.id
  task_id           uuid         NOT NULL REFERENCES segmentation_tasks(id) ON DELETE CASCADE,
  -- 业务类型。当前只有 'segmentation_task'，为将来其他任务类型留位
  task_type         varchar(32)  NOT NULL DEFAULT 'segmentation_task',
  -- 幂等键。与 segmentation_tasks.idempotency_key 一致，
  -- 用于排查「这个键是否已投递过」
  idempotency_key   char(36),
  -- 投递载荷（JSON）。放 Worker 需要的最小信息（task_id 为主）
  payload           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  -- 投递状态。pending = 待投递；dispatched = 已投递
  dispatch_status   varchar(16)  NOT NULL DEFAULT 'pending',
  -- 投递成功后的 Redis Stream 消息 ID。用于追溯「哪条消息对应哪个任务」
  stream_message_id varchar(64),
  -- 尝试次数。用于退避与告警（连续失败 N 次说明队列侧有问题）
  attempt_count     integer      NOT NULL DEFAULT 0,
  -- 最后一次失败原因。排查用，不含 PHI
  last_error        text,
  -- 下次可重试时间。退避用
  next_retry_at     timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  dispatched_at     timestamptz,
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_task_outbox_status CHECK (
    dispatch_status IN ('pending', 'dispatched')
  ),
  -- 同一任务只应有一条 outbox 行。防止重复投递同一任务
  CONSTRAINT uq_task_outbox_task UNIQUE (task_id),
  CONSTRAINT ck_task_outbox_attempt_count CHECK (attempt_count >= 0)
);

COMMENT ON TABLE task_outbox IS
  'AI 任务投递 outbox。解决「任务落库」与「投递 Redis Stream」跨系统无事务的问题：同事务写 outbox，后台扫描器补偿投递。保证「任务存在 ⟺ 队列有消息」可查';
COMMENT ON COLUMN task_outbox.dispatch_status IS
  'pending = 待投递；dispatched = 已投递。扫描器只捞 pending';
COMMENT ON COLUMN task_outbox.stream_message_id IS
  '投递成功后的 Redis Stream 消息 ID，用于追溯消息与任务的对应关系';
COMMENT ON COLUMN task_outbox.attempt_count IS
  '投递尝试次数。连续失败达阈值说明队列侧异常，应告警';
COMMENT ON COLUMN task_outbox.next_retry_at IS
  '下次可重试时间。失败后按指数退避设置，避免队列故障时打爆 Redis';

-- ---------------------------------------------------------------------
-- 2. 索引
-- ---------------------------------------------------------------------
-- 扫描器的主查询：捞出到期的 pending 行。
-- 部分索引只覆盖 pending —— dispatched 行占绝大多数（历史记录），
-- 不该占用扫描器的索引空间。
CREATE INDEX IF NOT EXISTS idx_task_outbox_pending
  ON task_outbox (next_retry_at, created_at)
  WHERE dispatch_status = 'pending';

-- 按任务反查（排查用）
CREATE INDEX IF NOT EXISTS idx_task_outbox_task_id
  ON task_outbox (task_id);

-- ---------------------------------------------------------------------
-- 3. 权限
-- ---------------------------------------------------------------------
-- app_rw：业务账号。负责写 outbox（与任务同事务）与标记已投递
GRANT SELECT, INSERT, UPDATE, DELETE ON task_outbox TO app_rw;

-- app_ro：只读账号
GRANT SELECT ON task_outbox TO app_ro;

-- app_audit：**不给** outbox 权限。
-- 理由：审计账号的职责边界是「只碰 audit_logs」。
-- 给它 outbox 的写权限会扩大「被攻破后能改什么」的面 ——
-- 攻击者若能改 outbox 状态，就能让任务永远不被投递（拒绝服务）。
REVOKE ALL ON task_outbox FROM app_audit;

-- ai_worker：Worker 需要把任务标记为 running / 成功 / 失败。
-- 它**不直接改** outbox（那是投递器的职责），但要能查到自己的任务。
-- 这里给 SELECT 便于 Worker 侧排查；实际状态更新走 segmentation_tasks。
GRANT SELECT ON task_outbox TO ai_worker;

-- ---------------------------------------------------------------------
-- 4. updated_at 自动维护
-- ---------------------------------------------------------------------
-- 与 001_init.sql 一致：统一用触发器而非应用层赋值，
-- 漏一处就会让审计追溯时数据不可信。
--
-- 注：fn_set_updated_at 已由 001_init.sql 创建，此处不重复定义
-- （规范 3：一个迁移只做一件事）。
DROP TRIGGER IF EXISTS trg_task_outbox_updated_at ON task_outbox;
CREATE TRIGGER trg_task_outbox_updated_at BEFORE UPDATE ON task_outbox
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------
-- 5. 运行时新建对象的默认权限
-- ---------------------------------------------------------------------
-- 001_init.sql 已声明 `ALTER DEFAULT PRIVILEGES ... GRANT ... TO app_rw`，
-- 本迁移新建的表自动继承 app_rw 的读写权限。
--
-- 注意：`ALTER DEFAULT PRIVILEGES` **只接受 schema 作用域**，
-- 不能写成 `REVOKE ALL ON task_outbox FROM app_audit`（语法错误）。
-- 审计账号对 outbox 的排除已在上面的第 3 节用显式 REVOKE 完成 ——
-- 那才是真正生效的那一步（默认权限只影响**之后**新建的对象）。

COMMIT;

-- =====================================================================
-- 验证：
--
-- 1) 表已建
-- SELECT * FROM medplan.task_outbox LIMIT 1;
--
-- 2) app_audit 对 outbox 无任何权限
-- SET ROLE app_audit;
-- SELECT count(*) FROM medplan.task_outbox;    -- 应报 permission denied
-- RESET ROLE;
--
-- 3) app_rw 可写
-- SET ROLE app_rw;
-- INSERT INTO medplan.task_outbox (task_id) VALUES ('<有效任务id>');
-- =====================================================================
