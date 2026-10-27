## 这次改了什么

<!-- 一句话说清。 -->

## 为什么改

<!-- 关联的 issue / 验收标准编号（AC-xx）。 -->

---

## ⛔ 提交前自检

**全部勾选后才能请求评审。** CI 会重复跑同样的检查，但本地先过一遍更快。

### 硬约束（违反即退回）

- [ ] **未引入 emoji 作为功能图标** —— 只用 `@tabler/icons-react`，出口在 `apps/web/src/components/icons/index.ts`
- [ ] **未引入第二套图标库**
- [ ] **未硬编码颜色值** —— 全部 `var(--color-*)`（唯一例外 `#fff` / `#000`）
- [ ] **未使用紫粉渐变**（`#7C3AED → #A855F7 → #EC4899` 及其变体）
- [ ] **未引入空洞占位文案**（"Lorem ipsum" / "Welcome to" / "Sign up today"）
- [ ] **界面文案全中文**（标识符可用英文）

### 架构约束

- [ ] **单文件 ≤300 行**
- [ ] **后端分层未破坏**：controllers → services → repositories，依赖只向下，**SQL 只在 repositories**
- [ ] **前端阅片区未绕过封装层**：组件不直接调 Cornerstone 全局 API
- [ ] **未关闭 `preferSizeOverAccuracy`**（必须为 true）
- [ ] **GPU 资源生命周期成对**：工具 enable/disable 在 unmount 时成对释放，视口显式 destroy()

### 合规约束

- [ ] **未给 AI 输出加诊断结论字段**（`nature` / `malignancy` / `impression`）
- [ ] **未削弱越权响应的不可区分性**（10004 与 10005 的响应时间、状态码、响应体大小）
- [ ] **新增错误码已归入契约分段**（架构方案 §7.6）
- [ ] **新增 AI task 已确认在许可白名单内**（`model-license-whitelist.ts`，注意 NC 条款）
- [ ] **新增依赖已登记到** `docs/licenses/THIRD-PARTY.md`

### 契约与数据

- [ ] **契约有变更** → 已同步 `docs/openapi.yaml` + 重新生成类型（`npm run gen:types`）
- [ ] **DDL 有变更** → 已同步 `docs/db/schema.sql` + 新增迁移文件（编号连续）
- [ ] **涉及审计** → 已标注审计事件类型（`x-audit` / `x-audit-event`）
- [ ] **涉及幂等** → 已支持 `Idempotency-Key`，且「同键异体」返回 10001

### 测试

- [ ] `npm run lint` 通过
- [ ] `npm run typecheck` 通过
- [ ] `npm run build:web` 通过
- [ ] 相关单测已补（或说明为何不需要）
- [ ] **新测试不是「恒真断言」** —— 检查过它真的会失败

---

## 数据与隐私

- [ ] **未包含任何真实患者数据**（示例用 `张*明` / `ACC00000001`）
- [ ] **未包含任何真实口令、令牌、密钥、内网地址**
- [ ] **日志不打印 PHI**（见 `docs/ops/RUNBOOK.md` 的脱敏约定）

## 截图 / 演示

<!-- UI 改动请给截图。阅片页请说明：Canvas 占比、主题（亮/暗）、
     分辨率。特别注意 Canvas 区域必须恒暗，角标文字用 text-on-canvas。 -->
