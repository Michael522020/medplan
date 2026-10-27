# MedPlan Phase 4 质量报告（独立验证）

| 项 | 值 |
|---|---|
| 项目 | MedPlan v1.0 — 企业级医学影像阅片与手术规划系统 |
| 报告人 | QA（严过关），独立验证者，**未参与开发** |
| 验收依据 | `docs/Spec.md` §9 的 **22 条 EARS 验收标准**（锁定）、`docs/架构方案.md` §12、`docs/openapi.yaml`、`compliance/等保三级与卫健委条款对照表.md` |
| 实测基线 | 发现缺陷时：`6b60eb9`（交付基线）<br>**复验基线**：`b86f6c8`（后端已提交全部修复，QA 重新实测） |
| 实测环境 | PostgreSQL 18 官方镜像（容器 `qa-pg-medplan`，端口 15533）、Node 22.22.2、真实 NestJS API 进程 |
| 复现脚本 | `scripts/qa_pg_setup.sh` / `scripts/qa_timing_probe.mjs` / `scripts/qa_timing_trials.sh` / `scripts/qa_e2e_probe.mjs` / `scripts/qa_explain_scope.sql` / `scripts/qa_session_token_probe.mjs` |
| 回归集 | `apps/api/src/__tests__/qa-phase4-regression.test.ts`（29 条断言） |

> **验证者声明**：本报告的每条结论都附**真实执行的命令与真实输出**。
> 本轮**没有**修改 `apps/` 与 `packages/` 下的业务代码 —— 业务代码的修改由后端按本报告的证据自行完成，QA 只提供测试文件、验证脚本与报告。

---

## 0. 结论摘要

| 指标 | 值 | 目标 | 判定 |
|---|---|---|---|
| 22 条 EARS AC 逐条判定（复验基线 `b86f6c8`） | **通过 12 / 部分通过 1 / 无法测 6** | — | ⚠️ |
| P0 缺陷 | **发现 5 个 → 全部修复并提交，QA 复验通过（复验基线 P0 归零）** | 0 | ✅ |
| P1 缺陷 | **4 个（待修）** | ≤ 总数 × 20% | ❌ |
| P2 缺陷 | **4 个** | 记录进 Backlog | ✅ |
| 越权时序 p99 差异（架构 §12.3 C-3） | **基线 `b86f6c8` 实测 10/10 通过，中位 10.60%，最大 15.32%**（累计 31 轮：30 过 1 越线） | < 20% | ✅ |
| 10004 / 不可区分响应体字节一致 | **63 vs 63，逐字节相同** | 相同 | ✅ |
| 契约端点一致性 | **12/12 全部实现，0 缺失** | 一致 | ✅ |
| 错误码一致性 | **20/20 代码侧错误码均见于契约，0 多余** | 一致 | ✅ |
| 数据库真实执行验证 | **23/23 通过** | 全通过 | ✅ |
| 静态断言 | **968 条通过** | 全通过 | ✅ |
| 现有单元测试（交付基线时） | 36 条 —— **对 5 个 P0 一个都抓不到** | 能抓 | ❌ |
| 修复后回归集 | **29/29 绿**（QA 新增）+ 全量 65 条测试 0 失败 0 跳过 | — | ✅ |
| **生产就绪总档** | **Bronze**（7 维中「测试+回归」「安全」「性能」三维仍为 Bronze） | Silver | ❌ |

**总判定：pass（有条件）—— P0 门禁已通过，但**不得**直接进入等保测评现场。**

5 个 P0 里有 **4 个属于「编译通过、lint 全绿、单元测试全绿，但产品不可用」**的沉默逻辑错误。
它们之所以能一路走到「开发完成并自检通过」，根因只有一个：**没有任何一道门禁真正跑过应用**。
后端已全部修复并提交（`2da8391` / `b86f6c8`），QA 在 `b86f6c8` 上重新实测确认。

**放行条件（缺一不可）**：
1. 4 个 P1 修复（其中 P1-03 涉及 AC-15 的合规语义，优先级最高）；
2. **smoke 门禁进 CI** —— 这是防止同类 P0 复发的唯一有效手段（见 §3 P0 根因表）；
3. 6 条无法测的 AC（AC-04/05/06/07/08/10）必须安排**院内现场验收**，不能靠报告替代。

---

## 0.5 修复后复验（基线 `b86f6c8`）

后端已把 5 个 P0 全部修复并提交（`2da8391` / `b86f6c8`）。QA **重建环境、重跑全部实测**：

```
$ bash scripts/qa_pg_setup.sh
  medplan_qa: 001_init 已应用 / 002_add_task_outbox.sql 已应用
  medplan_noschema: 001_init 已应用 / 002_add_task_outbox.sql 已应用
  medplan_qa: 时序种子已装载
  medplan_noschema: 时序种子已装载
  medplan_qa: 规模化数据已装载（6 万检查 / 4 万就诊 / 2 万报告）

$ node --test apps/api/.qa-build/__tests__/*.test.js
  # tests 65   # suites 18   # pass 65   # fail 0   # skipped 0

$ node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json   -> 0 错误
$ node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json   -> 0 错误
$ npm run lint                                                                -> 全部通过
$ node --test apps/api/.qa-build/__tests__/qa-phase4-regression.test.js
  # tests 29   # pass 29   # fail 0
```

端到端复验（`scripts/qa_e2e_probe.mjs`，真实 API 进程）：

```
╔═ 场景一：DATABASE_URL 按 .env.example 原样（无 schema 参数，库无 DB 级 search_path）
  GET /studies            HTTP 200  CL=854  body={"code":0,"message":"","data":{"items":[{"studyUid":"1.2.840.10008.5.1.4.1.1.2.9001",...
╔═ 场景二：越权不可区分性对比
  A 有权限检查              HTTP 200  CL=988
  B 越权检查               HTTP 404  CL=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  C 不存在检查              HTTP 404  CL=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  B 越权列表路径             HTTP 404  CL=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  C 不存在列表路径            HTTP 404  CL=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  A 有权限列表路径            HTTP 200  CL=855
  P0-05 复现：带 page/limit   HTTP 200
  P0-05 复现：审计列表         HTTP 200

  序列路径 B vs C：状态码相同=true  字节数相同=true (63 vs 63)  响应体逐字节相同=true
  列表路径 B vs C：状态码相同=true  字节数相同=true (63 vs 63)  响应体逐字节相同=true
```

