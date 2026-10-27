# Spec — MedPlan v1.0（规格即契约）

> 生成日期：2026-10-22
> 基于：PRD v1.0 + 架构方案 v1.0（1283 行）+ UIUX v1.0 + ADR-001..007
> 状态：**已锁定**（经三方交叉一致性校验 + 项目总监裁决）
> 锁定者：大湾区靓仔（项目总监）

---

## 0. 本次裁决记录（为何 Spec 与初始输入不同）

| 裁决点 | 初始倾向 | 最终锁定 | 依据 |
|--------|---------|---------|------|
| PACS | Orthanc（用户选型文件） | **dcm4chee-arc-light 5.35.2** | Orthanc 是 GPLv3，商业闭源有传染风险；dcm4chee 是 MPL-2.0 |
| 前端 | OHIF（用户选型文件） | **自研 Cornerstone3D 5.13.1 封装** | OHIF 3.13.13 把 Cornerstone 锁死 5.6.8，落后上游 7 个 minor |
| 图标库 | 架构师写 lucide / 设计师写 Tabler（冲突） | **@tabler/icons-react 3.49.0** | 唯一同时具备 outline + filled 同名双构件；纯 outline 库做不出工具栏两态配对 |
| 协作同步 | 倾向 CRDT（业界默认） | **中心广播 + 操作日志，不用 CRDT/OT** | CRDT 静默合并会产生临床错误且不可审计 |
| 双因素 | PM 写口令+短信验证码 | **口令 + UKey 数字证书** | 短信验证码不满足等保 8.1.4.1「至少一种使用密码技术」 |
| 排期 | 用户选型文件称 2-3 周 | **17 人月 / 3-4 人团队 5-7 个月** | 原估算未含等保、CA 签名、审计、PACS 对接 |

---

## 1. 产品定义

- **一句话描述**：院内私有化部署的影像科阅片与手术规划平台，把「DICOM 调阅 → 多平面阅片 → AI 辅助分割 → 三维入路规划 → 结构化报告 → 医师电子签名」做成一条闭环。
- **目标用户**：影像科住院医师 / 主任医师 / 手术科室医师 / 质控科 / 院方信息科
- **核心问题**：开源栈能看片但过不了评审；商业产品闭源无法按等保条款二开。**技术不是壁垒，合规才是。**

---

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | ID | 功能 | 验收标准摘要 | RICE |
|--------|----|------|-------------|------|
| P0 | AI-03 | AI 辅助标记（强制逐项医师确认） | 未全部确认则报告不可提交 | 24.0 |
| P0 | MEAS-01 | 测量工具（长/角/面积/体积） | 测量值可保存、可追溯、可进报告 | 20.0 |
| P0 | VIEW-02 | 窗宽窗位 + MIP/MinIP/VR 重建 | MPR/MIP 切换 ≤1s，VR 首帧 ≤5s | 15.0 |
| P0 | RPT-01 | 结构化报告模板（受控字段） | 5 类受控字段，字段缺失阻断签名 | 15.0 |
| P0 | AUD-01 | 审计日志（覆盖全部 PHI 操作） | 每次 PHI 访问有审计，append-only + hash chain | 15.0 |
| P0 | AI-01 | AI 分割任务提交（分期相校验） | 提交后 ≤10 分钟出 mask | 10.5 |
| P0 | DCM-01 | DICOM 调阅 | C-FIND/C-MOVE/C-GET 或 DICOMweb 可调阅 | 10.0 |
| P0 | VIEW-01 | 三平面 MPR 阅片同步 | 三视图联动 200ms 内响应 | 10.0 |
| P0 | COM-01 | 医师电子签名 | SM2 + CA + TSA，正文摘要绑定，改一字符即失效 | 10.0 |
| P0 | COM-03 | 患者数据访问控制 | 越权拒绝不泄露患者存在性 | 10.0 |
| P0 | DCM-02 | 序列期相自动分组 | 平扫/动脉/门脉/延迟自动归类 | 7.2 |
| P0 | VIEW-03 | 大文件加载 | 2000 层 CT 首帧 ≤3s，全量 ≤15s | 6.4 |
| P0 | AI-02 | 分割结果三维重建 | STL/NIfTI 可加载、可旋转测量 | 4.0（保留 P0，AI-01 的必要下游） |
| P1 | PLAN-01 | 入路规划标注（预留） | v1.0 仅 version 乐观锁 + 操作日志 | — |
| P1 | RPT-03 | 报告回写 PACS/HL7（预留） | 走 SR 或 ORM | — |

