# AC ↔ 测试 ↔ 实现 追溯矩阵

**项目**：MedPlan v1.0 | **发现缺陷基线**：`6b60eb9` ｜ **复验基线**：`b86f6c8` | **产出**：QA（严过关），Phase 4 独立验证
**配套报告**：[`QA-REPORT.md`](./QA-REPORT.md)

图例
- **测试**列：`单测` = 既有单元测试（36 条）；`回归` = 本轮 QA 新增回归集；`实测` = 本轮 QA 真实环境实测；`代码` = 代码走查判定（未实测）
- **判定**：`通过` / `失败` / `部分` / `无法测`

---

## 一、22 条 EARS 验收标准

| AC | 验收标准（Spec §9） | 实现文件 | 测试 | 判定 | 缺陷 |
|---|---|---|---|---|---|
| **AC-01** | 持有效 UKey 与口令必须完成双因素认证并签发会话 | `modules/auth/auth.service.ts:162`<br>`common/auth/jwt-verifier.ts:246-276` | 实测：`scripts/qa_session_token_probe.mjs`<br>回归：令牌闭环 4 条 | **通过**（P0-01 已在 `2da8391` 修复并复验） | P0-01 |
| **AC-02** | 未提供 UKey 数字证书必须拒绝登录 | `modules/auth/ukey-verifier.service.ts`<br>`app.module.ts:171-184`（fail-closed） | 代码 | 通过 | — |
| **AC-03** | 打开有效 studyUid 必须加载全部序列并按期相分组 | `modules/studies/studies.service.ts:91-159`<br>`modules/studies/series.repository.ts` | 实测：`GET /studies/{uid}/series` 返回 `phaseGroups` | 通过 | — |
| **AC-04** | 拖动窗宽窗位必须 100ms 内更新视口且不丢 HU 精度 | `features/viewer/core/tools/window-level-tool.ts`<br>`core/capability.ts`（`preferSizeOverAccuracy`） | `verify-types.ts` 编译期负向断言 | **无法测** | 需浏览器 + GPU |
| **AC-05** | 2000 层薄层 CT 首帧 ≤3s、全量 ≤15s | `core/dicom-source.ts`<br>`core/instance-lifecycle.ts` | — | **无法测** | 需真实 DICOM 数据集 + GPU |
| **AC-06** | WebGL 不可用必须降级 2D 并隐藏三维入口 | `core/capability.ts` | 代码 | **无法测** | 需禁用 WebGL 的浏览器 |
| **AC-07** | 长度工具必须显示毫米级数值且可保存 | `core/tools/measurement-tools.ts` | 代码 | **无法测** | 需浏览器交互 |
| **AC-08** | 分割任务必须 10 分钟内返回 mask | `modules/segmentation/segmentation.service.ts`<br>`common/queue/` | — | **无法测** | 需 GPU 节点 + 权重 |
| **AC-09** | 非 Apache-2.0 白名单的 task 必须拒绝（40003）并写审计 | `modules/segmentation/model-license-whitelist.ts`<br>`segmentation.service.ts` | 单测：5 条<br>回归：白名单 4 条（含 46 task 全遍历 + 6 类绕过） | 通过 | — |
| **AC-10** | GPU 显存不足必须强制 `--fast` 并标注降级 | `modules/segmentation/segmentation.schema.ts:43`<br>`report-mapper.ts`（`ai_assist.degraded`） | 代码 | **无法测** | 需 GPU 显存压测 |
| **AC-11** | 未完成全部 AI 标记确认必须阻断报告提交 | `modules/segmentation/segmentation-confirm.service.ts:70-84`<br>`modules/reports/report-mapper.ts`（`findMissingControlledFields`） | 单测：受控字段 2 条 | 通过 | 业务层 `modificationNote` 校验**无测试覆盖**（见反作弊审查） |
| **AC-12** | 5 类受控字段缺失必须阻断签名 | `modules/reports/report-signing.service.ts:230-233` | 单测：2 条<br>回归：签名摘要组 | 通过 | — |
| **AC-13** | 签名必须绑定正文摘要并锁定报告 | `report-signing.service.ts:93-95, 158-169`<br>`common/crypto/digest.ts:38-48` | 单测：SM3 国标向量 + 摘要变化<br>回归：4 条 | 通过 | — |
| **AC-14** | 签名后正文任何变更必须使原签名立即失效 | `modules/reports/reports.service.ts:161-165`（`signatureValid` 重算摘要）<br>`report-signing.service.ts:93` | 单测：1 条<br>回归：4 条（含数组顺序敏感） | 通过 | — |
| **AC-15** | NTP 偏移超阈值必须拒绝签名且不得用本地时间兜底 | `common/time/authoritative-time.service.ts:93-124`（权威时间 + 阈值拒绝）<br>`modules/reports/signature.service.ts:132-137`（证书有效期） | 代码 | **部分** | **P1-03**（证书有效期用本地时间） |
| **AC-16** | 无授权必须返回 10004 且与「患者不存在」不可区分 | `studies.service.ts:98-104`<br>`common/errors/error-codes.ts:108-137`<br>`common/db/access-scope.repository.ts` | 实测：`qa_e2e_probe.mjs`（HTTP 字节级）+ `qa_timing_trials.sh`（10×1000 采样）+ `qa_explain_scope.sql`（EXPLAIN）<br>回归：不可区分组 4 条 | 通过（时序指标 ⚠️ 不可复现） | **P1-01**、P2-02、P2-04 |
| **AC-17** | 连续访问 PHI 必须每次写审计 | `common/audit/audit-hook.ts:123-208`（onRequest + onSend）<br>`common/audit/audit.service.ts` | 实测：23 组 DB 验证 [6] hash chain；代码走查覆盖成功/拒绝/失败三态 | 通过 | — |
| **AC-18** | 审计记录被修改或删除必须拒绝（append-only + hash chain） | `docs/db/migrations/001_init.sql:949+`<br>`fn_append_only_guard()` / `fn_audit_chain_guard()` | 实测：23 组 DB 验证 [6] —— 权限层 UPDATE/DELETE/TRUNCATE 被拒 + 触发器层 owner DELETE 被拒 + `fn_verify_audit_chain()` 返回 0 行 | 通过 | — |
| **AC-19** | 必须保留审计日志 ≥6 个月 | `retention_class` 枚举 `audit_6m`<br>`audit_logs` 月分区 + DEFAULT 兜底分区 | 实测：23 组 DB 验证 [7] | 通过 | — |
| **AC-20** | 门急诊报告保留 ≥15 年、住院 ≥30 年 | `retention_class` 枚举 `report_15y`/`report_30y`<br>`ck_reports_retention` | 实测：DB CHECK 约束生效 | 通过 | — |
| **AC-21** | 暗色环境必须默认加载暗色主题且 Canvas 区恒暗 | `apps/web/src/theme/theme.ts:23,26`<br>`docs/design-tokens.json` | 代码（`DEFAULT_THEME='dark'` + 首屏前注入）<br>静态断言：design token lint | 通过（代码级） | 未实测（需浏览器） |
| **AC-22** | 危急值必须同时提供颜色、图标与文字三重编码 | `apps/web/src/components/ui/status-badge.tsx:47-116` | 代码（`TONE_ICON` + `status-badge__text` + token 色，图标/文字为必填）<br>静态断言：`lint_icons.js` | 通过（代码级） | 未实测（需浏览器 + 辅助技术） |