| 缺陷 | 修复前（基线 `6b60eb9`） | 修复后（`b86f6c8`） | 复验方式 |
|---|---|---|---|
| P0-01 会话令牌 | 签名段 44 字节，验签恒 401 | 签名段 32 字节，验签通过 | 回归集令牌组 4 条 + 端到端 200 |
| P0-02 search_path | 端点 500 | 端点 **200** | 无 search_path 库上实测 |
| P0-03 视图列 | 端点 500 | 端点 **200/404** | 端到端实测 |
| P0-04 SQL JOIN 顺序 | `42601 syntax error at or near "LEFT"` | **200**（854 字节真实数据） | 端到端实测 + 回归集 |
| P0-05 query 数值转换 | 400「必须为有限数字」 | **200** | 端到端实测 + 回归集 |

**复验结论：5 个 P0 全部关闭，复验基线 P0 归零。**

> 补充：QA 独立复核了后端自行发现并修复的另外两处 —— `fn_sync_study_patient()` 与
> `fn_verify_audit_chain()` 缺 `SET search_path`（函数体表名按调用者 search_path 解析）。
> 修复后 QA 扫描全部 plpgsql 函数，确认**剩余 3 个未带 `SET search_path` 的函数
> （`fn_append_only_guard` / `fn_set_updated_at` / `fn_reports_signed_guard`）均不引用任何表**
> （只用 `TG_OP` / `now()` / `OLD.*`），**不存在同类隐患**。

---

## 1. 三个重点攻击方向的实测结果

### 方向 1（最高优先）：越权响应的时序不可区分性

#### 1.1 判定指标（架构方案 §12.3 C-3）

> 「对比『无权限访问』与『患者不存在』的响应时间分布（1000 次采样，p99 差异 <20%）」

#### 1.2 实测方法

- 三种场景用**真实数据**构造（`scripts/qa_seed_timing.sql`）：
  | 场景 | 含义 | 期望 |
  |---|---|---|
  | A | 患者存在，攻击者**有权限**（`patient_grants` 授权 + 科室规则命中） | 200，有数据 |
  | B | 患者**存在但无权限**（科室 CARDIOLOGY，无授权） | 10004 |
  | C | 患者**完全不存在** | 10004 |
- 攻击者上下文：`image_physician` 角色，`dept=RADIOLOGY`，非全局角色，非实习医师。
- 采样脚本**直接 import 生产代码的编译产物**（`StudiesRepository` / `SeriesRepository`），
  **不复制 SQL** —— 复制 SQL 会引入「副本与实现漂移」，测出来的结论可能对不上真实实现。
- 每轮 1000 次采样，**预热 300 轮**，三场景**轮转采样**（消除随时间漂移的系统性偏差）。
- 数据规模：60 002 检查 / 40 002 就诊 / 20 001 报告 / 20 002 患者（`scripts/qa_seed_bulk.sql`），
  已 `ANALYZE`，使规划器走真实计划。

#### 1.3 实测输出（最终干净实测：10 轮独立试验，每轮 1000 采样）

基线 `b86f6c8`（全部 P0 已修），无并发任务，预热 300 轮，耗时 3m02s：

```
  trial  1: p99=   10.60%  p50=   3.05%  overlap= 90.70%  B_p99=6.548  C_p99=5.921  -> PASS
  trial  2: p99=  -11.90%  p50=   2.92%  overlap= 94.80%  B_p99=6.665  C_p99=7.566  -> PASS
  trial  3: p99=    1.05%  p50=   0.44%  overlap= 92.80%  B_p99=5.658  C_p99=5.599  -> PASS
  trial  4: p99=   -6.97%  p50=   0.85%  overlap= 94.70%  B_p99=6.290  C_p99=6.761  -> PASS
  trial  5: p99=  -10.91%  p50=   0.87%  overlap= 93.90%  B_p99=8.050  C_p99=9.035  -> PASS
  trial  6: p99=    7.43%  p50=  -0.12%  overlap= 92.10%  B_p99=6.344  C_p99=5.905  -> PASS
  trial  7: p99=   -6.38%  p50=   0.84%  overlap= 92.40%  B_p99=5.128  C_p99=5.478  -> PASS
  trial  8: p99=   13.82%  p50=   2.81%  overlap= 90.40%  B_p99=15.593 C_p99=13.699 -> PASS
  trial  9: p99=   15.32%  p50=   3.26%  overlap= 92.50%  B_p99=6.929  C_p99=6.009  -> PASS
  trial 10: p99=   -2.47%  p50=   2.79%  overlap= 96.00%  B_p99=5.755  C_p99=5.901  -> PASS

=== 汇总（10 轮 x 1000 采样，warmup 300）===
  p99 差异绝对值: min=1.05%  中位=10.60%  max=15.32%
  p50 差异绝对值: min=0.12%  中位=2.79%  max=3.26%
  分布重叠度    : min=90.40%  中位=92.80%  max=96.00%
  PASS 轮次     : 10/10
  指标可复现性  : 每轮均通过（稳定达标）
```

**判定：PASS —— 10/10 轮达标，中位 10.60%、最大 15.32%，均低于 20% 阈值。**

**但偏差方向随机翻转**（trial 1/6/8/9 是 B 更慢，trial 2/4/5/7/10 是 B 更快），
⇒ 观测到的差异是**纯噪声**，不是「越权更慢」这一可利用方向。

#### 1.3.1 三组干净实测的累计结果（指标稳定性）

| 组 | 条件 | p99 差异（min/中位/max） | PASS |
|---|---|---|---|
| A | 预热 300，轻负载 | 2.03% / 5.14% / 9.72% | **10/10** |
| B | 预热 300，6 万检查满负载 | 2.16% / 7.27% / **20.85%** | **9/10** |
| C | 预热 300，基线 `b86f6c8`，干净环境 | 1.05% / 10.60% / 15.32% | **10/10** |
| — | 冷启动（**无预热**） | **27.30%** | 0/1 |

**累计 31 轮独立试验：30 轮通过，1 轮越线（组 B 的 20.85%，且该轮是 B 比 C *更快*）。**
⇒ 越线**不指向可利用方向**，属噪声；但 20% 阈值在此噪声水平下**余量很薄**（中位已达 7~11%）。

> **方法学教训（写进报告，不藏）**：本轮曾出现一次「10 轮 21 秒跑完」的异常数据 ——
> 原因是多任务并发导致 probe 失败，而试验脚本**静默复用了上一轮的 JSON**。
> 已修：脚本改为先清空输出目录，且 probe 失败即 `exit 1`；上文三组数据均为修好后重跑的干净结果。
> 记录此点是因为 —— **一个不会因为「数据不合理」而失败的测量脚本，本身就是缺陷**。

#### 1.4 但「结构性保证」这句话本身是**错的**（必须报告）

`apps/api/src/modules/studies/studies.service.ts:86-89` 的注释写：