**关于 AI-02 的说明**：RICE 仅 4.0，但它是 AI-01 的必要下游，保留 P0 定级。RICE 不是排序的唯一依据。

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|---------|
| AI 自动生成诊断结论 | 触及辅助决策类需三类证，法规禁止（N2） | 不考虑 |
| AI 病灶性质判定 / 治疗建议 | 医疗安全底线（N2） | 不考虑 |
| 三维模型多人实时协作标注 | 语义冲突无法算法裁决（N1） | v2.0 中心广播 + 人工裁决 |
| 浏览器内 PACS 级影像归档 | 需 WORM 与长期可靠性，浏览器无法满足（N3） | 不考虑 |
| 完全自研 DICOM 编解码 | dcmjs 已成熟，自研无收益（N4） | 不考虑 |
| HIS 医嘱 / 开单集成 | 需 HIS 厂商配合，非单方可控（N5） | 院方协调后 |
| 云端 GPU 加速 | 数据不得出院，合规禁止（N6） | 不考虑 |
| 医保结算接口 | 不在本系统边界 | 不考虑 |
| 手术导航硬件接入 | 属 SlicerIGT / 导航设备范畴 | v2.0+ |

---

## 4. 技术架构（锁定 — 含版本锚定）

> 所有版本号经官方 registry / releases API 核实，无编造。

| 层 | 技术 | 实际版本 | 锁定原因 |
|----|------|---------|---------|
| 前端框架 | React | 19.3.1 | 生态与 Cornerstone 适配成熟 |
| 渲染引擎 | @cornerstonejs/core + tools + dicom-image-loader | **5.13.1（三包严格同版本）** | 不 fork OHIF，避开 peer 锁死 |
| DICOM 解析 | dcmjs | 0.52.2 | 经 OHIF 生产验证 |
| DICOMweb 客户端 | dicomweb-client | 0.10.4 | 标准协议实现 |
| 流式加载 | streaming-image-volume-loader | 1.86.1 | 大体积按需加载 |
| 前端语言 | TypeScript | 5.9.3 | 类型由 openapi.yaml 生成 |
| 构建 | Vite | 最新稳定 | — |
| **图标库** | **@tabler/icons-react** | **3.49.0（MIT）** | **全项目唯一，禁止 emoji，禁止第二套库** |
| 后端运行时 | Node.js | 24.22.1 LTS | — |
| 后端框架 | NestJS + Fastify | 12.2.0 / 5.12.7 | 分层清晰，Fastify 性能优于 Express |
| 业务库 | PostgreSQL | **18**（EOL 2030-11-14） | 表级 GRANT/REVOKE 实现审计表物理不可改；jsonb 存未定型规划方案 |
| 缓存/队列 | Redis Stream | 8.10.2 | 零额外中间件 |
| AI 引擎 | TotalSegmentator | 2.18.0 | 100+ 结构 |
| AI 框架 | nnunetv2 / PyTorch / MONAI | 2.8.1 / 2.5.x / 1.6.1 | 上游锁 >=2.0.0,<2.6 |
| AI 语言 | Python | 3.11 | — |
| PACS | dcm4chee-arc-light | 5.35.2 | MPL-2.0 可闭源；内置 HL7 v2 |
| 认证 | Keycloak | 26.8.1 | OIDC 解耦，可复用院方既有 |
| 电子签名 | SM2 + 密码机 + TSA | — | 国密，密评硬要求 |
| 部署 | 私有化 Kubernetes | — | 等保三级 + 密评 |