---

## 二、缺陷 ↔ 测试 ↔ 回归用例

| 缺陷 | 根因文件:行（基线 `6b60eb9`） | 现有测试为何抓不到 | 本轮回归用例 | 状态 |
|---|---|---|---|---|
| **P0-01** 会话令牌双重 base64 | `common/auth/jwt-verifier.ts:273` | 36 条单测**零条**覆盖 `signSessionToken`/`verifyJwt`（`grep` 确认） | `qa-phase4-regression.test.ts` → 「回归 P0-01」4 条 | ✅ 已修复（`2da8391`），回归转绿 |
| **P0-02** search_path 被静默忽略 | `common/db/pool.ts:49,61` | 单测不连库；DB 验证用 `PGOPTIONS` 外部设置，**绕过了应用连接串** | 端到端实测 `qa_e2e_probe.mjs` 场景一 | ✅ 已修复（`2da8391`），实测转绿 |
| **P0-03** `v_patients_masked.deleted_at` | `modules/studies/studies.repository.ts:224` | 单测不连库；DB 验证验的是 schema 而非应用 SQL | 回归 → 「回归 P0-02」2 条 | ✅ 已修复（`2da8391`），回归转绿 |
| **P0-04** JOIN 拼在 WHERE 之后 | `modules/studies/studies.repository.ts:125,171-172` | 单测不连库；DB 验证不跑应用 SQL；lint 看不出 SQL 语法 | 回归 → 「回归 P0-04」1 条 | ✅ 已修复（`b86f6c8`），回归转绿 |
| **P0-05** page/limit 未转数字 | `modules/studies/studies.controller.ts:32`<br>`modules/audit-logs/audit-logs.controller.ts:29` | 单测不构造 HTTP 请求；DB 验证不跑应用 | 回归 → 「回归 P0-05」3 条 | ✅ 已修复（`b86f6c8`），回归转绿 |
| **P1-01** 越权时序结构性差异 | `modules/studies/studies.service.ts:86-89`（注释失实） | 无任何时序测试（`security-constraints.test.ts` 文件头自述「需要集成测试，已标注为待补」） | `qa_timing_probe.mjs` + `qa_explain_scope.sql` | 待修 |
| **P1-02** 审计失败响应体不符契约 | `common/audit/audit-hook.ts:199-203` | 无 HTTP 层错误封装测试 | `qa_e2e_probe.mjs` 实测捕获 | 待修 |
| **P1-03** 证书有效期用本地时间 | `modules/reports/signature.service.ts:134` | 单测无证书有效期断言 | — | 待修 |
| **P1-04** `/health` 不在契约 | `apps/api/src/health/health.controller.ts:9-11` | 契约 lint 不比对运行时路由 | 端到端实测捕获 | 待修 |
| **P2-01** reports DELETE 触发器缺 WHEN | `docs/db/migrations/001_init.sql:868-870` | DB 验证 [5] 只验 signature_logs，不验 reports 的 draft 可删性 | — | 待修 |
| **P2-02** 错误码注释夸大 | `common/errors/error-codes.ts:119-129` | 既有单测标题「响应体字节数相同」与断言内容不符（弱断言） | 回归 → 「10004 与 10005 的 HTTP 响应体不可区分」3 条 | 待修 |
| **P2-03** `verify_db_local.sh` 删他人容器 | `scripts/verify_db_local.sh:46-51` | — | — | 待修 |
| **P2-04** C-3 指标缺测量条件 | `docs/架构方案.md` §12.3 | — | `qa_timing_trials.sh` 多轮聚合 | 待修 |