> 「repository 内部先执行一次**仅按 study_uid 主键索引**的探测查询（恒定索引路径，与权限无关），
> 再执行带可见性谓词的作用域查询。两条路径的数据库调用次数与索引路径相同，因此响应时间分布一致」

**前半句对，后半句错。** `EXPLAIN (ANALYZE, BUFFERS)` 的确定性证据（`scripts/qa_explain_scope.sql`）：

| 指标 | B（越权） | C（不存在） |
|---|---|---|
| `Buffers: shared hit` | **14** | **2** |
| SubPlan 1（visits dept 规则） | **executed**（Index Scan，1 次） | **never executed** |
| SubPlan 3（reports 报告医师规则） | **executed**（Nested Loop，2 次 Index Scan） | **never executed** |
| SubPlan 6（patient_grants 授权规则） | **executed**（**Seq Scan**） | **never executed** |
| Index Searches 合计 | 1(studies) + 1(visits) + 1(studies_pkey) + 1(reports) + 1(grants) = **5** | **1** |
| Execution Time | 0.135 ms | 0.020 ms |

**根因（确定性，非概率）**：过滤表达式是 `study_uid = $5 AND (可见性谓词)`，PostgreSQL **短路求值**：

- C（不存在）：`study_uid = $5` 为 **FALSE** → 右侧的 3 个 EXISTS 子计划**完全不执行**；
- B（存在但无权限）：`study_uid = $5` 为 **TRUE** → 3 个 EXISTS 子计划**全部执行**（且因 OR 结构无一命中，全部走完）。

⇒ 探测查询只对齐了「**数据库调用次数**」，**没有对齐「每次调用的工作量」**。
⇒ 当前量级下差异约 0.1 ms（B 0.135 ms vs C 0.020 ms），**低于 1 ms 级噪声底**，
所以 p99 指标在多数轮次达标（见 1.3：9/10）；
⇒ 但这是**偶然达标**，不是设计保证。且 SubPlan 6 在规模化数据下是 `Seq Scan on patient_grants`，
**随授权表线性增长** —— 数据量上去后差异会重新浮出噪声底，成为可利用的时序预言机。

**结论：AC-16 的「响应时间不可区分」在当前规模成立（P1 级结构性隐患），但代码注释所声称的「结构性保证」不成立（P2 级文档-代码不一致）。**

#### 1.5 指标本身缺少测量条件定义（advisory）

§12.3 C-3 只写了「1000 次采样，p99 差异 <20%」，**没有规定预热、百分位算法、数据规模、重复轮次**。
实测证据见 1.3 的三行对照表：同样的代码，**冷启动 27.30%（FAIL）/ 轻负载 10 轮全过 / 满负载 9/10 过**。

⇒ 指标结论随测量条件翻转，而两次越线都**不是**「越权更慢」方向（trial 3 是 B 更快），
说明越线来自噪声而非系统性偏差。
⇒ 等保测评现场若按 §12.3 原文复现，**可能得到与本次相反的结论**，且无法解释为何两次结果不同。
建议在架构方案 §12.3 C-3 补齐测量条件：预热轮次、数据规模下限、百分位算法（最近秩）、
重复轮次数与聚合方式（取中位数而非单轮）、以及「单轮越线不判失败」的说明。

#### 1.6 HTTP 层的字节级不可区分性（实测）

真实 API 进程（`scripts/qa_e2e_probe.mjs`，自行拉起 `apps/api/.qa-build/main.js`）：

```
  A 有权限检查                  HTTP 200  CL=988  字节=988  body={"code":0,"message":"","data":{"studyUid":"1.2.840.10008.5.1.4.1.1.2.9001",...}}
  B 越权检查                   HTTP 404  CL=63   字节=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  C 不存在检查                  HTTP 404  CL=63   字节=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  B 越权列表路径                 HTTP 404  CL=63   字节=63   body={"code":10004,"message":"请求的资源不可用","data":null}
  C 不存在列表路径                HTTP 404  CL=63   字节=63   body={"code":10004,"message":"请求的资源不可用","data":null}

  序列路径 B vs C：状态码相同=true  字节数相同=true (63 vs 63)  响应体逐字节相同=true
  列表路径 B vs C：状态码相同=true  字节数相同=true (63 vs 63)  响应体逐字节相同=true
```

**判定：PASS —— 状态码、Content-Length、响应体三者逐字节一致。** 攻击者读响应体无法区分「越权」与「不存在」。

补充确认：`AppError.notFound()`（10005）在**生产代码中一次都没有被调用**
（`grep -rn "AppError.notFound()" apps/api/src` 仅命中测试文件）。
若哪天在 PHI 路径上误用 10005，`code` 字段值本身就是存在性预言机 —— 已在回归集里加了守卫断言。

---

### 方向 2：四条安全约束的对抗性验证

| # | 约束 | 实测结论 | 证据 |
|---|---|---|---|
| 1 | **10004 / 10005 不可区分** | ✅ 通过（HTTP 层字节级一致；且 10005 在生产代码中零调用） | 见 1.6；回归集「10004 与 10005 的 HTTP 响应体不可区分」组 |
| 2 | **AI 模型白名单** | ✅ 通过（含对抗性绕过测试） | 见 2.1 |
| 3 | **confirmed_by 服务端权威** | ✅ 通过（补齐了原测试的漏洞） | 见 2.2 |
| 4 | **签名摘要绑定** | ✅ 通过（`signatureValid` 独立于 `state` 已确认） | 见 2.3 |

#### 2.1 模型白名单 —— 对抗性绕过

`brain_aneurysm`（CC BY-NC 4.0，上游明确不提供商业许可）被正确拒绝。
QA 补测了原 36 条测试**没有覆盖**的绕过路径：

```
brain_aneurysm            -> 拒绝 ✓
BRAIN_ANEURYSM            -> 拒绝 ✓（大小写变体）
'brain_aneurysm '         -> 拒绝 ✓（尾部空白）
'brain_aneurysm\n'        -> 拒绝 ✓（换行）
'brain-aneurysm'          -> 拒绝 ✓（连字符）
'totally_made_up_task'    -> 拒绝 ✓（未登记 task 默认拒绝）
'' / 'total ' / 'TOTAL' / '../total' / 'total;drop' / 'total\0' -> 全部拒绝 ✓
遍历 MODEL_LICENSE_REGISTRY 全部 46 个 task：非 Apache-2.0 且不可商用的 15 个全部拒绝 ✓
```

白名单是 `Set.has()` 精确匹配，**没有发现绕过路径**。

#### 2.2 confirmedBy / confirmedAt —— 补齐原测试的漏洞

