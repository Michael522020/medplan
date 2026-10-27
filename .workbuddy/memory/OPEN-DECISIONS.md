# OPEN-DECISIONS 悬而未决登记册

> 铁律：只追加 + 就地关闭（OPEN → RESOLVED，补 Resolution 字段）。每个 Phase 开始时把未决项复现到工作上下文最前面。

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-10-22 | Phase 0 | 部署形态是单院私有化还是多院租户化 | 用户仅说"企业级"，未明确单院/多院 | 倾向单院私有化，多院用 org_id 预留隔离 | 用户确认 | 用户确认部署规模后 | RESOLVED |
| 2026-10-22 | Phase 0 | 目标硬件基线（GPU 型号/显存/工作站配置） | TotalSegmentator 推理需 NVIDIA GPU，8G 与 24G 差异极大 | 倾向 24G 显存（RTX 4090/A10 级别）作为基线 | 用户确认院方预算 | 用户提供院方硬件清单后 | OPEN |
| 2026-10-22 | Phase 0 | 医学影像 AI 是否触及三类医疗器械注册 | AI 辅助分割若输出诊断结论需三类证 | 严格限定"只做分割标记+量化指标，诊断结论必须医师确认" | 需法务/院方确认 | 用户确认业务边界声明后 | OPEN |
| 2026-10-22 | Phase 0 | 电子签名采用哪类 CA 与算法 | 国密 SM2 强制要求 vs 通用 RSA | 倾向 SM2 + TSA 时间戳 + 硬件 Key | 用户确认院方已有 CA 情况 | 用户告知现有 CA 供应商后 | OPEN |
| 2026-10-22 | Phase 0 | 是否需要对接院内现有 HIS/EMR/PACS | 用户未提及现有系统情况 | MVP 先做标准 DICOMweb + HL7 v2 接入，预留 FHIR | 用户确认院方现状 | 用户告知现有 HIS/PACS 厂商后 | OPEN |
| 2026-10-22 | Phase 1 | 患者数据是否允许跨院区调阅 | 涉及数据不出院与互联互通四级甲等 | 倾向院内闭环，跨院需走监管审批 | 用户确认 | 用户确认后 | RESOLVED |
| 2026-10-22 | Phase 1 (PM) | Q1 互联互通目标等级：四甲 or 仅过三级等保 | 四甲要求信息集成平台与数据中心过三级等保、须有软著、运行一年以上过初验、数据测评占 40% | 倾向按四甲设计数据集与共享文档标准化 | 用户确认 | 用户确认目标等级后 | OPEN |
| 2026-10-22 | Phase 1 (架构师) | Q3 AI 分割部署：院内 GPU 还是仅 CPU | **已量化**：GPU 显存 ≥12GB（RTX 3090/A10 级），TotalSegmentator 显存 8-12GB 且需独占调度。纯 CPU 下 AI-01 的 10 分钟时限不成立 | 倾向院内本地 GPU 服务器。若仅 CPU，AI-01 降级为 P1 | 用户确认院方硬件 | 用户提供硬件清单后 | OPEN |
| 2026-10-22 | Phase 1 (PM) | Q2 电子签名 CA 来源：院内统一 CA vs 第三方 CA | 影响 COM-01 实现方式与采购周期 | 倾向院内统一 CA，预留第三方适配层 | 用户确认院方现有 CA | 用户确认后 | OPEN |
| 2026-10-22 | Phase 1 (PM) | Q4 报告模板：行业标准 vs 医院自定义 | 完全自定义则字段映射增，标准化测评可能不通过 | 行业标准模板为基线，科室在标准字段内调整 | 用户确认 | 用户确认后 | RESOLVED |
| 2026-10-22 | Phase 1 (PM) | Q7 手术规划结果是否作为正式病历组成部分归档 | 影响 Plan 实体的归档与留存策略 | 倾向作为正式病历组成部分（留存≥30年） | 用户/医务部门确认 | 用户确认后 | RESOLVED |
| 2026-10-27 | Phase 3 | 架构方案缺部署编排章节（第 3 章只有分层，无 Dockerfile / K8s manifest / 备份与回滚策略） | 部署是 Phase 4 运维的产出；无章节则运维无依据 | 架构方案第 3 章已给出 5 层架构与组件清单（L1 接入 → L5 基础设施，含院内 K8s / Loki+Prometheus / MinIO / 密码机 / TSA / 北斗授时），运维据此产出编排即可 | 无 —— 依据已足够 | 运维产出部署编排后关闭 | OPEN |
| 2026-10-27 | Phase 3 | Redis Stream 投递通道未实现（分割任务落库后 status='queued'，GPU Worker 拉取逻辑缺） | 契约要求任务经 Redis Stream 投递；架构方案 §6.3「至少一次投递」要求 Worker 领取时校验 status 已是 running 则跳过 | 依赖清单无 redis 客户端且当时禁止 npm install。**现在允许安装依赖**，建议补 ioredis 实现投递与 Worker 领取 | AI 模块负责人未确认 Worker 归属 | AI 模块负责人确认后由后端补齐 | OPEN |
| 2026-10-27 | Phase 3 | 会话令牌由 MedPlan 自签（HS256）而非 Keycloak 签发 | 契约 §3 写「由 Keycloak OIDC 签发」，但 Keycloak direct grant 无法携带「本次登录刚校验通过的 UKey 序列号」（需在 Keycloak 侧配自定义 protocol mapper） | 口令仍由 Keycloak 校验（不存口令，符合 schema.sql），会话令牌载荷与契约描述逐字段对齐（sub/dept/roles/ukey_cert_serial/jti/iat/exp）。**UKey 序列号必须由服务端在校验通过后写入会话，不能由客户端传** | 需院方 Keycloak 管理员配合配 mapper | 院方确认能否配 mapper 后关闭 | OPEN |
| 2026-10-27 | Phase 3 | segmentation_confirms 的 append-only 语义与「以最后一次为准」并存 | 契约要求 append-only（每次变更追加新记录），若用 UNIQUE(task_id, structure_name) 则追加语义失效 | **已裁决：契约对，DDL 改**。移除该唯一约束，改用 UNIQUE(idempotency_key) 去重 + v_segmentation_confirm_current 视图用 DISTINCT ON 取最新。已加 4 条 lint 断言守护 | 无 —— 已关闭 | 已关闭 | RESOLVED |

## 已关闭

| 日期 | Open Item | 结论 | Resolution |
|------|-----------|------|-----------|
| 2026-10-22 | 互联互通测评方案版本号 | **不存在「2021版」**，现行版本为 **2020年版**，国卫统信便函〔2020〕30号，2020-07-30 印发、自 2021 年起施行 | PM 联网核实并已在 PRD 中按 2020 年版锁定。常见误记为「2021版」系因其自 2021 年施行 |