---

## 5. API 端点清单（锁定）

> 完整契约以 `openapi.yaml`（OpenAPI 3.0，开发前由架构师产出）为唯一依据，前端据此生成 TS 类型。

| Method | Path | 功能 | 认证 | 幂等 |
|--------|------|------|------|------|
| POST | /api/v1/auth/login | 双因素登录（口令+UKey） | 是 | 否 |
| GET | /api/v1/studies | 检查列表（按权限过滤） | 是 | 否 |
| GET | /api/v1/studies/{studyUid}/series | 序列列表（按期相分组） | 是 | 否 |
| POST | /api/v1/wado/instances | WADO-RS 取图 | 是 | 否 |
| POST | /api/v1/segmentation-tasks | 提交 AI 分割 | 是 | **是** |
| GET | /api/v1/segmentation-tasks/{taskId} | 查询任务状态 | 是 | 否 |
| POST | /api/v1/segmentation-tasks/{taskId}/confirm | 医师逐项确认 | 是 | 是 |
| POST | /api/v1/plans | 保存规划方案 | 是 | 是 |
| PUT | /api/v1/plans/{planId} | 更新（带 version，冲突返 409） | 是 | 是 |
| GET | /api/v1/reports/{reportId} | 获取报告 | 是 | 否 |
| POST | /api/v1/reports/{reportId}/sign | 电子签名 | 是 | **是** |
| GET | /api/v1/audit-logs | 审计查询 | 是（管理员） | 否 |

**全局错误码（锁定）**：

| 码 | 含义 | 关键约束 |
|----|------|---------|
| 10001 | 参数错误 | — |
| 10002 | 未认证 | — |
| 10003 | 无权限（角色级） | — |
| **10004** | **越权（数据级）** | **响应时间/状态码/体大小须与「患者不存在」不可区分（防时序侧信道）** |
| 10005 | 资源不存在 | 与 10004 不可区分 |
| **40003** | **模型许可不在白名单** | **启动强校验，非白名单拒绝并审计** |

---

## 6. 数据库表清单（锁定）

| 表名 | 核心字段 | 索引 | 关联 |
|------|---------|------|------|
| patients | patient_id(EMPI), name, gender, birth_date, id_card_hash | patient_id 唯一 | 主索引 |
| visits | visit_id, patient_id, visit_type, admit_date, dept | patient_id | →patients |
| studies | study_uid, visit_id, modality, study_date, description | visit_id | →visits |
| series | series_uid, study_uid, phase(平扫/动脉/门脉/延迟), num_instances | study_uid | →studies |
| instances | sop_uid, series_uid, instance_number | series_uid | →series |
| segmentation_tasks | task_id, study_uid, model, weights_ver, fast_flag, status | study_uid | →studies |
| segmentation_confirms | task_id, item, confirmed_by, confirmed_at | task_id | →tasks |
| plans | plan_id, study_uid, version, payload(jsonb) | study_uid | →studies |
| plan_commands | plan_id, cmd, actor, ts | plan_id | →plans（操作日志） |
| reports | report_id, study_uid, findings, impression, author, reviewer, signed_at, signature_digest | study_uid | →studies |
| signature_logs | 流水号, 原文唯一序列号, 服务主体标识, 原文摘要值, 摘要算法, 证书序列号, 签名数据 | 独立存储 | WS/T 847—2024 要求 |
| audit_logs | actor, action, resource, result, ts, hash_prev, hash_self | actor, ts | append-only + hash chain |
| users / roles / user_roles | - | - | RBAC |
| patient_grants | patient_id, user_id, scope | 复合 | L3 数据权限 |

**卫健委电子病历必备字段覆盖**：患者基本信息 / 就诊信息 / 检查所见 / 诊断意见 / 报告医师 / 审核医师 / 报告时间 / 修改痕迹 —— 全部落位，见架构方案 §7.3 覆盖检查表。

---

## 7. 页面清单（锁定）