原有 36 条测试已覆盖「顶层传 confirmedBy 被拒」「顶层传 confirmedAt 被拒」「item 内额外字段被拒」。
QA 补测了**原测试没覆盖**的路径：

| 绕过路径 | 原测试 | QA 补测 | 结果 |
|---|---|---|---|
| 顶层 `confirmedBy` | ✅ 有 | — | 拒绝 ✓ |
| 顶层 `confirmedAt` | ✅ 有 | — | 拒绝 ✓ |
| item 内 `confirmedBy` | ✅ 有 | — | 拒绝 ✓ |
| item 内 `confirmedAt` | ❌ **无** | ✅ 有 | 拒绝 ✓ |
| 深层嵌套 `items[0].meta.confirmedBy` | ❌ **无** | ✅ 有 | 拒绝 ✓ |
| `constructor` / `prototype` 键 | ❌ **无** | ✅ 有 | 拒绝 ✓ |
| `__proto__`（**按真实 JSON.parse 路径**） | ❌ **无** | ✅ 有 | 拒绝 ✓ |

> 复核说明：QA 第一版的 `__proto__` 测试用了对象字面量 `{__proto__: {...}}`，
> 那会**设置原型**而不是创建自有属性，与真实请求路径（Fastify 用 `JSON.parse` 解析，
> `JSON.parse` 用 `DefineOwnProperty` 定义 `__proto__`，它是**自有可枚举属性**）不符。
> 改正为 `JSON.parse(...)` 后测得：校验器用 `Object.keys(input)` 判未知键，能看见它 → 正确拒绝。
> **该路径安全，此项不构成缺陷。**

业务层亦正确：`segmentation-confirm.service.ts:103` 的 `confirmedBy: session.userId` 取自会话，
`confirmedAt` 用服务端 `new Date()`，请求体无法影响。

#### 2.3 签名摘要绑定与 `signatureValid` 独立性

- **正文改一字符 → SM3 变化** ✓（QA 补测了「改**不参与签名的字段**不应影响摘要」与「数组顺序不同 → 摘要不同」两条，原测试没有）
- **`signatureValid` 独立于 `state`** ✓ —— `reports.service.ts:161-165` 是**重算当前正文 SM3 再与签名时记录的摘要比对**，
  不是读 `status` 字段。状态仍是 SIGNED 但正文被改时，`signatureValid` 会变 false。**实现正确。**
- **验签输入用服务端重算的 `bodyDigest`** ✓（`report-signing.service.ts:93-94`）

**但发现 1 个 P1（见缺陷清单 P1-03）**：证书有效期校验用的是**本地时间**，与其自身注释和参数名相矛盾。

---

### 方向 3：契约与实现的一致性

#### 3.1 端点：12/12 一致

契约 `docs/openapi.yaml` 定义 12 个端点，API 启动日志（`RouterExplorer`）实测注册 13 个：

```
契约端点 12 个 / 实际路由 13 个（含 1 个未入契约的 health）
  契约有但未实现: 无
  实现有但契约无: GET /api/v1/health
```

- **12/12 全部实现，0 缺失。** 归一化处理：openapi 的 `{studyUid}` ↔ NestJS 的 `:studyUid`。
- **1 个多余端点**：`GET /api/v1/health`（健康检查）。它不在 openapi.yaml 里。
  建议**补进契约**（运维探针需要），或明确标注为非契约端点。

#### 3.2 错误码：20/20 一致，0 多余

```
契约文本中出现的错误码: 23 个
代码 ERROR_CODES 定义     : 20 个
  两侧都有 (20): 10001, 10002, 10003, 10004, 10005, 20001, 20002, 20003, 30001, 30002,
                 30003, 40001, 40002, 40003, 40004, 50001, 50002, 50003, 50004, 90001
  仅代码有 (0): 无
```

**代码侧没有契约外的错误码，也没有遗漏。** 契约多出的 3 个数字（10008 / 18720 / 28800）是
`maxLength` 与 HTTP 状态码示例值的误匹配，不是错误码。

#### 3.3 卫健委电子病历必备字段：15/15 覆盖

由 `scripts/verify_db.sh` 的第 [8] 组真实执行验证覆盖（架构方案 §7.3）：
```
=== [8] 卫健委电子病历必备字段覆盖 ===
  ok    必备字段覆盖 15/15（架构方案 §7.3）
```
✅ 通过。

---

## 2. 22 条 EARS 验收标准逐条判定

判定口径：**通过** = 已实测且符合；**失败** = 已实测且不符合；**无法测** = 依赖真实 PACS / GPU / CA / 浏览器 / 硬件。