---

## 三、契约对照（openapi.yaml ↔ 实现）

| 契约端点 | 实现 | 路由实测（启动日志） | 判定 |
|---|---|---|---|
| `POST /api/v1/auth/login` | `modules/auth/auth.controller.ts:25` | `Mapped {/api/v1/auth/login, POST}` | ✅ |
| `GET /api/v1/studies` | `modules/studies/studies.controller.ts:25` | `Mapped {/api/v1/studies, GET}` | ✅ **复验通过：200**（P0-04/P0-05 已修） |
| `GET /api/v1/studies/{studyUid}/series` | `studies.controller.ts:43` | `Mapped {/api/v1/studies/:studyUid/series, GET}` | ✅ 实测 200/404/10004 |
| `POST /api/v1/wado/instances` | `modules/wado/wado.controller.ts:40` | `Mapped {/api/v1/wado/instances, POST}` | ✅ |
| `POST /api/v1/segmentation-tasks` | `modules/segmentation/segmentation.controller.ts:38` | `Mapped {/api/v1/segmentation-tasks, POST}` | ✅ |
| `GET /api/v1/segmentation-tasks/{taskId}` | `segmentation.controller.ts:53` | `Mapped {/api/v1/segmentation-tasks/:taskId, GET}` | ✅ |
| `POST /api/v1/segmentation-tasks/{taskId}/confirm` | `segmentation.controller.ts:69` | `Mapped {/api/v1/segmentation-tasks/:taskId/confirm, POST}` | ✅ |
| `POST /api/v1/plans` | `modules/plans/plans.controller.ts:29` | `Mapped {/api/v1/plans, POST}` | ✅ |
| `PUT /api/v1/plans/{planId}` | `plans.controller.ts:47` | `Mapped {/api/v1/plans/:planId, PUT}` | ✅ |
| `GET /api/v1/reports/{reportId}` | `modules/reports/reports.controller.ts:23` | `Mapped {/api/v1/reports/:reportId, GET}` | ✅ |
| `POST /api/v1/reports/{reportId}/sign` | `reports.controller.ts:37` | `Mapped {/api/v1/reports/:reportId/sign, POST}` | ✅ |
| `GET /api/v1/audit-logs` | `modules/audit-logs/audit-logs.controller.ts:24` | `Mapped {/api/v1/audit-logs, GET}` | ✅ **复验通过：200**（P0-05 已修） |
| （契约外） | `apps/api/src/health/health.controller.ts:11` | `Mapped {/api/v1/health, GET}` | ⚠️ P1-04 |