| 页面 | 路由 | 核心组件 | 对应 API | Token 主题 |
|------|------|---------|---------|-----------|
| 登录 | /login | 双因素登录表单 | /auth/login | 双主题 |
| 工作台 | /worklist | 检查列表、患者摘要、快捷入口 | /studies | 双主题 |
| 阅片工作台 | /viewer/:studyUid | 三/四视口、工具栏、序列导航、测量面板 | /wado/* | **Canvas 恒暗** |
| AI 分割任务 | /viewer/:studyUid/segmentation | 任务提交、进度、确认清单 | /segmentation-tasks | 双主题 |
| 三维规划 | /viewer/:studyUid/plan | 3D 视口、入路标注、测量 | /plans | **Canvas 恒暗** |
| 报告编辑与签名 | /reports/:reportId | 结构化模板、UKey 签名、锁定态 | /reports/* | 双主题 |
| 审计查询 | /admin/audit | 审计检索、追溯回放 | /audit-logs | 双主题 |

---

## 8. 设计 Token（锁定）

> 数据源 `docs/design-tokens.json`，CSS 由 `scripts/build_tokens.py` 生成，**禁止手改 CSS**。

- **主色**：`accent-clinical` light `#1E3A5F` / dark `#63A6DC`（藏青，非紫非粉；亮色 11.5:1 AAA，暗色 6.56:1 AA）
- **危急值**：`status-critical` light `#C81E1E` / dark `#FF6B6B`，**必须颜色 + tabler:alert-triangle + 「危急值」文字三重编码**
- **字体**：Inter + Noto Sans SC；临床数值用 JetBrains Mono + tabular-nums
- **图标库**：@tabler/icons-react 3.49.0（唯一）
- **主题**：亮色 / 暗色双主题，**默认暗色**（AAPM TG-18：诊断阅片站环境照度 2–10 lx）

### 三条前端不得「修正」的硬约束

1. **亮色主题下 `--color-surface-canvas` 仍为 `#1A1A1A`**。灰阶影像在白底上丧失诊断对比，这是专业硬约束。**不要"修正"成白色。**
2. **Canvas 上的角标文字用 `--color-text-on-canvas`**（双主题恒为浅色），**不得用 `--color-text-primary`**（亮色主题下会变深色不可见）。
3. **颜色零硬编码**，全部 `var(--color-*)`，组件内禁止字面量色值。建议 stylelint 做 CI 门禁。

---

## 9. 验收标准（锁定 — EARS 格式）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|------|------|--------------|--------|
| AC-01 | 登录 | While 用户持有效 UKey 与口令，系统**必须**完成双因素认证并签发会话 | P0 |
| AC-02 | 登录 | If 用户未提供 UKey 数字证书，系统**必须**拒绝登录（短信验证码不可替代） | P0 |
| AC-03 | DICOM 调阅 | When 医生打开有效 studyUid，系统**必须**加载全部序列并按期相分组 | P0 |
| AC-04 | 阅片 | While 医生拖动窗宽窗位，系统**必须**在 100ms 内更新视口且不丢失 HU 值精度 | P0 |
| AC-05 | 阅片 | When 系统加载 2000 层 0.5mm 薄层 CT，系统**必须**首帧 ≤3s、全量 ≤15s | P0 |
| AC-06 | 阅片 | If WebGL 不可用，系统**必须**降级到 2D 模式并隐藏三维入口 | P0 |
| AC-07 | 测量 | When 医生用长度工具测量两点，系统**必须**显示毫米级数值且可保存 | P0 |
| AC-08 | AI 分割 | When 医生提交分割任务，系统**必须**在 10 分钟内返回 mask（GPU 充足前提下） | P0 |
| AC-09 | AI 分割 | If 请求的模型 task 不在 Apache-2.0 白名单，系统**必须**拒绝（40003）并写审计 | P0 |
| AC-10 | AI 分割 | If GPU 显存不足，系统**必须**强制 `--fast` 并在报告中标注降级 | P0 |
| AC-11 | AI 确认 | When 医生未完成全部 AI 标记确认，系统**必须**阻断报告提交 | P0 |
| AC-12 | 报告 | If 5 类受控字段有缺失，系统**必须**阻断签名 | P0 |
| AC-13 | 签名 | When 医师签名，系统**必须**绑定正文 SHA-256 摘要并锁定报告 | P0 |
| AC-14 | 签名 | If 签名后正文发生任何变更，系统**必须**使原签名立即失效 | P0 |
| AC-15 | 签名 | If NTP 时间偏移超阈值，系统**必须**拒绝签名且**不得**用本地时间兜底 | P0 |
| AC-16 | 访问控制 | If 用户无该患者授权，系统**必须**返回 10004 且响应与「患者不存在」不可区分 | P0 |
| AC-17 | 访问控制 | While 用户连续访问 PHI，系统**必须**为每次操作写审计记录 | P0 |
| AC-18 | 审计 | If 审计记录被尝试修改或删除，系统**必须**拒绝（append-only + hash chain） | P0 |
| AC-19 | 审计 | While 系统运行，系统**必须**保留审计日志 ≥6 个月 | P0 |
| AC-20 | 留存 | While 归档，系统**必须**门急诊报告保留 ≥15 年、住院 ≥30 年 | P0 |
| AC-21 | 主题 | If 医生在暗色环境使用，系统**必须**默认加载暗色主题且 Canvas 区恒暗 | P1 |
| AC-22 | 无障碍 | While 医生使用危急值标识，系统**必须**同时提供颜色、图标与文字三重编码 | P0 |

---

## 10. 边界与约束

- 不支持 IE；Chrome / Edge 最近两个大版本
- 响应式：UI 尺寸恒定**绝不随分辨率放大**（医生已形成肌肉记忆），仅 Canvas 随屏扩大
- 性能：首帧 ≤3s / 全量 ≤15s / 联动 200ms / 30fps
- 可用性 99.9%（单机部署下受硬件约束）
- **强制** `preferSizeOverAccuracy: true`（Int16），组件不得自行关闭
- GPU 资源生命周期：工具 enable/disable 必须成对注册于 unmount，视口销毁必须显式 destroy()
- 后端分层：controllers → services → repositories，依赖只向下，SQL 只在 repositories，单文件 ≤300 行
- 前端分层：组件禁止直连 Cornerstone 全局 API，必须经 `features/viewer/core/` 封装层

---

## 11. 内嵌已知坑（来自项目记忆 + 架构调研）

| 坑 | 技术栈指纹 | 根因 | 修法 |
|----|------------|------|------|
| Volume 内存翻倍崩标签页 | cornerstonejs-5.13.1 | 未设 preferSizeOverAccuracy，Int32 存储 | **强制 true**，写死不可关 |
| GPU 资源泄漏 | cornerstonejs-5.13.1 | 工具 enable/disable 不成对注册于 unmount | 封装层统一管理生命周期 |
| OHIF 版本陷阱 | ohif | 3.13.13 peer 锁死 Cornerstone 5.6.8 | 不用 OHIF，自研封装 |
| MONAI Deploy 停滞 | monai-deploy | 最后提交 2025-03-26，18 个月无更新 | 自建 FastAPI 服务层 |
| Orthanc 许可传染 | orthanc | GPLv3，商业闭源有风险 | 改用 dcm4chee（MPL-2.0） |
| 模型权重许可陷阱 | totalsegmentator | 46 个 task 仅 31 个 Apache-2.0，`brain_aneurysm` 为 CC BY-NC 4.0 | 启动白名单强校验 |
| CRDT 沉默逻辑错误 | crdt/yjs | 静默合并产生临床错误且不可审计 | 不用 CRDT，改乐观锁 + 操作日志 |
| 短信验证码不合规 | - | 不满足等保 8.1.4.1「密码技术」 | 改口令 + UKey 数字证书 |
| 越权泄露患者存在性 | - | 返回 403 与 404 可区分 | 统一 10004 + 响应不可区分 + 恒定响应时间 |
| Canvas 被"修正"成白底 | design-tokens | 前端误认为亮色主题应改 canvas | 双约束写死，评审门禁检查 |
| **审计分区缺默认权限** | postgresql-18 | `ALTER DEFAULT PRIVILEGES` 只影响之后新建的对象，运行时建的月分区不继承授权 | 角色创建后显式声明默认权限（已加 lint 断言） |
| **GRANT/REVOKE 顺序颠倒** | postgresql-18 | 授权被随后的撤销抹掉 | 统一「先 REVOKE ALL 再 GRANT」，核对最终生效顺序 |
| **psql 连目标库建库** | bash/postgresql-18 | `CREATE DATABASE` 不能在连目标库时执行 | 改连维护库，DROP 前断开会话 |

---

## 12. 端到端验证步骤（锁定）

```bash
# 0. 前置：所有镜像已在院内私有 registry 就绪（离线交付要求）
# 1. 构建
npm ci && npm run build

# 2. 启动（等待 K8s 各 Pod Ready）
kubectl apply -f deploy/k8s/
kubectl get pods -w    # 等待 dcm4chee / backend / ai-worker / postgres / redis / keycloak 全部 Running

# 3. 核心成功流：双因素登录
curl -X POST https://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"dr.zhang","password":"<待填>","ukey_cert":"<待填>"}'
# 断言：200 + 会话 token + 审计日志新增一条 LOGIN 记录

# 4. 核心成功流：DICOM 调阅
curl -X GET https://localhost/api/v1/studies/1.2.840.10008.5.1.4.1.1.2.1/series \
  -H "Authorization: Bearer <token>"
# 断言：200 + 序列按 phase 分组（平扫/动脉/门脉/延迟）

# 5. 关键错误流：越权访问不泄露患者存在性
curl -X GET https://localhost/api/v1/studies/<不存在的studyUid>/series -H "Authorization: Bearer <token>"
curl -X GET https://localhost/api/v1/studies <无授权患者的studyUid> -H "Authorization: Bearer <token>"
# 断言：两者响应码相同、响应体大小相近、响应时间无显著差异（防时序侧信道）

# 6. 关键错误流：模型许可白名单
curl -X POST https://localhost/api/v1/segmentation-tasks \
  -H "Authorization: Bearer <token>" -H "Idempotency-Key: <uuid>" \
  -d '{"study_uid":"<待填>","model":"brain_aneurysm"}'
# 断言：400 + 错误码 40003 + 审计日志记录拒绝原因

# 7. 合规专项：签名后正文变更
# 8. 签署报告 → 9. 尝试修改报告正文 → 断言：签名失效
```

---

## 13. 工作量与排期（锁定）

| 部分 | 工作量 |
|------|--------|
| 前端 | 4.5 人月 |
| 后端 | 6.0 人月 |
| AI | 1.5 人月 |
| 集成与合规 | 3.0 人月 |
| 测试 | 2.0 人月 |
| **合计** | **约 17 人月** |

3-4 人团队日历时间 **5-7 个月**。**明确不承诺「2-3 周出可演示原型」**——该估算未含等保、CA 签名、审计、PACS 对接。

**采购关键路径**：CA / TSA / 国密密码机**建议提前 2 个月启动采购**，与 GPU 服务器采购并行。这是全项目周期最长且不由开发方控制的环节。

---

## 14. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|---------|------|---------|
| 2026-10-22 | 初始锁定 | 三方产出 + 交叉校验完成 | 全部 |
| 2026-10-23 | **AC-13 补充说明**：AC-13 原文写的 SHA-256 指**对账摘要**（`bodySha256`），用于前端展示与跨系统对账；**签名绑定与失效判定一律以 SM3（`bodyDigest`）为准** | SM2 内部固定使用 SM3，无法改为对 SHA-256 签名。原文写 SHA-256 是 Spec 缺陷，保留原文以便审计时看到决策过程 | AC-13 / AC-14 / COM-01 / openapi.yaml signature 相关 schema |
| 2026-10-23 | TotalSegmentator 版本号统一为 **2.18.0** | UIUX.md 与 UIUX-P2.md 原写 v2.3.1，与锁定值及 DB CHECK 约束冲突 | UIUX.md §、UIUX-P2.md § |
| 2026-10-25 | **补 `ALTER DEFAULT PRIVILEGES` 声明**：迁移与 schema 均新增 app_audit / app_rw / app_ro 的默认权限，且置于全部角色创建之后 | `audit_logs` 按月分区，`fn_precreate_audit_partition()` 运行时用 `CREATE TABLE ... PARTITION OF` 建分区。PostgreSQL 的 `ALTER DEFAULT PRIVILEGES` 只影响该语句之后新建的对象，运行时分区不继承此前授权 → 新建月分区缺 `app_audit` INSERT 权限 → **审计写入失败、审计事件丢失**（等保 8.1.4.3 不可接受） | `db/schema.sql`、`db/migrations/001_init.sql`、`scripts/lint_migrations.js`（新增 5 条断言守护） |
| 2026-10-25 | **修正 `app_audit` 授权顺序**：先 `REVOKE ALL` 再 `GRANT INSERT, SELECT` | schema.sql 原为 GRANT 在前 REVOKE ALL 在后，授权被随后的撤销抹掉，审计专用账号实际无法写入审计表。迁移文件顺序本就正确，两文件独立编写导致不一致 | `db/schema.sql` |
| 2026-10-25 | **补 `tsconfig.json` 与 CI 门禁工作流** | `verify-types.ts` 用无扩展名 import，项目无 tsconfig 时 tsc 走默认配置（moduleResolution 不含 bundler），前端接入后导入路径将解析失败；且 900 条断言此前无任何东西强制执行 | `tsconfig.json`、`.github/workflows/contract-guard.yml` |
| 2026-10-25 | **修正 `verify_db.sh` 建库逻辑**：新增 `psql_admin()` 连维护库执行 CREATE/DROP DATABASE，DROP 前断开会话 | `psql_q` 固定连 `-d $PG_DB`，而 CREATE DATABASE 不能在连接到目标库时执行，目标库不存在时第 0 步即失败，脚本从未被真正跑通过 | `scripts/verify_db.sh` |

### 变更流程

**小改**（不新增 API 端点 / 不新增数据库表 / 不影响超过 2 个页面 / 不改变核心用户流程）→ 更新本章 → 继续开发

**大改**（新增 API ≥2 个 / 新增数据库表 / 影响超过 2 个页面 / 改变核心流程如「登录→阅片→签名」链路）→ 回到 Phase 0 重新澄清 → 更新三文档 → 更新 Spec

---

## 15. 未决项（开发启动前需用户拍板）

| # | 问题 | 默认假设 | 不解决的后果 |
|---|------|---------|--------------|
| Q1 | 互联互通目标等级：四甲 or 仅过三级等保 | 按四甲设计数据集 | 四甲要求软著证书 + 运行一年以上过初验 + 数据测评占 40% |
| Q2 | 院方是否已有 CA/TSA/密码机 | 无，需新采购 | 采购周期 2 个月+，是全项目关键路径 |
| Q3 | 院内 GPU 现状（≥12GB 显存？） | 有 RTX 3090 级 | 无则 AI-01 的 10 分钟时限不成立，须降级为 P1 |
| Q4 | 院内 PACS 型号与 DICOMweb 支持能力 | 标准 DICOMweb | 若不支持需自建桥接层 |
| Q5 | 院内既有身份系统 | 无，新部署 Keycloak | 若有则可复用，省 0.5 人月 |
| Q6 | 报告模板用行业标准 or 医院自定义 | 行业标准 + 科室字段内调整 | 完全自定义则标准化测评可能不通过 |
| Q7 | 手术规划结果是否作为正式病历归档 | 是 | 影响 Plan 实体的留存策略 |