| AC | EARS 验收标准 | 判定 | 依据（命令 / 输出 / 代码位置） |
|---|---|---|---|
| AC-01 | 双因素认证并签发会话 | **通过** | 会话令牌签发端双重 base64 编码致验签恒不匹配 → 登录后每个请求都 401。**已在 `2da8391` 修复并复验通过**（回归集令牌组 4 条全绿；端到端带令牌请求 200）（见 P0-01） |
| AC-02 | 未提供 UKey 数字证书必须拒绝 | **通过** | `ukey-verifier.service.ts` fail-closed；`UKEY_CERTIFICATE_PROVIDER` 未配置时 `findBySerial` 返回 undefined → 签名链路拒绝 |
| AC-03 | 加载全部序列并按期相分组 | **通过** | 实测 `GET /studies/{uid}/series` 返回 `phaseGroups` 按 `plain→arterial→portal→delayed→unknown` 固定顺序分组（`studies.service.ts:131-159`） |
| AC-04 | 窗宽窗位 100ms 内更新且不丢 HU 精度 | **无法测** | 需真实浏览器 + GPU + Cornerstone 渲染；`preferSizeOverAccuracy: true` 为静态断言（`verify-types.ts`），性能指标需人工验收 |
| AC-05 | 2000 层薄层 CT 首帧 ≤3s / 全量 ≤15s | **无法测** | 需真实 2000 层 DICOM 数据集 + GPU 浏览器环境。本机无 DICOM 数据、无 GPU |
| AC-06 | WebGL 不可用降级 2D 并隐藏三维入口 | **无法测** | 需禁用 WebGL 的真实浏览器。代码侧已具备 `capability.ts` 检测与降级分支，但**未实测** |
| AC-07 | 长度工具显示毫米级数值且可保存 | **无法测** | 需浏览器交互实测。代码侧 `pixel_spacing_mm` → 毫米换算存在，但未实测 |
| AC-08 | 10 分钟内返回 mask | **无法测** | 需真实 GPU 节点 + TotalSegmentator 权重。Spec Q3 亦承认「无 GPU 则该时限不成立」 |
| AC-09 | 非 Apache-2.0 白名单拒绝（40003）并写审计 | **通过** | `brain_aneurysm` 被拒；46 个 task 全表遍历校验通过；绕过路径（大小写/空白/连字符/未登记）全拒（见 2.1） |
| AC-10 | GPU 显存不足强制 `--fast` 并标注降级 | **无法测** | 需真实 GPU 显存压测。代码侧有 `fast` 字段与 `ai_assist.degraded` 结构 |
| AC-11 | 未完成全部 AI 确认必须阻断报告提交 | **通过** | `segmentation-confirm.service.ts` 强制 `knownStructures` 校验 + `modified` 必填 `modificationNote`；报告侧 `findMissingControlledFields` 阻断签名 |
| AC-12 | 5 类受控字段缺失阻断签名 | **通过** | `report-signing.service.ts:230-233`：`findMissingControlledFields` 非空 → 10001 阻断；QA 复测 `['impression']` 正确识别 |
| AC-13 | 绑定正文摘要并锁定报告 | **通过** | `report-signing.service.ts:93-95` 服务端重算 SM3 + SHA-256；`markSigned` 写库并 `lockPlans` 锁定规划方案 |
| AC-14 | 正文任何变更使原签名立即失效 | **通过** | `buildLockState` 重算 SM3 与签名时摘要比对，`signatureValid` 独立于 `state`（`reports.service.ts:161-165`）；QA 补测「改一字符 → 摘要变化」 |
| AC-15 | NTP 偏移超阈值拒绝签名且不得用本地时间兜底 | **部分通过 / P1** | `assertWithinDrift()` 偏移 >60s 拒绝且**不回退本地时间**（`authoritative-time.service.ts:93` 明确「绝不退回本地时间」）✓；但**证书有效期校验用的是本地时间**（P1-03） |
| AC-16 | 越权返回 10004 且与「患者不存在」不可区分 | **通过** | 实测 B/C 状态码、Content-Length（63 vs 63）、响应体**逐字节相同**（见 1.6）。时序 p99 10/10 达标 |
| AC-17 | 连续访问 PHI 每次写审计 | **通过** | `audit-hook.ts` 挂 `onRequest` + `onSend`，覆盖成功/拒绝/失败三态；DB 层 `fn_verify_audit_chain()` 返回 0 行（23 组验证 [6] 通过） |
| AC-18 | 审计记录被修改/删除必须拒绝 | **通过** | 实测：权限层 `app_rw` UPDATE/DELETE/TRUNCATE 被拒；触发器层表 owner DELETE 被拒；hash chain 自动计算并校验通过（23 组验证 [6]） |
| AC-19 | 审计日志保留 ≥6 个月 | **通过** | `retention_class` 枚举含 `audit_6m`；`ck_patient_grants_retention` 强制；`audit_logs` 按月分区 + DEFAULT 兜底分区（23 组验证 [7]） |
| AC-20 | 门急诊报告 ≥15 年、住院 ≥30 年 | **通过** | `retention_class` 含 `report_15y`/`report_30y`；`ck_reports_retention` 约束 |
| AC-21 | 默认加载暗色主题且 Canvas 区恒暗 | **通过（代码级）** | `theme.ts:23` `DEFAULT_THEME = 'dark'`，`THEME_BOOTSTRAP_SCRIPT` 在首屏前写入 `data-theme`；`--color-surface-canvas` 亮色主题下恒为 `#1A1A1A`（design-tokens 断言） |
| AC-22 | 危急值同时提供颜色、图标与文字三重编码 | **通过（代码级）** | `status-badge.tsx`：`TONE_ICON` 强制 Tabler 图标（`IconAlertTriangle`）+ `<span class="status-badge__text">` 文字 + token 颜色；图标与文字为**必填**，类型层面即不允许「只有颜色」 |

**统计（复验基线 `b86f6c8`）：通过 12 / 部分通过 1（AC-15）/ 无法测 6（AC-04/05/06/07/08/10）**

> AC-01 在**交付基线 `6b60eb9` 上是失败的**（P0-01），已由后端在 `2da8391` 修复并经 QA 复验通过。
> AC-15 判「部分通过」是因为权威时间偏移拒绝与「不用本地时间兜底」成立（`assertWithinDrift`），
> 但**证书有效期校验用的是本地时间**（P1-03）—— 两者在同一条签名链路上，语义应一致。

---

## 3. 缺陷清单

### P0 —— 致命（必须全部修复才能上线）

| ID | 现象 | 证据（文件:行号） | 复现步骤 | 期望行为 | 状态 |
|---|---|---|---|---|---|
| **P0-01** | **登录成功但每个请求都 401**。签发端把 HMAC 做了**双重 base64 编码**（`base64url(signature.toString('base64'))`，`base64url` 内部又 `Buffer.from(value,'utf8')`），签名段解码后是 44 字节；验签端拿它与 32 字节原始 HMAC 比，长度不等 → 恒 false | `apps/api/src/common/auth/jwt-verifier.ts:273`（基线）/ `:277`（修复后） | 跑 `node scripts/qa_session_token_probe.mjs`（生产 `signSessionToken` → 生产 `verifyJwt`） | 签发的令牌必须能被本服务的验签函数接受 | **已修复并提交**（`2da8391`），QA 复验：回归集令牌组 4 条全绿，端到端 200 |
| **P0-02** | **应用连不上数据库**。连接串里的 `?schema=medplan` 被 node-postgres **静默忽略**（`pg` 只认 `?options=`），实测 `SHOW search_path` 仍是 `"$user", public`；而 28 张业务表全在 `medplan` schema 下 ⇒ 按 `.env.example` 部署，**每个** PHI 请求都 500 | `apps/api/src/common/db/pool.ts:49,61`（基线） | `node -e "new Client({connectionString:'...?schema=medplan'}).query('SHOW search_path')"` → `"$user", public` | 连接建立后 `search_path` 必须含 `medplan` | **已修复并提交**（`2da8391`），QA 复验：无 search_path 库上 `GET /studies` 由 500 变 **200** |
| **P0-03** | **`GET /studies?patientId=` 必然 500**。`probePatientScope` 查 `v_patients_masked p` 上的 `p.deleted_at`，但该**视图没有这一列**（视图内部已 `WHERE p.deleted_at IS NULL`）⇒ 42703 | `apps/api/src/modules/studies/studies.repository.ts:224`（基线） | 跑 `scripts/qa_e2e_probe.mjs`，观察 `GET /studies?patientId=...` | 返回 10004 或 200，不得 5xx | **已修复并提交**（`2da8391`），QA 复验：`GET /studies?patientId=` 由 500 变 **200/404** |
| **P0-04** | **工作台列表端点必然 500**。SQL 拼接把 `LEFT JOIN LATERAL` 放在 `${baseSelect}` 之后，而 `baseSelect` 已含 `WHERE` ⇒ PostgreSQL 报 `42601 syntax error at or near "LEFT"`（JOIN 必须属于 FROM 列表，在 WHERE 之前） | `apps/api/src/modules/studies/studies.repository.ts:125` + `:171-172` | 跑 `scripts/qa_e2e_probe.mjs`，`GET /api/v1/studies` 不带 patientId | 返回 200 + 检查列表 | **已修复并提交**（`b86f6c8`），QA 复验：`GET /studies` **200**（854 字节，含真实数据） |
| **P0-05** | **带 page/limit 的列表请求必然 400**。两个 controller 都是「先校验、后转换」：用**原始** query 走 `s.number()` 校验器，而 Fastify 的 query 参数永远是字符串 ⇒ 「必须为有限数字」。`normalizeStudyListQuery` / `normalizeAuditQuery` 的转换函数**写了但接在校验之后** | `apps/api/src/modules/studies/studies.controller.ts:32`<br>`apps/api/src/modules/audit-logs/audit-logs.controller.ts:29` | `GET /api/v1/studies?page=1&limit=20` → 400 `{"code":10001,...,"path":"query.page","message":"必须为有限数字"}` | 返回 200 + 分页列表 | **已修复并提交**（`b86f6c8`），QA 复验：`GET /studies?page=1&limit=20` **200**；`GET /audit-logs?page=1&limit=20` **200** |