**端点一致性：12/12 实现，0 缺失；1 个契约外（`/health`）。**

### 错误码对照

| 段位 | 契约 | 实现 | 判定 |
|---|---|---|---|
| 10xxx 认证授权 | 10001 / 10002 / 10003 / 10004 / 10005 | 全部 5 个 | ✅ |
| 20xxx 校验 | 20001 / 20002 / 20003 | 全部 3 个 | ✅ |
| 30xxx PACS | 30001 / 30002 / 30003 | 全部 3 个 | ✅ |
| 40xxx AI | 40001 / 40002 / 40003 / 40004 | 全部 4 个 | ✅ |
| 50xxx 报告签名 | 50001 / 50002 / 50003 / 50004 | 全部 4 个 | ✅ |
| 90xxx 系统 | 90001 | 90001 | ✅ |

**错误码一致性：20/20，代码侧 0 个契约外错误码。**
`10004` 与 `10005` 的 HTTP 状态码均为 404（`error-codes.ts:77-78`）—— 传输层一致 ✅。

### 卫健委电子病历必备字段（架构方案 §7.3）

| 必备字段 | 落位 | 实测 |
|---|---|---|
| 患者基本信息 / 就诊信息 / 检查所见 / 诊断意见 / 报告医师 / 审核医师 / 报告时间 / 修改痕迹 等 | `patients` / `visits` / `reports.findings` / `reports.impression` / `reports.report_doctor_id` / `reports.review_doctor_id` / `reports.report_time` / `report_revisions` | ✅ **15/15 覆盖**（23 组 DB 验证 [8]） |

---

## 四、测试资产清单（本轮产出）

| 文件 | 用途 | 可否被实现作者改动 |
|---|---|---|
| `apps/api/src/__tests__/qa-phase4-regression.test.ts` | 29 条回归断言，覆盖 5 个 P0 与四条安全约束的对抗路径 | **否** —— 应作为不可绕过的判定闸 |
| `scripts/qa_pg_setup.sh` | 一键重建 QA 专用 PG18 环境（迁移 + 种子 + 6 万规模数据） | 否（QA 工具） |
| `scripts/qa_seed_timing.sql` | 构造「有权限 / 越权 / 不存在」三场景 | 否（QA 工具） |
| `scripts/qa_seed_bulk.sql` | 规模化数据（验证时序差异是否随数据量放大） | 否（QA 工具） |
| `scripts/qa_timing_probe.mjs` | 越权时序采样（import 生产代码，不复制 SQL） | 否（QA 工具） |
| `scripts/qa_timing_trials.sh` | 多轮独立试验 + 聚合，评估指标**可复现性** | 否（QA 工具） |
| `scripts/qa_explain_scope.sql` | 作用域查询的确定性执行计划对比（EXPLAIN ANALYZE + BUFFERS） | 否（QA 工具） |
| `scripts/qa_e2e_probe.mjs` | 起真实 API、打真实端点、比对 Content-Length 与响应体字节 | 否（QA 工具） |
| `scripts/qa_session_token_probe.mjs` | 会话令牌签发→验签闭环（用生产函数） | 否（QA 工具） |

> **建议**：把 `scripts/qa_e2e_probe.mjs` 的断言接入 CI 作为 **smoke 门禁**。
> 本轮 5 个 P0 全部会被这道门禁挡住 —— 现有 36 条单测与 23 组 DB 验证一个都抓不到。