> **P0-04 与 P0-05 合起来 = 工作台（Spec §7 的 `/worklist`，阅片入口）100% 不可用。**
> 两种请求形态都坏：带 `page/limit` → 400；不带 → 500。

**P0 的共同根因（必须在报告中留档）**

| 现有门禁 | 为什么一个 P0 都抓不到 |
|---|---|
| 36 条单元测试 | 全部是**纯逻辑**断言：不起 Nest、不连数据库、不发 HTTP。`security-constraints.test.ts` 的文件头注释自己写着「数据库相关的行为（越权探测的时序等）需要集成测试，已在交付说明中标注为待补」 |
| 23 组数据库验证 | 验的是 **schema / 触发器 / 授权 / 约束**，**不跑应用的 SQL**。应用 SQL 的语法错误与参数顺序错误不在其覆盖范围 |
| 968 条静态断言 | lint 能看见拼写与风格，看不见 SQL 语法与类型 |
| CI 两个 job | 都是「跑 lint + 跑 db 验证」，**没有任何 job 真正启动应用并打端点** |

⇒ **建议新增 smoke 门禁**：`npm run build:test` → 起 API → 打 `/health`、`/studies?page=1&limit=20`、`/studies/{uid}/series` → 断言 200/404 而非 4xx/5xx。
本轮 5 个 P0 **全部**会被这道门禁挡住。QA 的 `scripts/qa_e2e_probe.mjs` 已具备该能力，可直接接入 CI。

> **复验补充**：后端已在 `db-schema.integration.test.ts` 中补了 4 条**真实 PostgreSQL 18** 的集成回归
> （JOIN 顺序、query 归一化顺序、非法数字不被静默默认、search_path 自带），
> 并在 `61c119d` 中把迁移门禁扩展到全部迁移 —— 方向正确。
> **但「起服务打端点」的 smoke 门禁仍未进 CI**（见 §8 未完成项第 2 条）。

### P1 —— 严重（建议修复 ≥80%）

| ID | 现象 | 证据 | 期望 |
|---|---|---|---|
| **P1-01** | **越权时序的结构性差异真实存在**（EXPLAIN 确定性证据：B 走 3 个 EXISTS 子计划、14 个 buffer；C 走 0 个、2 个 buffer）。当前差异约 0.03 ms 低于噪声底，故 p99 指标达标，但这是**偶然达标**；且 `Seq Scan on patient_grants` 随数据量线性增长 | `apps/api/src/modules/studies/studies.service.ts:86-89`（注释声称「索引路径相同 → 分布一致」）<br>`scripts/qa_explain_scope.sql` 实测 | ① 修正代码注释的失实表述；② 让作用域查询的工作量与资源是否存在无关（例如统一先算可见性集合，再按 study_uid 取行），或对存在/不存在两条路径都执行等价的探测工作 |
| **P1-02** | **审计写入失败的响应体不符合契约**。Fastify `onSend` 钩子里抛出的 `AppError` **不走** Nest 的 `AppExceptionFilter`，被 Fastify 默认错误序列化器接管，产出 `{"statusCode":500,"code":"90001","error":"Internal Server Error","message":"审计写入失败，请求已拒绝"}` —— `code` 是**字符串**、多出 `statusCode`/`error` 字段、**没有 `data` 字段**。前端 `api-client.ts` 期望 `{code:number, message, data}` 且以 `code` 分支 | 实测响应体（见 1.6 之前的运行日志）；`apps/api/src/common/audit/audit-hook.ts:199-203` | 统一错误封装：hook 内抛错也必须产出契约的 `{code:number, message, data}` |
| **P1-03** | **证书有效期校验用本地时间，与其注释和参数名矛盾**。`isCertificateValidAt(info, authoritativeNow)` 参数名是 `authoritativeNow`，但 `signature.service.ts:134` 传的是 `new Date()`（本地时间），而上一行注释写「用权威时间判定（**不是本地时间**）」。AC-15 明确「不得用本地时间兜底」 | `apps/api/src/modules/reports/signature.service.ts:132-137` | 证书有效期用权威时间判定（先取权威时间，再校验证书，再验签，再 TSA） |
| **P1-04** | **`GET /api/v1/health` 是契约外的端点**。已注册并返回数据，但 openapi.yaml 未定义 | `apps/api/src/health/health.controller.ts:9-11`；实测启动日志 `Mapped {/api/v1/health, GET}` | 补进 openapi.yaml（运维探针需要），或明确标注为非契约端点 |

### P2 —— 一般（记录进 Backlog）

| ID | 现象 | 证据 | 建议 |
|---|---|---|---|
| **P2-01** | `reports` 的 DELETE 触发器**缺 `WHEN` 子句**，而配对的 UPDATE 触发器有。⇒ 删除 **draft** 状态报告也被拒绝（实际影响有限：应用只用软删除 `deleted_at`，全库无 `DELETE FROM reports`）。且报错文案自相矛盾：「报告 xxx 已签署（status=draft）」 | `docs/db/migrations/001_init.sql:868-870`（对比 `:872-876`） | 给 DELETE 触发器补 `WHEN (OLD.status IN ('signed','archived'))`；修正文案 |
| **P2-02** | 错误码注释**夸大**了保证：`error-codes.ts:122-124` 写「两个场景返回**字节级相同**的体」，实测 10004 与 10005 的响应体相差 1 个字节（`code` 的 `4` vs `5`）。架构方案 §7.6 的要求是「**响应体大小**」不可区分 —— 要求本身满足，是注释的表述过头 | `apps/api/src/common/errors/error-codes.ts:119-129` | 把注释改为「响应体大小相同」；并说明 10005 仅用于 UUID v7 非 PHI 资源 |
| **P2-03** | **`scripts/verify_db_local.sh` 会删除别人的容器**。脚本第 46 行 `docker ps -a ... \| grep -E '^medplan-pg'` 会匹配并 `docker rm -f` **所有** `medplan-pg*` 容器，包括他人正在使用的。本轮 QA 的容器被它删了两次 | `scripts/verify_db_local.sh:46-51` | 只删自己创建的容器（按 label 或精确名匹配） |
| **P2-04** | **架构方案 §12.3 C-3 的指标缺少测量条件，余量很薄**。累计 31 轮独立试验：冷启动 27.30%（FAIL）、轻负载 10/10（max 9.72%）、满负载 9/10（max 20.85%）、修复后干净环境 10/10（max 15.32%）。**唯一那次越线的偏差方向是 B 比 C 更快**，即越线来自噪声而非「越权更慢」 | 本报告 1.3 / 1.3.1 / 1.5 | 在 §12.3 C-3 补齐预热轮次、数据规模下限、百分位算法、重复轮次数与聚合方式（取中位数），并说明单轮越线不判失败 |

---

## 4. 测试完整性反作弊审查（按 `test-integrity-anti-gaming.md`）

| 检测项 | 结果 | 详情 |
|---|---|---|
| 测试文件/用例被删 | ✅ 未发现 | `git log` 显示测试文件只增不减；本轮新增 1 个文件、29 条断言 |
| 断言数下降 | ✅ 未发现 | 现有 36 条断言全部保留，QA 未改动任何既有测试的断言 |
| 新增 skip / xfail / .only | ✅ 未发现 | `grep -rn "skip\|xfail\|\.only\|focus" apps/api/src/__tests__/` 零匹配 |
| 断言硬编码实现自身输出 | ⚠️ **发现弱断言** | `security-constraints.test.ts:28-41` 断言的是 `AppError` **对象字段**（`message` 相等、`detail` undefined、状态码相等、code 字符串长度相等），**不是**真实 HTTP 响应体。它证明不了「响应体字节数相同」—— QA 实测 10004 与 10005 的响应体就**不相同**（差 1 字节）。这条测试的标题「10004 与 10005 的响应体字节数相同」与它实际验证的内容不符 |
| 测试框架配置篡改 | ✅ 未发现 | `jest.config`/`pytest.ini` 不存在（项目用 `node:test`）；`package.json` 的 `scripts.test` 未被改动 |
| 覆盖率数字被调低 | ✅ 未发现 | 无覆盖率阈值配置 |
| 恒真断言 | ⚠️ **发现 1 处** | `security-constraints.test.ts:142-148`「action=modified 缺 modificationNote 时通过 schema（业务层再拦）」—— 这条断言的是**当前实现的既成行为**，而非规格要求。规格要求是「modified 必须带备注」，断言却写成「schema 层允许缺省」。若后续有人误把 schema 收紧，这条测试会红 —— 方向反了。更关键：**它断言了业务层会拦，但没有断言业务层真的会拦**（`segmentation-confirm.service.ts:81-84` 的 `modificationNote` 校验**无任何测试覆盖**） |

**结论：现有 36 条测试无作弊行为，但存在「弱断言」与「测试标题与断言内容不符」两类问题。
更重要的是 —— 36 条测试对 5 个 P0 的覆盖率是 0。**

---

## 5. 失效模式核对（6 类）

| 失效模式 | 结果 | 详情 |
|---|---|---|
| Happy-path / 错误处理偏差 | ❌ | P0-04 / P0-05：工作台的**成功路径本身**就是坏的。错误分支（越权 10004）反而是好的 |
| **沉默逻辑错误（最致命）** | ❌ **严重** | 5 个 P0 全部是「编译通过、lint 全绿、单测全绿、产品不可用」。P0-01（双重 base64）、P0-04（JOIN 在 WHERE 后）是最纯粹的形态 —— **没有任何信号提示你错了** |
| 幻觉依赖/接口 | ✅ | `npm ci` 后 `tsc --noEmit` 0 错误；968 条静态断言通过；无编造 API。依赖版本均已锚定 |
| 缺失系统上下文 | ⚠️ | 权限/限额/数据隔离齐备（RBAC + L3 + 审计 append-only + hash chain，实测有效）；但**速率限制未实现**（Spec §10「院内网络仍需防低速攻击」只有 `bodyLimit`，无 rate limit）—— advisory |
| 性能盲区 | ❌ | P0-04 之外：**L3 可见性谓词在规模化数据下退化为 `Seq Scan on patient_grants`**（见 P1-01）。`GET /studies` 无缓存、无 `EXPLAIN` 基准 |
| 静默缺失 import / 未用结果 | ✅ | `tsc --noEmit` 0 错误；lint 全绿 |

---

## 6. 生产就绪评分（`production-readiness-scorecard.md` 七维 × 三档）

**总档 = 各维最低档 = Bronze。目标档 Silver（商业级）未达成。**

| 维度 | 档位 | 证据 | 离 Silver 差什么 |
|---|---|---|---|
| 测试 + 回归 | **Bronze** | 交付基线时：36 条纯逻辑单测 + 23 组 DB 验证 + 968 条静态断言，**对 5 个 P0 覆盖率 0**。<br>复验基线 `b86f6c8`：QA 回归集 29 条 + 集成回归 4 条，**29/29 绿**，5 个 P0 全部被守住；无影响图、无回归率指标、无变异加固 | ① **起服务打端点的 smoke 门禁进 CI**（最高优先）② 关键路径变异加固 ③ 回归率纳入发布报告 |
| 契约 | **Silver** | 12/12 端点一致、20/20 错误码一致、0 多余；契约先行、前后端类型由 openapi 生成；`lint_openapi.js` 已有 13 条自检 | 契约破坏在 CI 即红（需补 openapi↔运行时路由自动比对 —— 本轮 QA 是手工比对的）；`/health` 未入契约（P1-04）；版本与弃用策略未闭环 |
| 安全 | **Bronze** | RBAC + L3 下推到 SQL + 审计 append-only + hash chain + 权限分离**均实测有效**（app_rw 改不了审计、app_audit 读不到 PHI）；模型白名单对抗性通过；confirmedBy 权威性通过；10004 响应体字节级不可区分已实测 | ① 越权时序**无结构性保证**，仅偶然达标（P1-01）② 证书有效期用本地时间（P1-03）③ 无速率限制 ④ 无 SAST/依赖扫描门 ⑤ 审计失败响应体不符契约（P1-02） |
| 无障碍 | **Bronze** | AC-22 三重编码在类型层面强制；对比度/焦点断言存在 | 无自动扫描 0 阻断；无屏读端到端走查；`/health` 契约外；无障碍未被实测 |
| 性能 | **Bronze** | 无压测数据；L3 谓词退化 `Seq Scan`（P1-01）；`GET /studies` 全量扫描 | 热点路径 p95 基准、容量验证、分页/索引/超时到位 |
| 可观测 | **Bronze** | 结构化日志（Fastify logger）+ 审计事件类型 12 类对齐 + hash chain | 无 SLI/SLO、无告警、无追踪、无错误预算 |
| 发布安全 | **Bronze** | 可回退（Git 分支）；无灰度 | 无自动回滚、无特性开关、变更不可审计 |

**离 Silver 的最短路径（按优先级）**
1. ✅ ~~修完并提交 P0-01~P0-05~~ —— **已完成**（`2da8391` / `b86f6c8`），QA 复验通过。
2. **加 smoke 门禁：起 API 打端点，断言 2xx/4xx 而非 5xx。** 这一步能挡住本轮全部 5 个 P0 —— **尚未做，最高优先**。
3. ✅ ~~把 QA 回归集（29 条）并入 CI~~ —— **已完成**（与集成回归同批执行，29/29 绿）。
4. 修 P1-03（权威时间）→ P1-02（错误封装）→ P1-01（时序结构性保证）→ P1-04（契约）。
5. 补 12.3 C-3 的测量条件定义（消除指标翻转）。
6. 6 条无法测的 AC 安排院内现场验收。

---

## 7. 回归集更新

| 新增回归用例 | 对应缺陷 | 文件路径 |
|---|---|---|
| 会话令牌签发→验签闭环（签名段字节长度 = 32） | P0-01 | `apps/api/src/__tests__/qa-phase4-regression.test.ts` |
| 验签失败返回 10002 / 被篡改载荷被拒 / 过期令牌被拒 | P0-01 | 同上 |
| `probePatientScope` 不得引用 `p.deleted_at` | P0-03 | 同上 |
| `LEFT JOIN LATERAL` 必须在 `baseSelect` 内（WHERE 之前） | P0-04 | 同上 |
| `normalizeStudyListQuery` 必须早于 `parseOrThrow`（studies） | P0-05 | 同上 |
| `normalizeAuditQuery` 必须早于 `parseOrThrow`（audit-logs） | P0-05 | 同上 |
| 10004 / 10005 响应体**大小**相同 + 10005 在生产代码零调用 | AC-16 / P2-02 | 同上 |
| 模型白名单：46 个 task 全表遍历 + 大小写/空白/连字符/未登记绕过 | AC-09 | 同上 |
| confirmedBy/confirmedAt 6 条绕过路径（含 JSON.parse 真实路径） | 安全约束 #3 | 同上 |
| 签名摘要：改一字符变化 / 键序无关 / 数组顺序敏感 | AC-13 / AC-14 | 同上 |

**当前状态（复验基线 `b86f6c8`）：29 条断言 —— 29 通过 / 0 失败。**
P0-01/02/03 修复后已转绿；P0-04（1 条）与 P0-05（2 条）在 `b86f6c8` 修复后转绿。
**这 29 条断言现已并入 `apps/api` 的测试入口，与后端新增的集成回归同批执行。**

---

## 8. 未完成项

1. **「起服务打端点」的 smoke 门禁仍未进 CI** —— 本轮 5 个 P0 全部逃过现有门禁。
   后端已补真实库集成回归（`db-schema.integration.test.ts`，4 条），但那仍**不覆盖**
   「路由装配 + 异常封装 + 真实 HTTP」这一层。建议把 `scripts/qa_e2e_probe.mjs` 接入 CI。
2. **4 个 P1 未修**：P1-01（越权时序的结构性差异）、P1-02（审计失败响应体不符契约）、
   P1-03（证书有效期用本地时间）、P1-04（`/health` 不在契约）。其中 P1-03 涉及 AC-15 语义，最高优先。
3. **AC-04/05/06/07/08/10 共 6 条无法测** —— 需真实 PACS（DICOM 数据集）、GPU 节点、CA/TSA/密码机、
   浏览器与显卡。本机不具备条件，**必须安排院内现场验收**，不能以本报告替代。
4. **未做压力/容量测试** —— 时序实验的 6 万检查量级不是生产量级，未测 p95、并发与长稳。
5. **未做前端端到端测试** —— 无浏览器自动化环境；AC-21 / AC-22 为代码级判定，非实测。

---

## 9. 附：可复现命令

```bash
# 0) 一键重建 QA 环境（PG18 + 迁移 + 三种场景 + 6 万检查规模数据）
bash scripts/qa_pg_setup.sh

# 1) 越权时序：10 轮 × 1000 采样，输出 p99/p50/重叠度汇总
export DATABASE_URL="postgresql://postgres:medplan_ci_only@127.0.0.1:15533/medplan_qa"
bash scripts/qa_timing_trials.sh 10 1000

# 2) 时序差异的确定性归因（EXPLAIN ANALYZE + BUFFERS）
MSYS_NO_PATHCONV=1 docker cp scripts/qa_explain_scope.sql qa-pg-medplan:/tmp/explain.sql
MSYS_NO_PATHCONV=1 docker exec qa-pg-medplan psql -U postgres -d medplan_qa -f /tmp/explain.sql

# 3) 端到端 HTTP：起真实 API，打真实端点，比对 Content-Length 与响应体字节
export QA_PG_HOST=127.0.0.1:15533 QA_PG_PASS=medplan_ci_only
node scripts/qa_e2e_probe.mjs

# 4) 会话令牌闭环
node scripts/qa_session_token_probe.mjs

# 5) 回归集
npm run build:test -w @medplan/api
node --test apps/api/.test-build/__tests__/qa-phase4-regression.test.js
```

> **注**：`scripts/verify_db_local.sh` 会删除所有 `medplan-pg*` 容器（P2-03），
> QA 环境请用 `scripts/qa_pg_setup.sh`（容器名 `qa-pg-medplan`，端口 15533）。
