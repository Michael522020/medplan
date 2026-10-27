# MedPlan 页面级设计规格（P2）

> 项目：MedPlan — 企业级医学影像阅片与手术规划系统
> 设计师：颜好看 | 日期：2026-10-22 | 阶段：Phase 2 页面级细化
> 上游文档：`docs/Spec.md`（锁定契约）、`docs/design-tokens.json`（Token 唯一源）、`docs/UIUX.md`（设计系统）
> 本文档定位：**前端可直接照此写组件的施工图**。凡本文与 Spec.md 冲突，以 Spec.md 为准；凡本文与 design-tokens.json 冲突，以 json 为准。
> 图标库：**@tabler/icons-react 3.49.0（唯一）**。填充态为同名独立构件（`AlertTriangle` / `AlertTriangleFilled`），**不是 `-filled` 后缀**。

---

## 0. 全局约定（先读这一节，避免每页重复）

### 0.1 三条硬约束（前端不得「修正」）

| # | 约束 | 后果 |
|---|---|---|
| 1 | **亮色主题下 `--color-surface-canvas` 仍是 `#1A1A1A`**，不得改成白色 | 灰阶影像在白底上丧失诊断对比（专业硬约束，非审美） |
| 2 | **Canvas 上角标文字一律 `--color-text-on-canvas`**，不得用 `--color-text-primary` | 亮色主题下 `text-primary` 是深色，叠在近黑 Canvas 上不可见 |
| 3 | **危急值必须颜色 + `AlertTriangle` 图标 + 「危急值」文字三重编码** | 禁止仅用颜色（AC-22 / P3） |

### 0.2 主题适用范围

| 页面 | 主题行为 |
|---|---|
| `/login` `/worklist` `/reports/:id` `/admin/audit` `/viewer/:uid/segmentation` | 跟随全局（默认暗色） |
| `/viewer/:studyUid` `/viewer/:studyUid/plan` | **Canvas 区恒暗**（`--color-surface-canvas`），周边 chrome 跟随全局 |

### 0.3 图标写法约定

```tsx
// 描边态（默认）
import { AlertTriangle, Lock } from '@tabler/icons-react';
<AlertTriangle size={16} strokeWidth={1.75} aria-hidden />

// 填充态（同名独立构件，非 -filled 后缀）
import { AlertTriangleFilled } from '@tabler/icons-react';
```

| 用途 | size | strokeWidth | Token |
|---|---|---|---|
| 行内 / 表格单元格 | 16px | 1.75 | `--icon-size-inline` / `--icon-stroke-width-sm` |
| 按钮内 / 工具栏 | 20px | 2 | `--icon-size-button` / `--icon-stroke-width` |
| 独立图标 / 面板标题 | 24px | 2 | `--icon-size-standalone` |
| 空状态专用 | 32px | 1.75 | `--icon-size-lg` |

图标颜色**继承 `currentColor`**（父元素文字色），组件内禁止给 SVG 写死颜色。

### 0.4 全局快捷键（所有页面共享）

| 键 | 动作 | 作用域 |
|---|---|---|
| `?` | 打开快捷键帮助 | 全局 |
| `Ctrl`+`\` | 切换左侧栏折叠 | 工作台类页面 |
| `Ctrl`+`]` | 切换右侧栏折叠 | 工作台类页面 |
| `Ctrl`+`Alt`+`t` | 循环主题（跟随系统 → 暗色 → 亮色） | 全局 |
| `Esc` | 关闭当前浮层 / 退出当前工具 | 全局（危急值弹窗除外） |

**焦点规则**：`Tab` 顺序严格遵循视觉顺序（左→右、上→下）；`:focus-visible` 显示 2px `--color-focus-ring` + 2px offset，**永不移除 outline**。

### 0.5 响应式总则（三档分辨率）

Spec §10 锁定：**UI 尺寸恒定，绝不随分辨率放大**（医生已形成肌肉记忆），仅 Canvas 随屏扩大。

| 视口 | 侧栏 | Canvas | 面板宽度 | 字号 | 图标 |
|---|---|---|---|---|---|
| 1920×1080 | 288 / 320px（锁定） | 1312×968 | 不变 | 不变 | 不变 |
| 2560×1440 | 288 / 320px（**不放大**） | 1952×1328 | 不变 | 不变 | 不变 |
| 3840×2160 | 288 / 320px（**不放大**） | 3232×2048 | 不变 | 不变 | 不变 |

**禁止**：`clamp()` 随视口缩放字号、根字号 `vw` 单位、面板宽度百分比化、Canvas 之外任何元素随分辨率放大。

### 0.6 布局常量冲突（**需team-lead 裁决**）

Token 锁定 `viewer-canvas-min-ratio: 70%`，同时锁定 `sidebar-left-width: 288px` + `sidebar-right-width: 320px`。二者**在 1920×1080 下数学不相容**：

| 方案 | Canvas 尺寸 | 宽度占比 | 面积占比（占全屏） |
|---|---|---|---|
| 1920×1080 双侧栏全展开 | 1312×968 | 68.33% | **61.25%** |
| 1920×1080 左栏折叠为64px 图标栏 | 1536×968 | 80.00% | **71.70%** |
| 2560×1440 双侧栏全展开 | 1952×1328 | 76.25% | 70.32% |
| 3840×2160 双侧栏全展开 | 3232×2048 | 84.17% | 79.80% |

**结论与建议**：70% 在 2560 及以上天然满足；1920 下必须**左栏默认折叠为 64px 图标栏**才能达到 71.70%。本文按此执行：

- **1920×1080**：左栏默认折叠为 64px 图标栏（`Ctrl+\` 展开），Canvas 面积 71.70%，满足 70%
- **2560×1440 / 3840×2160**：双侧栏全展开即满足 70%
- **Canvas 最小宽度兜底**：无论何种分辨率，Canvas 宽度不得低于 `viewerMin 1440px - 608px = 832px`；低于此值时强制双栏折叠

> 我未擅自修改 Token 值（`viewer-canvas-min-ratio` 仍是 70%），仅在布局策略层给出可执行的达成方式。若团队选择「1920 下双栏全展开、放弃 70%」，只需改本文 §2.1 一行，不需动 Token。

---

## 1. 页面 `/login` — 双因素登录

### 1.1 布局规格

单卡片居中，**无 Hero、无插画人物、无营销文案**（面向医生的工具不需要营销页）。

```
1920×1080 视口
└── 根容器 100vw×100vh，--color-surface-app 底，垂直居中偏上 15%
    └── 卡片 400px 宽 × 自适应高，--color-surface-raised 底
        --radius-lg 12px，--elevation-shadow（亮色）/ 无阴影（暗色）
        padding: --space-8 32px
        ├── 产品标识区 48px（几何 SVG，非 emoji）
        ├── 标题区（--text-2xl 24px + --text-sm 副标题）
        ├── 表单区（每组≤4 字段，字段间距 --space-4 16px）
        ├── 主按钮区 40px 高 primary 全宽
        └── 页脚区（锁定策略提示 + 帮助链接）
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 卡片宽度 | 400px | 固定（--space 网格不允许非 4 倍数，此处为组件尺寸非间距） |
| 卡片内边距 | 32px | `--space-8` |
| 标题 | 24px / 1.3 / 590 | `--text-2xl` `--font-weight-semibold` |
| 副标题 | 12px / 1.5 | `--text-sm` + `--color-text-secondary` |
| 输入框高 | 32px | `--control-min-size` |
| 主按钮高 | 40px | 固定（同上） |
| 字段间距 | 16px | `--space-4` |

### 1.2 组件树与 Token 绑定

```
LoginPage
├── LoginCard
│   ├── ProductMark            # 几何 SVG，stroke: var(--color-accent-clinical)
│   ├── LoginTitle                       "影像诊断工作站"
│   ├── LoginSubtitle                    "请使用医院统一身份认证账号登录"
│   ├── LoginForm
│   │   ├── FieldGroup (label "工号")
│   │   │   └── TextInput      # --color-input-bg / -border / -text / -placeholder
│   │   ├── FieldGroup (label "密码")
│   │   │   └── TextInput + IconToggle(Eye / EyeOff)  # 16px, currentColor
│   │   ├── FieldGroup (label "UKey 数字证书")
│   │   │   └── UkeyInsertHint # tabler:usb 16px + "请插入 UKey 后点击登录"
│   │   └── FieldGroup (label "口令")
│   │       └── PasswordInput + IconToggle
│   ├── LoginSubmitButton      # --color-button-primary-bg / -text / -hover / -active
│   ├── LockPolicyHint         # tabler:lock 16px + --text-xs + --color-text-tertiary
│   └── HelpLink
├── ThemeSwitcher              # tabler:moon / tabler:sun，位于卡片右上角外
└── Toaster                    # --z-toast 500，右下角堆叠
```

**双因素交互顺序（关键）**：Spec §5 `POST /auth/login` 一次性提交 `username` + `password` + `ukey_cert`。UI 上**不做两步 wizard**——UKey 检测是本地 WebUSB 事件，呈现为「检测到 UKey 设备」的即时状态行，而非第二个表单步骤。理由：两步 wizard 会让医生误以为可以先输口令后插 UKey，导致提交时才发现证书缺失。

### 1.3 状态矩阵

| 状态 | 表现 | 文案（真实临床/运维场景） |
|---|---|---|
| **Loading** | 主按钮内 `Loader2` 旋转 + `aria-busy`，按钮宽不变 | 按钮文案切「验证中」；UKey 行显示「正在读取证书…」 |
| **Empty** | 不适用 | — （表单无空态） |
| **Error** | 字段下方 `--space-1` 处 `--color-status-critical` 12px 文字 + `AlertCircle` 16px | 见下方四种错误 |
| **Populated** | 正常可提交 | — |
| **Edge** | UKey 拔出中点击登录 / 口令超长 / 锁定剩余时间 | 「UKey 已拔出，请重新插入后登录」；口令框 `maxlength=64` 超长时输入框滚动不撑破 |

**四种错误态文案（禁止泛化）**：

| 场景 | 文案 | 附加信息 |
|---|---|---|
| 口令或工号错 | 「工号或口令不正确，剩余尝试 3 次」 | `AlertCircle` + 计数递减 |
| UKey 未插入 | 「未检测到 UKey 数字证书，请插入后重试」 | `AlertTriangle`（这是 AC-02 的强制拒绝） |
| 证书不匹配 | 「UKey 证书与工号 dr.zhang 不匹配」 | `AlertTriangle` + 「请联系信息科重新签发证书」 |
| 账号锁定 | 「账号已锁定，请联系信息科解锁」 | 整卡转 `--color-status-critical-subtle` 底 + `AlertOctagon` |

**倒计时 Edge**：锁定态显示剩余时间（如「剩余 18 分 24 秒」），用 `--number-font-feature` 等宽，避免数字跳动。

### 1.4 交互规格

| 元素 | Default | Hover | Focus | Active | Disabled |
|---|---|---|---|---|---|
| 输入框 | `--color-input-bg` + `--color-input-border` | 边框转 `--color-border-strong` | 2px `--color-focus-ring` outline + 2px offset | — | `--color-input-disabled-bg` + `aria-disabled` |
| 主按钮 | `--color-button-primary-bg` | `--color-button-primary-hover` | 2px `--color-focus-ring` | `--color-button-primary-active`（50ms `--motion-instant`） | 校验未过：`opacity` 降级 + `aria-disabled` + `cursor:not-allowed` |
| Eye 切换 | 16px `currentColor` | `--color-surface-hover` 底 | 同上 | — | — |
| 帮助链接 | `--color-text-secondary` 下划线 | `--color-text-primary` | 同上 | — | — |

**点击热区**：所有可点元素 ≥ 44×44px（`--touch-target-min`）。32px 高的输入框通过 `padding` 外扩热区至 44px。

**键盘**：

| 键 | 动作 |
|---|---|
| `Tab` | 工号 → 口令 → UKey 状态行（可聚焦，`tabindex=0`）→ Eye → 记住工号 → 登录 → 帮助 |
| `Enter` | 任意输入框内直接提交 |
| `Esc` | 清空当前输入框内容（非清除整表） |

**双因素失败的安全设计**：口令错误与 UKey 错误的响应时间必须一致（AC-02/AC-16 防时序侧信道同理）。前端**不得**在 UKey 分支上做更短的 loading（如「立即报错」）——那本身就成了侧信道。

### 1.5 数据绑定

`POST /api/v1/auth/login`

> 字段名以 `openapi.yaml` 为准。注意契约里 `ukey_cert` / `ukey_pin_block` 是 **snake_case**（其余为 camelCase）——以契约实际命名为准，前端照抄。

| 请求字段（契约 `LoginRequest`） | 来源 | UI 位置 |
|---|---|---|
| `username` | 工号输入框（`maxLength: 64`） | Field 1 |
| `password` | 口令输入框（`minLength: 8`, `maxLength: 128`） | Field 2 |
| `ukey_cert` | WebUSB 读取的证书 Base64 DER（`maxLength: 8192`） | Field 3（自动填充） |
| `ukey_pin_block` | UKey PIN 的 PBKDF2 派生值 | Field 3（**不传明文 PIN**） |

| 响应字段（契约 `LoginResponse.data`） | UI 动作 |
|---|---|
| `accessToken` / `refreshToken` / `tokenType` / `expiresIn` | 存会话，跳 `/worklist` |
| `ntpOffsetMs` | **时间偏移提示**（见下） |
| `user` | 用户标识 + 角色（决定左侧导航可见项） |
| `ukey` | UKey 绑定信息 |

**`ntpOffsetMs` 的 UI 阈值**（契约明确要求）：

| 偏移 | UI |
|---|---|
| \|偏移\| ≤ 1000ms | 不提示（正常） |
| 1000ms < \|偏移\| ≤ 60000ms | 登录后顶部显示**琥珀**提示条「本机时间与院内标准时相差 2.3 秒，请校准系统时间」+ `tabler:alert-circle` +「知道了」 |
| \|偏移\| > 60000ms | 签名时会被**拒绝**（AC-15）。登录后立即显示警示条「本机时间与院内标准时相差 47 秒，**电子签名将被拒绝**，请先校准系统时间」+ `tabler:alert-triangle` |

> 这个提示必须在**登录时**就出现，而不是等到签名失败才暴露——医师在签名被拒时才会发现本机时钟不对，浪费一次签名流程。契约给了 1000ms 提示阈值与 60000ms 拒绝阈值两个档，UI 必须都实现。

**错误响应**：

| 码 | UI |
|---|---|
| 10002 | 未认证 → 停留在本页，口令框清空，焦点回 Field 1 |
| 10003 | 无权限（角色级）→ 「该账号未被授予影像科角色」+ 联系信息科 |
| — | UKey 缺失 → AC-02 强制拒绝，走 §1.3 错误态 |

**UKey 证书校验失败的不透露原则**（契约 `ukey_cert` 描述明确）：服务端校验链为「有效期 → 颁发者链 → 吊销列表 → 私钥签名验证」，**任一失败即拒绝，且不透露失败的具体环节**（避免证书状态侧信道）。因此前端**不得**根据错误码猜测是哪一环失败，只显示统一的「UKey 证书校验未通过，请重新插入或联系信息科」。

审计联动：每次登录尝试（含失败）由后端写审计，前端不负责。

### 1.6 无障碍要点

- 表单错误用 `aria-describedby` 关联到输入框，`role="alert"` 播报，**不依赖红框单独传达**
- 口令/UKey 错误必须**文字 + 图标 + 颜色三重编码**（AC-22 同理适用于安全事件）
- `ErrorMessage` 组件固定高度或预留空间，避免错误出现时按钮位移（CLS < 0.1）
- UKey 状态行 `aria-live="polite"`，插拔事件不打断当前输入焦点
- 全文键盘可达，**无任何仅靠 hover 揭示的信息**（「忘记密码」链接常驻）

### 1.7 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。卡片恒 400px，垂直居中偏上 15%。UI 不随分辨率放大 |
| < 1440px（笔记本） | 卡片宽 `min(400px, 100vw - 32px)`，垂直居中改为 24px 顶距 |
| < 768px（平板） | 卡片去圆角满宽（去 `--elevation-shadow`，避免大圆角+ 阴影幽灵卡片） |

---

## 2. 页面 `/worklist` — 检查列表工作台

### 2.1 布局规格

```
1920×1080
├── A. 顶部状态栏 40px（--toolbar-height / --statusbar-height）
│    产品标识 │ 面包屑 │ Search │ 患者标识 │ Bell │ Moon │ Settings
├── B. 左侧主导航 240px（可折叠 64px 图标栏）
│    工作台 / 分割任务 / 规划 / 报告 / 审计（按角色过滤显示）
├── C. 内容区（自适应，最大宽度不限——表格需要横向空间）
│    ├── C1 视图切换 Tabs 36px
│    ├── C2 筛选与搜索栏 40px
│    ├── C3 结果统计条 28px
│    └── C4 检查列表表格（表头 32px + 行 44px）
└── D. 底部状态栏 40px（PACS 连接状态 / 用户 / 版本）
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 顶部状态栏 | 40px | `--statusbar-height` |
| 左侧导航 | 240px / 折叠 64px | 固定 |
| 视图 Tabs | 36px | 组件固定高 |
| 筛选栏 | 40px | `--control-min-size` |
| 表格行高 | **44px** | `--touch-target-min`（满足触控目标） |
| 区块间距 | 16px | `--space-4` |

> 与阅片页不同，工作台**不受 70% Canvas 约束**（无 Canvas），行高取 44px 而非 36px——列表是触控/平板常用场景。

### 2.2 组件树与 Token 绑定

```
WorklistPage
├── AppHeader (40px)                    # --color-surface-app + --color-border-subtle 下边框
│   ├── ProductMark
│   ├── Breadcrumb          # 科室 / 视图
│   ├── GlobalSearch                     # tabler:search 16px, --color-input-bg
│   ├── CriticalAlertBell# tabler:bell, 有危急值时 tabler:alert-triangle + 红点
│   ├── ThemeSwitcher        # tabler:device-desktop / moon / sun
│   └── UserMenu             # tabler:user + 姓名 + tabler:chevron-down
├── SideNav (240px / 64px)               # --color-surface-panel
│   └── NavItem             # --color-surface-hover / --color-surface-selected + 左侧 2px accent 指示
├── WorklistContent
│   ├── ViewTabs (36px)      # [待阅 12] [已阅] [急诊] [全部]
│   ├── FilterBar (40px)
│   │   ├── SearchInput                   # 姓名 / 住院号
│   │   ├── FilterDropdown (检查类型)     # tabler:filter
│   │   ├── DateRangePicker               # tabler:calendar
│   │   └── DensityToggle                 # tabler:layout-rows / layout-grid
│   ├── ResultCountBar (28px)             # "共 34 项待阅 · 2 项急诊" --text-xs
│   └── StudyTable                # --color-table-header-bg / -row-hover / -row-selected / -border
│       └── StudyRow (44px)
│           ├── PriorityBar# 急诊行左侧 4px --color-status-critical（状态指示，非装饰）
│           ├── PatientCell            # 姓名 --text-xl? 否 → --text-base 13px + 住院号 tabular-nums
│           ├── SexAgeCell             # 男 / 67 岁
│           ├── StudyTypeCell# 胸部CT
│           ├── StudyDateCell          # 10-22 09:14 tabular-nums
│           ├── QueueDurationCell      # 5小时12分 tabular-nums
│           ├── StatusBadge            # 待阅 / 已阅 / 急诊
│           └── RowActions             # hover 才显示: Eye / History / Flag
└── AppStatusBar (40px)         # tabler:server + "PACS 已连接" / tabler:wifi-off
```

### 2.3 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **StudyTable** | 10 行骨架屏（`--color-skeleton-base`，150ms 微光） | 「当前视图暂无待阅检查」/「今日待阅队列已清空，最近一次归档 16:42」/ 操作「查看已阅列表」`tabler:inbox` 32px | 「PACS 服务连接失败（10.20.3.12:104）」+「重试」+「离线模式」（`tabler:plug-connected-x`） | 正常表格 | 单日 >2000 检查 → 虚拟滚动 + 每页 50 |
| **SearchInput** | — | — | — | — | 姓名含空格/生僻字：显示为原样，不做拼音转换（避免误检） |
| **FilterDropdown** | 下拉骨架 3 项 | 「无可用筛选项」 | — | 正常 | 已选条件 >3 项时折叠为「已选 5 项」+ `tabler:chevron-down` |
| **ResultCountBar** | 「正在统计…」 | 「共 0 项」 | 「统计失败」 | 「共 34 项待阅 · 2 项急诊」 | >999 项显示「共 1,247 项」+千分位 tabular-nums |
| **StatusBadge** | — | — | — | 待阅（中性）/ 已阅（`tabler:circle-check` + `--color-status-normal`）/ 急诊（`tabler:alert-triangle` + `--color-status-critical` + 「急诊」文字，三重编码） | 「已阅」与「急诊」并存时，急诊优先显示（安全语义优先） |

**Empty 态文案设计说明**：不写「暂无数据」（空洞占位），而是回答医生的三个问题——**还有没有活？为什么空？接下来做什么？**。「今日待阅队列已清空，最近一次归档 16:42」比「暂无数据」多给了两个决策信息：队列状态 + 系统仍在正常工作。

### 2.4 交互规格

**行交互**：

| 操作 | 行为 |
|---|---|
| 单击行 | 打开阅片工作台 `/viewer/:studyUid` |
| `Enter` / `↑`+`↓` | 移动行焦点（roving tabindex，整表只占一个 Tab 位） |
| `Enter`（焦点在行上） | 打开 |
| 行内操作按钮 | **hover 才显示**，但**键盘聚焦时同样显示**（否则键盘用户不可达） |
| 右键 | 屏蔽浏览器菜单，改为「打开 / 标记已阅 / 置顶」三项 |

**行热区**：整行 44px 高、整行宽可点。行内操作按钮 44×44px（视觉 20px 图标 + 外扩 padding）。

**状态矩阵（视觉）**：

| 状态 | Token |
|---|---|
| Default | `--color-surface-panel` 底（暗色下与 app 同色，靠 hover 区分） |
| Hover | `--color-table-row-hover` |
| Selected | `--color-table-row-selected` + 左侧 2px `--color-accent-clinical` |
| Focus | 2px `--color-focus-ring` outline，**不移除** |
| 急诊行 | 左侧 4px `--color-status-critical` + `tabler:alert-triangle` + 「急诊」文字 |

**快捷键**：

| 键 | 动作 |
|---|---|
| `/` | 聚焦搜索框 |
| `Esc` | 清空搜索 / 退出搜索焦点 |
| `Enter` | 打开选中行 |
| `↑` `↓` | 行间移动 |
| `j` `k` | 行间移动（备选，医生习惯） |
| `Alt`+`1..4` | 切换视图 Tab（待阅/已阅/急诊/全部） |
| `r` | 刷新列表 |
| `f` | 打开筛选栏 |

### 2.5 数据绑定

`GET /api/v1/studies`（按权限过滤）

> 字段名以 `openapi.yaml` 为准（camelCase），DB snake_case 由后端 repositories 层转换。

| 契约字段 | UI 位置 | 格式化规则 |
|---|---|---|
| `studyUid` | 行 key + 点击跳转参数 | 原值，不显示 |
| `accessionNo` | PatientCell 副行（检查号） | tabular-nums |
| `patient.nameMasked` | PatientCell 主文案 | **脱敏值**（如「张*明」），契约已脱敏，前端不还原 |
| `patient.patientId`（EMPI） | PatientCell 副行 | tabular-nums |
| `patient.gender` / `patient.birthDate` | SexAgeCell | 「男 / 67 岁」，年龄由出生日期算。`gender` 为 ISO 5218 代码（`M`/`F`/`O`/`''`），需映射为中文，空串显示「未记录」 |
| `modality` + `studyDescription` | StudyTypeCell | 「腹部平扫+三期增强」 |
| `bodyPart` | StudyTypeCell 副行 | 枚举：ABDOMEN/LIVER/CHEST/PELVIS/HEAD/SPINE/EXTREMITY/WHOLE_BODY/OTHER → 中文映射 |
| `studyDate` | StudyDateCell | `MM-DD HH:mm`，tabular-nums |
| `status` | StatusBadge | 待阅/已阅/急诊等 |
| `seriesCount` | 项内标签 | 整数，tabular-nums |
| `hasSignedReport` | 行内标记 | `tabler:signature` + 「已签」 |
| `reportId` | 「查看报告」入口 | `null` 时不显示该入口 |
| 队列时长 | QueueDurationCell | 服务端算好下发，前端**不重算**（避免时区/口径分歧），tabular-nums |
| 优先级 | PriorityBar / StatusBadge | 急诊 → 三重编码 |
| `visit` | 行 hover tooltip | 「住院号 88213 · 肝胆外科」 |

**脱敏规则**：`patient.nameMasked` 是契约层已脱敏的值（`张*明`），前端**直接渲染**，不得尝试还原全名。审计日志的 `actorNameMasked` 同理。医师能看到的患者身份信息以服务端下发的脱敏形态为准——这是 PHI 最小暴露原则在 UI 层的体现。

**无结果 vs 无权限**：10004 与 10005 响应不可区分，UI 一律显示 §2.3 的同一套 Empty/受限文案，**不得**出现「该患者不存在」。

### 2.6 无障碍要点

- 表格 `role="grid"`，`aria-rowcount` 随虚拟滚动更新；`<caption class="sr-only">` 描述当前视图
- 急诊行的三重编码让色觉障碍用户可仅靠图标形状 + 文字识别
- roving tabindex：整表一个 Tab 位，行内 `↑↓` 导航，避免 2000 行造成 Tab 地狱
- 排序变化用 `aria-live="polite"` 播报「已按检查日期降序排列」
- 虚拟滚动必须保留键盘焦点（滚动到不可见区域时用 `aria-activedescendant` 指向虚拟节点）
- 结果统计条 `aria-live="polite"`，筛选后播报新结果数

### 2.7 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。侧栏 240px、行高 44px、字号全部不变。差异仅是表格右侧留白增加 |
| 1280（笔记本） | 侧栏自动折叠 64px 图标栏；表格保留全部列，横向滚动 |
| 1024（术中平板） | 侧栏转抽屉（`tabler:layout-sidebar-right` 触发）；表格切卡片模式（每行一张卡，主信息 PatientCell + StudyTypeCell）；行高升至 44px 保持触控友好 |
| 768（竖屏平板） | 仅「单任务」模式：单列卡片，筛选收进 `tabler:filter` 抽屉 |

---

## 3. 页面 `/viewer/:studyUid` — 阅片工作台（重点）

> **Canvas 恒暗**。本页是全项目最复杂页面，也是三条硬约束的主要落地点。

### 3.1 布局规格

**1920×1080（左栏默认折叠为 64px 图标栏以满足 70% Canvas，见 §0.6）**：

```
┌──────────────────────────────────────────────────────────────────────┐
│ A. 顶部状态栏 40px  --statusbar-height                              │
│   产品 │ 面包屑 患者/检查 │ Search │ 患者标识 │ Bell │ Moon │ Settings│
├────┬────────────────────────────────────────────────┬────────────────┤
│ B  │ C. Canvas 区  1536×968                       │ D. 右侧栏      │
│ 288│    --color-surface-canvas（恒暗）             │ 320px          │
│ (可 │  ┌──────────────┬──────────────┐             │ D1 窗宽窗位    │
│ 折  │  │ Axial        │ Sagittal│             │ D2 测量工具    │
│ 叠) │  ├──────────────┼──────────────┤             │ D3 AI 结果     │
│    │  │ Coronal      │ 第四视口/3D  │             │ D4 报告摘要    │
│64px│  └──────────────┴──────────────┘             │                │
│    │  [Canvas 内角标 overlay 层]                │                │
│    ├────────────────────────────────────────────────┤                │
│    │ F. 序列导航条 32px  --series-nav-height       │                │
│    │   ◀ 342/512 ▶ │ PlayerPlay 电影回放 │ 跳转     │                │
├────┴────────────────────────────────────────────────┴────────────────┤
│ G. 底部工具条 40px  --toolbar-height（浮动于 Canvas 下沿，默认半透明）  │
└──────────────────────────────────────────────────────────────────────┘
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 顶部状态栏 | 40px | `--statusbar-height` |
| 左侧栏 | 288px /折叠 **64px** | `--sidebar-left-width` |
| 右侧栏 | 320px | `--sidebar-right-width` |
| 序列导航条 | 32px | `--series-nav-height` |
| 底部工具条 | 40px | `--toolbar-height` |
| Canvas | 1536×968（1920，左栏折叠） | `--color-surface-canvas` |
| Canvas 面积占比 | **71.70%** ≥ 70% | `--viewer-canvas-min-ratio` |

**Canvas 区内部布局（四宫格）**：2×2 均分，格间 1px `--color-surface-canvas` 分隔（**不是边框**，Canvas 上禁止边框）。单屏模式时单格占满。

**视口标签**：每个视口左上角 `--text-2xs` 10px + `--color-text-on-canvas`，写明平面（Axial / Sagittal / Coronal / 3D），**恒定显示**（不 hover 才出现——医生需要随时确认自己在看哪个平面）。

### 3.2 组件树与 Token 绑定

```
ViewerPage
├── AppHeader (40px)                    # 同工作台，见 §2.2
├── SidebarLeft (288px / 64px)
│   ├── PatientInfoCard         # --color-surface-panel
│   │   ├── PatientName         # 张×× --text-xl 20px 590
│   │   ├── SexAge / 住院号      # tabular-nums
│   │   ├── StudyType / 检查日期
│   │   ├── ApplyDept / 临床病史
│   │   └── CriticalBanner      # tabler:alert-triangle + --color-status-critical
│   │                            #  + --color-critical-banner-bg  「危急值」
│   ├── SeriesListPanel         # 按期相分组，见 §3.5
│   └── PriorStudyPanel         # tabler:history 既往检查对比
├── CanvasStage
│   ├── Viewport×N (2×2)
│   │   ├── CornerOverlayTL     # 序列描述 / MODALITY
│   │   ├── CornerOverlayTR     # 层号 342/512 / W:1500 L:-600
│   │   ├── CornerOverlayBL     # 张×× 男 47岁 ID:3392041（防左右误读，DICOM 强制）
│   │   ├── CornerOverlayBR     # 0.625mm  D:0.55
│   │   ├── Crosshair           # --color-overlay-crosshair（唯一许可染色层）
│   │   ├── HuReadout           # HU:-847，--font-mono tabular-nums
│   │   └── ViewportLabel       # Axial/Sagittal/Coronal/3D
│   ├── SeriesNavBar (32px)
│   └── Toolbar (40px, floating)
├── SidebarRight (320px)
│   ├── WindowLevelPanel       # WW/WL NumericInput + 预设窗
│   ├── MeasurementPanel       # tabler:ruler-measure 测量列表
│   ├── AiResultPanel          # tabler:brain AI 结节列表
│   └── ReportSummaryPanel     # tabler:notebook 报告摘要
└── ShortcutHelpModal      # tabler:keyboard, 720px
```

**Canvas 角标配色（硬约束 2 落地点）**：

```css
.viewport-corner-overlay {
  color: var(--color-text-on-canvas);  /* 双主题恒为 #E8EDF0 */
  font-size: var(--text-2xs);          /* 10px */
  font-variant-numeric: var(--number-font-feature);
  /* 严禁使用 var(--color-text-primary) */
}
```

### 3.3 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **Viewport** | `Loader2` 32px + 「正在加载序列 S4 静脉期」+ 进度条 + 「已加载 1247/2000 层 62%」+「预计剩余 8 秒」+「后台继续」/「取消」 | 「该序列无图像数据」+ 序列 UID + 「返回序列列表」（`tabler:file-off`） | 「序列加载失败」+ 错误原因「PACS 服务返回 C-STORE 失败」+ 错误码 `PACS-5031` + **已加载层数** + 三操作：「重试」/「仅加载已成功部分」/「联系信息科」 | 影像 + 角标 + HU 值 | 1×1 层（单层图像）时角标不重叠；超大层数（>9999）层号用 `1.2万`？**否**——必须显示精确 `12478/12480`，用 tabular-nums 保证不跳动 |
| **SeriesListPanel** | 骨架行 6 条（`--color-skeleton-base`） | 「本次检查共 4 个序列，全部无图像数据」+ 「联系 PACS 管理员」 | 「序列索引加载失败」+ 重试 | 期相分组列表 | 序列 >100 个 → 虚拟滚动 + 分组头吸顶 |
| **WindowLevelPanel** | 预设窗列表骨架 | 「当前序列无有效像素数据，无法计算直方图」 | 「窗宽窗位预设加载失败」 | WW/WL 输入 + 预设按钮 | WW 范围超 32 位（`-30240 ~ 30240`）时输入框不撑破，`ellipsis` + title |
| **MeasurementPanel** | — | 「尚无测量记录」+「选择 tabler:ruler-measure 后在影像上点击两点开始测量」 | — | 测量列表（含数值、单位、删除） | 测量 >50 条 → 分组折叠 + 虚拟滚动；删除需二次确认「删除测量「肝右叶病灶长径 23.4mm」？」 |
| **AiResultPanel** | 「AI 分析进行中 62%」+ 进度条 | 「本检查未提交 AI 分割任务」+ 操作「tabler:player-play 提交 AI 分割任务」（跳转 `/segmentation`） | 「AI 结果加载失败（AI-SEG-2014）」+ 重试 + 「AI 分割未完成」三态禁用确认区 | 结节列表 + 采纳/否决 | AI 置信度 <50% 时额外显示「低置信度，建议人工复核」+ `tabler:alert-circle` |
| **ReportSummaryPanel** | 骨架 | 「报告尚未创建」+「新建报告」 | 「报告加载失败」+ 重试 | 摘要文本 | 超长摘要 → 折叠为 3 行 + 「展开」 |
| **CriticalBanner** | — | — | — | 「危急值」+ `tabler:alert-triangle` + 具体内容 | **永不自动消失**，直到医生显式确认（临床安全） |

**加载态设计权重说明**：PM 转述的医生反馈是「因加载慢而犹豫是否要调阅影像」。因此加载态的三要素是：**① 进度明确（已加载 X/Y 层 + 百分比 + 进度条）② 渐进渲染（已加载的层立即可看）③ 不阻塞工作流（「后台继续」允许医生切去写报告）**。加载期间 UI 亮度不得超过正常态，避免加载完成瞬间的亮度突变造成不适。

### 3.4 交互规格

#### 3.4.1 鼠标 / 触控板（Canvas 内）

| 操作 | 行为 | 设计要点 |
|---|---|---|
| 左键拖拽 | 窗宽窗位调节（水平 = W，垂直 = C） | 拖拽时右上角实时显示 `W:1500 L:-600` |
| **右键拖拽** | 同左键（为惯用右手医生保留的并行路径） | **必须屏蔽浏览器右键菜单**，否则每次调窗都要先关菜单——这是最实际的点击陷阱 |
| 中键拖拽 | 平移 | |
| `Ctrl`+右键拖拽 | 锁定单维度调节（只调 W 或只调 C） | |
| 滚轮 | **翻层**（而非缩放，避免误操作） | |
| `Ctrl`+滚轮 | 缩放 | |
| 右键拖拽时 | 光标旁显示**灰阶直方图上的窗位窗宽位置标记** | 让医生能「看着调」，是专业影像软件通行做法 |

#### 3.4.2 工具栏按钮（40px 高，图标 20px）

| 状态 | Token |
|---|---|
| Default | 透明底（浮动工具条默认不遮挡影像）+ `currentColor` 图标 |
| Hover | `--color-surface-hover` 底 + **展开文字标签** |
| Selected | `--color-surface-selected` 底 + `--color-accent-clinical` 图标 + **filled 构件**（如`PlayerPlay` / `PlayerPlayFilled`）+ 左侧 2px accent 指示条 |
| Focus | 2px `--color-focus-ring` outline |
| Disabled | `--color-text-disabled` + `aria-disabled` + tooltip 说明原因（如「WebGL 不可用」） |

> **filled 构件用法说明**：Tabler 的填充态是同名独立构件。工具「已激活」态用 `<PlayerPlayFilled />` 替代 `<PlayerPlay />`，保持同一几何语言。

#### 3.4.3 快捷键（医生高频操作全覆盖）

**工具切换**：

| 键 | 工具 | Tabler 构件 |
|---|---|---|
| `V` | 窗口/平移 | `HandGrab` |
| `W` | 窗宽窗位 | `Adjustments` |
| `C` | 十字定位线 | `Crosshair` |
| `L` | 视图联动开关 | `Link` |
| `M` | 长度测量 | `RulerMeasure` |
| `A` | 角度测量 | `Angle` |
| `Shift`+`M` | 面积/ROI | `VectorBezier` |
| `T` | 文本标注 | `TextT` |
| `D` | 图像标注（箭头/画笔） | `Pencil` |
| `R` | 旋转 | `Rotate2` |

**视图导航**：

| 键 | 动作 |
|---|---|
| `↑` `↓` | 上一层 / 下一层 |
| `PgUp` `PgDn` | 上 10 层 / 下 10 层 |
| `←` `→` | 切换活动视口 |
| `1` `2` `3` `4` | 布局：单屏 / 双屏横 / 双屏纵 / 四宫格 |
| `Space` | 电影回放播放/暂停 |
| `Home` `End` | 跳到首层 / 末层 |

**窗宽窗位（键盘等价路径，P5 强制）**：

| 键 | 动作 |
|---|---|
| `Shift`+`←` `→` | W ∓/± 10 |
| `Shift`+`↑` `↓` | C ∓/± 10 |
| `Ctrl`+`Shift`+`←` `→` | W ± 100（大步） |
| `[` `]` | 预设窗循环（肺窗→骨窗→脑窗→软组织窗→纵隔窗） |

**系统**：

| 键 | 动作 |
|---|---|
| `F` | 全屏 Canvas |
| `Ctrl`+`S` | 截图/导出图像 |
| `Ctrl`+`\` / `Ctrl`+`]` | 折叠左/右栏 |
| `Ctrl`+`0` | 重置窗宽窗位与缩放 |
| `?` | 快捷键帮助 |
| `Esc` | 先退出当前工具 → 再退出全屏（**两级**） |

**快捷键实现规则**：所有工具按钮带 `aria-keyshortcuts`；Tooltip **必须显示快捷键**（`--font-mono`）。**在文本输入上下文中（报告编辑器、审计筛选）必须禁用单键快捷键**，否则医生打字会触发工具切换。

#### 3.4.4 点击热区

| 元素 | 热区 |
|---|---|
| 工具栏按钮 | 40×40px（视觉 20px 图标 + 外扩） |
| 序列列表项 | 56px 高 × 288px 宽 |
| Canvas 角标 | **不响应点击**（纯信息，避免误触遮挡影像） |
| 侧栏折叠条 | 4px 宽，hover 扩到 8px 并显示 2px accent 指示 |
| 面板标题栏操作 | 44×44px（视觉 16px 图标） |

### 3.5 期相分组（Spec DCM-02 硬约束）

序列列表按期相分组，组头即期相标识：

| 组头 | Token | 图标 | 文字 |
|---|---|---|---|
| 平扫 | `--color-phase-plain` | `Stack` | 「平扫」 |
| 动脉期 | `--color-phase-arterial` | `Stack` | 「动脉期」 |
| 静脉期 | `--color-phase-venous` | `Stack` | 「静脉期」 |
| 延迟期 | `--color-phase-delayed` | `Stack` | 「延迟期」 |
| **期相未识别** | `--color-phase-unknown` | `HelpCircle` | **「期相未识别」** |

**「期相未识别」是硬约束**：Spec DCM-02 要求必须标注且**禁止默认归入平扫**。理由是医生会把延迟期当平扫读，漏掉强化病灶。执行：

- 该组琥珀色 + `HelpCircle` + 「期相未识别」三重编码，视觉上明确区别于四个已识别组
- **不得**归入平扫组，**不得**默认选中该组任何序列
- 组头右侧「查看依据」入口，展开显示：层厚、序列描述、增强定位、置信度百分比
- 置信度 <50% 时额外显示「建议人工指定期相」+ 下拉选择
- 该组任一序列被选中时，Canvas 顶部显示琥珀提示条：「当前序列期相未识别，请人工确认期相后再据此判读」

**置信度阈值（对齐 openapi.yaml `PhaseGroup.confidence`）**：

契约定义两个阈值，前端**必须**都实现，语义不同：

| 阈值 | 行为 | 理由 |
|---|---|---|
| **< 0.70** | 该期相组**不得默认选中**，组头显示「**期相待人工确认**」+ `HelpCircle` + 置信度百分比 | 契约硬要求。选错期相会导致 AI 分割提交被 `20002` 拒，医师白等一次 GPU 任务与 10 分钟时限 |
| **< 0.50** | 额外显示「**建议人工指定期相**」+ 下拉选择（`tabler:select`） | 更强提示：不仅不自动选，还要主动让医师指定 |

即：0.50–0.70 之间是「不自动选、但有提示条」；< 0.50 是「不自动选 + 主动指定下拉」。

> 我上轮只写了 0.50 一个阈值，遗漏了契约的 0.70 硬约束。已补齐。

### 3.6 数据绑定

> 字段名以 `openapi.yaml` 为准（camelCase），DB snake_case 由后端 repositories 层转换。

| 端点（Spec §5） | 用途 | 契约字段 → UI |
|---|---|---|
| `GET /api/v1/studies/{studyUid}/series` | 序列列表按期相分组 | `PhaseGroup[]`：`phase` / `phaseLabel` / `confidence` / `series[]` → 期相组头 + 组内项 |
| `POST /api/v1/wado/instances` | WADO-RS 取图 | 响应为 DICOM 二进制流 → Cornerstone 渲染 |
| —（Cornerstone 本地） | 窗宽窗位 / 层号 / 测量 | **本地状态，不落库**；但松手后窗宽窗位值**记入审计**（PHI 操作） |

**`PhaseGroup` → UI 映射**：

| 契约字段 | UI 位置 | 格式 |
|---|---|---|
| `phase` | 期相分组键 | 枚举：平扫/动脉期/静脉期/延迟期/未识别 |
| `phaseLabel` | 组头显示名 | **显示用**，不做业务判断 |
| `confidence` | 组头置信度 + 阈值判定（见 §3.5） | 0–1 浮点，百分比 tabular-nums |
| `series[].seriesUid` | 行 key + 影像加载参数 | — |
| `series[].seriesNumber` | 项内序号（期相分组后仍保留原 DICOM 序号） | 整数 |
| `series[].description` | 序列描述（如「Axial 0.5mm 门静脉期」） | 文本 |
| `series[].instanceCount` | 项内层数 `342/512` | 整数，tabular-nums |

**前端实现约束（架构师提示）**：

1. **WADO 取图必须注入认证头**：`dicomImageLoader.wadors.configure({ beforeSend })` 中加 `Authorization`，否则 401。
2. **薄层 CT 需 `codec-openjpeg` 1.3.0** 支持 JPEG2000（`1.2.840.10008.1.2.4.90`）。缺编解码器的表现是**该序列加载失败**，需落到 §3.3 的 Error 态（「序列加载失败」+ 错误码 + 重试），不得白屏。

**Canvas 角标字段映射**：

| 角标 | 字段 | 格式化 |
|---|---|---|
| 左上 | `series.description` + `modality` | 「胸部CT 平扫+增强」/「CT」 |
| 右上 | 实例索引 / 总数 + WW/WL | `342/512`、`W:1500 L:-600` 全部 tabular-nums |
| 左下 | `patients.name` / `gender` / `birth_date` / `patient_id` | 「张×× 男 47岁 ID:3392041」（**DICOM 强制**，防左右患者误读） |
| 右下 | 层厚 / 重建间距 | `0.625mm  D:0.55` |
| 十字线激活时追加 | HU 值 | `HU:-847`，`--font-mono` + `tabler:crosshair` 16px + 1px 深色描边（保证在任意影像亮度上可读） |

**错误码映射**：

| 码 | UI 表现 |
|---|---|
| 10004 / 10005 | **完全一致**的无权限态（见 UIUX.md §9.9），用 `tabler:lock-access` 不用 `tabler:alert-triangle`（后者暗示「出错」，前者准确表达「权限边界」） |
| 10003 | 「您的角色无阅片权限」+ 联系信息科 |

### 3.7 无障碍要点（本页特有）

1. **Canvas 键盘导航**：Canvas `role="application"` + `aria-roledescription="影像视口"`，`aria-label` 实时播报当前状态（「胸部CT 平扫 第 342 层，共 512 层，窗宽 1500，窗位 -600」）。↑↓ 翻层、←→ 切换视口、`PgUp/PgDn` 跳 10 层。
2. **Canvas 无障碍定位**：三层递进——① `aria-label` 播报当前层与窗宽窗位 ② 每个视口提供「跳转到指定层」数字输入（不依赖连续按方向键） ③ 测量结果列表是Canvas 的等价文本替代，屏幕阅读器可完整读出测量值。
3. **快捷键冲突防护**：焦点在 `input`/`textarea`/`contenteditable` 内时，**所有单键快捷键失效**（除 `Esc`）。这是最常见的无障碍事故源。
4. **焦点可见**：工具栏 40 个按钮全部可 Tab 到达，`:focus-visible` 2px ring。浮动工具条不得因为「默认透明」而丢失焦点指示。
5. **动态数值播报**：HU 值变化不播报（太频繁，会淹没屏幕阅读器）；仅在「层号切换完成」「测量创建完成」时 `aria-live="polite"` 播报。
6. **危急值**：`aria-live="assertive"` + `role="alert"`，三重编码。
7. **降级态不静默**：WebGL 不可用时琥珀警示条常驻 + 三维按钮 `disabled` + tooltip 说明原因 + 重试入口（AC-06 / PIT-02）。
8. **Canvas 像素本身不可访问**：`role="img"` 无法表达灰阶信息，因此**所有诊断关键信息必须有文本等价物**（角标 + 右侧栏量化面板），不能只靠「医生看着图像」。

### 3.8 响应式

| 视口 | Canvas | 侧栏 | 差异 |
|---|---|---|---|
| **1920×1080** | 1536×968（**左栏默认折叠 64px**，面积 71.70%） | 右 320px 常驻 | 左栏折叠态持久化到 `localStorage`；医生展开过则记住展开态 |
| **2560×1440** | 1952×1328（双栏全展开，面积 70.32%） | 288 / 320px | **侧栏宽度不变**。可在右侧栏内追加「图像信息」折叠组（DICOM Tag 明细），**但不改变侧栏宽度** |
| **3840×2160** | 3232×2048（面积 79.80%） | 288 / 320px | 同 2K。四宫格每格 1616×1024，可放放大镜/双视口对比等**已有功能**的并排，不新增功能 |
| 1440（viewerMin） | 832×788 → **强制双栏折叠**得1312×788 | 折叠 | 低于此宽度时 Canvas 不足，提示「窗口过窄，已折叠侧栏」 |
| 1280（笔记本） | 单屏 + 侧栏抽屉 | 折叠 | Canvas 三宫格（Axial 主位 + 2 小格） |
| 1024（术中平板） | 单全屏 | 抽屉 | 工具条转浮层按钮；**Canvas 触控手势**：双指缩放、单指翻层（不与窗宽窗位拖拽冲突——平板上窗宽窗位走右侧面板） |

**分辨率无关性验证点**：1920 / 2560 / 3840 三档下，工具栏图标必须**逐像素相同**（20px，strokeWidth 2），字号**逐像素相同**（13px），侧栏**逐像素相同**（288/320px）。这是 Spec §10 的验收项。

---

## 4. 页面 `/viewer/:studyUid/segmentation` — AI 分割任务与逐项确认

> **这是全项目的合规核心界面**。国家药监局《糖尿病视网膜病变眼底图像辅助诊断软件注册审查指导原则》（2022 年第 23 号）：「不能仅凭算法诊断结果进行临床决策，需要由医生综合判断，**确认签字后报告生效**」。
>
> 设计目标不是「好看」，而是**让逐项确认成为流程的自然一步，而不是让医生找理由跳过的负担**。

### 4.1 布局规格

```
1920×1080
├── A. 顶部状态栏 40px
├── B. 合规声明条 40px  ← --color-disclaimer-bar-bg  [!]常驻不可折叠
├── C. 确认进度区 48px（进度条 + 计数 + 「确认全部剩余项」）
├── D. AI 标记列表（自适应滚动区，行高 72px）
└── E. 底部操作栏 48px（校验提示 + 保存草稿 + 提交报告）
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 合规声明条 | **40px 固定，不可折叠** | `--color-disclaimer-bar-bg` |
| 确认进度区 | 48px | — |
| AI 标记行 | 72px | — |
| 底部操作栏 | 48px | — |
| 区块间距 | 16px | `--space-4` |

**声明条内容**：`tabler:info-circle` 16px + 「本结果为 AI 辅助标记，不构成诊断结论，须经执业医师确认」+ 右端「模型版本 total 2.18.0」+ `tabler:file-description` 「查看算法说明」。

> **模型版本号取服务端下发值，不在前端硬编码**：契约 `modelVersion`（固定 `2.18.0`）+ `weightsVersion`（形如 `totalseg-2.18.0-weights-2026-08`）。声明条显示 `modelVersion`，`weightsVersion` 放在「查看算法说明」弹窗内（权重版本号是给测评与追溯看的，不必挤占常驻条）。
>
> 契约 `AiAssist.disclosure` 是一个 **enum 固定串**「本结果为 AI 辅助标记，不构成诊断结论，须经执业医师确认」——前端**必须原样渲染**，不可自行改写或拼接。这条声明是合规要件，措辞是固定的。

> **无折叠按钮**（UIUX.md §15.3 反点击陷阱：合规声明不得是「展开才能看到」）。

### 4.2 组件树与 Token 绑定

```
SegmentationPage
├── AppHeader (40px)
├── DisclaimerBar (40px)                # --color-disclaimer-bar-bg  常驻
│   └── tabler:info-circle + 文字 + 模型版本 + 算法说明入口
├── ConfirmProgressBar (48px)
│   ├── ProgressBar                     # --space-1 高，已完成段 --color-confirm-done
│   ├── ProgressText                    # "已确认 12 / 17 项"
│   └── ConfirmAllButton                # 需二次确认弹窗
├── AiMarkList                          # 每条= 一个独立可确认行
│   └── AiMarkRow (72px)               # [!]核心组件，见下
│       ├── ItemIndex                   # ①②③ 序号，--text-xs
│       ├── StructureName               # "肝左外叶" --text-base
│       ├── QuantValues                 # 体积 214.3 mL / 置信度 94%
│       │# --font-mono tabular-nums 右对齐
│       ├── ConfirmStateBadge           # [!]三重编码，见 §4.5
│       ├── ConfirmMeta# 已确认项显示 "张×× 14:32:07"
│       ├── ModifyTrace                # 修改态显示 "8.4mm → 7.1mm" + 原因
│       └── RowActions                  # [确认] [修改]
├── TaskStatusPanel                     # AI 任务状态机，见 §4.3
└── BottomActionBar (48px)
    ├── ValidationHint                  # "还有 5 项待确认"
    ├── SaveDraftButton                 # tabler:file-pencil
    └── SubmitReportButton# tabler:send，全部确认前 disabled
└── ModifyDialog                        # 修改 AI 标记值，Modal 480px
```

### 4.3 AI 任务状态机（提交 / 进度）

| 状态 | 图标 | Token | 文案 |
|---|---|---|---|
| 排队中 | `Clock` | `--color-confirm-pending` | 「排队中，前面还有 2 个任务」+ 队列位置 |
| 运行中 | `Loader2`（旋转） | `--color-status-info` | 「正在分割肝脏与血管结构」+ 进度 % + 已耗时 |
| 已完成 | `CircleCheck` | `--color-confirm-done` | 「AI 分割完成，发现 17 个结构」+ 「医师须逐项确认后方可提交报告」 |
| 失败 | `CircleX` | `--color-status-critical` | 见 §4.3 失败态 |
| **降级** | `PlugConnectedX` | `--color-status-warning` | 「GPU 显存不足，已降级为 CPU 推理，预计 4 分 20 秒」+「分割精度可能下降，请人工复核每项结果」（AC-10） |

**模型许可白名单拒绝（AC-09 / 错误码 40003）**：

```
┌────────────────────────────────────────────────────────────┐
│ [tabler:alert-octagon] 该模型未在许可白名单内，已拒绝提交    │
│                                                              │
│ 请求模型：brain_aneurysm                                    │
│ 许可协议：CC BY-NC 4.0（非商用），不符合本院 Apache-2.0 白名单│
│ 错误码：40003│
│                                                              │
│ 可用模型（28 项）  [tabler:select 下拉选择]│
│ 本次拒绝已记入审计，可联系信息科查询           │
└────────────────────────────────────────────────────────────┘
```

**失败态（AI-SEG-2014，AC-10 / AI-02）**：

```
┌─ AI 分割结果区 ─────────────────────────────────────────┐
│ [tabler:alert-octagon] AI 分割未完成                     │
│ 失败环节：三维体数据重建                                  │
│ 错误码：AI-SEG-2014                                      │
│ 原因：序列 S4 缺少几何定位 Tag（Image Position Patient）  │
│       院内 PACS 推送时已剥离，无法重建三维体数据          │
│ 影响范围：残肝体积、残肝比、门静脉分叉分析（3 项依赖）      │
│ 未受影响：原始影像阅片、测量、报告书写（这些功能仍可用）   │
│ [强制重采样重建（精度将下降）] [联系信息科]       │
│ [tabler:alert-circle] 当前报告不含 AI 辅助标记内容        │
└──────────────────────────────────────────────────────────┘
```

**绝对禁止**：用空模型 / 0 结果 / 空白列表冒充成功。必须显示失败环节 + 错误码 + 原因 + **影响范围与未受影响范围**（让医生知道哪些结论还可用）。降级通道必须显式告知精度损失。

### 4.4 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **AiMarkList** | 3 行骨架（结构名 + 数值条） | 「本次检查未提交 AI 分割任务」+「本检查含 4 个期相（平扫/动脉/门脉/延迟），具备分割条件」+ 操作「tabler:player-play 提交分割任务」 | 「AI 标记加载失败」+ 重试 | 17 条待确认 | 结构 >50 个 → 虚拟滚动 + 按器官分组折叠；单条数值超长（如「体积 1284.567891 mL」）不撑破 |
| **ConfirmProgressBar** | 「正在读取确认状态…」 | 「已确认 0 / 0 项」（无任务时不显示此区） | 「确认状态读取失败」+ 重试 | 「已确认 12 / 17 项」+ 进度条 | 已确认数变化时数字**不跳动**（tabular-nums + 固定宽度容器） |
| **AiMarkRow** | 骨架 | — | 「该项确认状态读取失败」+ 单行重试 | 三态徽章 + 量化值 | 「已修改」项显示原值 → 新值；修改原因超长 → 2 行截断 + 展开 |
| **TaskStatusPanel** | 运行中进度 | 「尚未提交任务」 | 见 §4.3 失败态 | 见 §4.3 状态机 | 任务运行超 10 分钟（AC-08 时限）→ 追加提示「已超出 10 分钟预估，可能排队积压」+「联系信息科」 |
| **SubmitReportButton** | 提交中 `Loader2` | — | 提交失败保留草稿 + 明确原因 | 可点击 | 未全部确认时 `disabled` + `aria-disabled` + **必须显示还差几项**（不是简单置灰） |
| **DisclaimerBar** | — | — | — | 常驻 | **任何情况下不可折叠、不可关闭**（含失败态——失败时文案改为「本次检查无有效 AI 辅助标记」） |

### 4.5 三态视觉（三重编码，不可仅用颜色）

| 状态 | Token（暗色值） | 图标 | 文字 | 附加信息 |
|---|---|---|---|---|
| 待确认 | `--color-confirm-pending` `#F59E0B` | `CircleDashed` | 「待确认」 | — |
| 已确认 | `--color-confirm-done` `#3FB950` | `CircleCheck` | 「已确认」 | **确认人 + 确认时间**（归档证据） |
| 修改后确认 | `--color-confirm-modified` `#4D9DE0` | `Edit` | 「已修改」 | 原值 → 新值 + 修改原因 |

**修改态必须保留原值**（显示 `8.4mm → 7.1mm` + 「重建边界受运动伪影影响」）。这是「保留历次操作印痕」的合规要求，也是医生回头复核的依据。

### 4.6 交互规格

**行内操作（点击预算：每条只需 1 次点击）**：

| 键 | 动作 |
|---|---|
| `Enter` | 确认当前项，**焦点自动移到下一条待确认项** |
| `Shift`+`Enter` | 确认并跳到下一条（快速通道） |
| `Tab` | 在 `[确认]` `[修改]` 间移动 |
| `M` | 打开修改对话框（焦点在行上时） |
| `Ctrl`+`Enter` | 确认全部剩余项（**必须二次确认弹窗**） |

**确认全部剩余项的二次确认弹窗**：

```
┌────────────────────────────────────────────────────────────┐
│ [tabler:alert-circle] 确认剩余 5 项 AI 标记？               │
│                                                              │
│ 您将一次性确认以下 5 项：                                    │
│  ④门静脉右支    直径 11.2mm  置信度 91%                     │
│  ⑤ 肝静脉右后支  直径 8.4mm   置信度 88%                     │
│  ⑥ 胆囊          体积 32.1 mL   置信度 94%                   │
│  ⑦ 下腔静脉      直径 14.8mm  置信度 90%                     │
│  ⑧ 腹主动脉      直径 13.2mm  置信度 92%                     │
│                                                              │
│ [tabler:alert-circle] 此操作将记入操作印痕，签名后不可撤销    │
│                                                              │
│                    [取消]  [确认全部 5 项]                    │
└────────────────────────────────────────────────────────────┘
```

**状态矩阵（按钮）**：

| 元素 | Default | Hover | Focus | Active | Disabled |
|---|---|---|---|---|---|
| 确认按钮（primary） | `--color-button-primary-bg` | `-hover` | 2px focus ring | `-active` 50ms | 全部确认前**提交按钮**禁用；行内「确认」不禁用 |
| 修改按钮（secondary） | `--color-secondary-bg` + `-border` | `-hover` | 同上 | 同上 | AI 分割失败时全部禁用 |
| 确认全部（ghost） | `--color-button-ghost-text` | `--color-button-ghost-hover` | 同上 | 同上 | 已全部确认时禁用 + 文案改「已全部确认」 |

**点击热区**：行内 `[确认]` `[修改]` 各 72×32px，间距 ≥8px（`--space-2`）。整行 72px 高可点（点行空白处等同点确认？**否**——避免误确认，只有点按钮才触发）。

### 4.7 数据绑定

> 字段名以 `openapi.yaml` 为准（camelCase），DB snake_case 由后端 repositories 层转换。

| 端点（Spec §5） | 用途 | 契约字段 → UI |
|---|---|---|
| `POST /api/v1/segmentation-tasks` | 提交任务（**幂等**，需 `Idempotency-Key`） | 请求：`studyUid` / `model` / `fast`。响应：`taskId` / `status` / `modelVersion` / `weightsVersion` |
| `GET /api/v1/segmentation-tasks/{taskId}` | 轮询任务状态（建议 3s 间隔） | `status` / `progressPercent` / `degraded` / `fast` / `structures[]` / `confirmProgress` / `phaseValidation` |
| `POST /api/v1/segmentation-tasks/{taskId}/confirm` | 逐项确认（**幂等**） | 请求：`items[]`（每项 `structureName` + `action`，允许分批，≤200）。响应：`accepted` / `rejected` / `confirmProgress` / `confirmedAt` |

**`structures[]` → AiMarkRow 映射**：

| 契约字段 | UI 位置 | 格式 |
|---|---|---|
| `structureName` | 行 key（**唯一标识**） | `StructureName` 枚举 |
| `structureLabelZh` | 结构名主文案 | 中文标签，如「肝左外叶」 |
| `volumeMl` | 量化值 | mL，`--font-mono` tabular-nums 右对齐 + 单位 `--text-xs` |
| `sopInstanceUid` | 跳转影像定位（`null` 表示该结构无对应 SOP） | — |
| `confirmed` | 确认状态徽章三态 | boolean |

**`confirmProgress` → 进度区映射**：

| 契约字段 | UI | 格式 |
|---|---|---|
| `total` | 「已确认 N / M 项」的分母 | 整数，tabular-nums |
| `confirmed` | 「已确认 N / M 项」的分子 | 整数，tabular-nums |

**`phaseValidation` → 提交前置校验**：契约有独立的 `phaseValidation` 结构，提交前须核验期相。期相不符会导致 `20002`（见 §4.3 与 §3.5 的 0.70 阈值联动——置信度 <0.70 的期相组不得自动选中，正是为了避免这个拒绝）。

**关键修正 4 —— 确认请求是批量数组，不是单项**：
契约 `ConfirmSegmentationRequest.items[]` 为数组（`minItems:1, maxItems:200`），每项含 `structureName` + `action`。这与我上轮写的「请求：`item`（结构名）」不同。

**UI 含义**：单条「确认」按钮提交 `items: [{structureName, action: "confirm"}]`；「确认全部剩余项」提交 `items: [{...}, {...}, ...]`（≤200 条，一次提交）。这让「确认全部」在协议层面就是一次批量操作，与二次确认弹窗的语义一致。

**确认人归属**：`confirmedBy` **不由前端传**——契约确认请求体只含 `structureName` + `action`，确认人由服务端从会话取。响应 `confirmedAt` 用服务端时间。这符合「确认签字是归档证据」的合规要求，前端无代签空间。

**`structures[]` 的失败字段**：契约含 `code` / `failedAtStep` / `message`（如「GPU 显存不足导致推理中断，已完成 45%」），`failedAtStep` 枚举为 `precheck` / `fetch` / `preprocess` / `inference` / `stow` / `callback`。

**失败态必须显示失败环节**（对齐契约枚举，而非我上轮自拟的「三维体数据重建」）：

| `failedAtStep` | UI 文案 |
|---|---|
| `precheck` | 「前置校验失败：序列期相不完整」 |
| `fetch` | 「影像数据拉取失败：PACS 未返回完整序列」 |
| `preprocess` | 「预处理失败：体数据重建中断」 |
| `inference` | 「推理失败：GPU 显存不足，已完成 45%」 |
| `stow` | 「结果回写失败」 |
| `callback` | 「任务回调失败：结果已生成但未登记」 |

> 契约的 `message` 是面向医师的失败原因描述（可直接展示），`failedAtStep` 是机器枚举（用于归类与图标选择）。前端优先展示 `message`，用 `failedAtStep` 决定图标与归类，**不得**自造环节名。

**错误码**：

| 码 | UI 表现 |
|---|---|
| **40003** | 模型许可不在白名单 → §4.3 白名单拒绝态，**并写审计**（AC-09） |
| **20002** | 期相校验不通过（提交被拒）→ 「所选序列的期相与检查报告的期相不一致，AI 分割提交被拒」+「去确认期相」链接跳 `/viewer/:studyUid` |
| **40002** | 分割失败（契约 `structures[].code`）→ §4.3 失败态，显示 `message` + `failedAtStep` |
| 10001 | 参数错误 → 「模型参数不完整，请检查模型版本与权重号」 |
| 409（幂等冲突） | 「该任务已提交过，正在处理中」+ 跳转任务面板（不重复创建） |

> **业务分支一律看 `code`，不看 HTTP 状态码**（见 §6.7.3）。契约的 `idempotentReplay` 字段标识本次是否为幂等重放——重放时前端**不得**重复累加确认计数，直接以服务端返回的 `confirmProgress` 为准。

### 4.8 无障碍要点

1. **确认状态必须可被屏幕阅读器逐项导航**：每行 `role="listitem"` + `aria-describedby` 指向量化值与确认元信息。
2. **「已确认 N / M 项」进度变化用 `aria-live="polite"` 播报**，让键盘用户无需回看进度条。
3. **未全部确认时的阻断必须可感知**：提交按钮 `disabled` 时用 `aria-describedby` 说明「还有 5 项待确认」，不能只靠视觉置灰（`disabled` 按钮在部分屏幕阅读器中不可聚焦，需配 `aria-disabled` + 可聚焦的替代）。
4. **修改对话框焦点管理**：打开时焦点入第一个数值输入框，`Esc` 关闭但**保留原行焦点**。
5. **声明条不可折叠**（`aria-expanded` 恒false），屏幕阅读器读到时不会被跳过。
6. **降级/失败状态用 `role="alert"` 播报**，且必须包含「哪些功能仍可用」——安全信息不能只靠视觉。
7. **批量确认的危险提示**（「将记入操作印痕，签名后不可撤销」）用 `role="alertdialog"` + 焦点落在「取消」上（默认焦点在安全选项）。

### 4.9 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。声明条 40px、进度区 48px、行高 72px、底部栏 48px 全部不变 |
| 1280（笔记本） | 列表行高 72px 不变；量化值列与操作按钮同排（不换行），必要时量化值区`flex-shrink` |
| 1024（术中平板） | 行高 88px（`[确认]` `[修改]` 放大到 44px 满足触控）；量化值独占一行 |
| 768（竖屏平板） | 单列；**声明条高度自适应**（文案换行至 2 行，高 56px）——这是唯一允许声明条改变高度的情形，因为它承载合规文本不可截断 |

---

## 5. 页面 `/viewer/:studyUid/plan` — 三维规划

### 5.1 布局规格

```
1920×1080
├── A. 顶部状态栏 40px（患者名后加「三维规划」面包屑）
├── B. 左侧栏 288px
│   ├── 患者/检查信息卡（同 §3.2）
│   ├── 数据源序列列表（CT 增强 / CTA / MR）
│   └── 器械库（tabler:tool 列表）
├── C. 中部
│   ├── C1 3D 主视口（占中区 65%，--color-surface-canvas）
│   └── C2 MPR 三视图（32% 高，可折叠为底栏）
├── D. 右侧栏 320px
│   ├── 规划参数（--text-sm 12px 密排）
│   ├── 关键测量值表（体积/长度/角度，tabular-nums 右对齐）
│   └── 操作区（保存方案 / 导出 / 请求术中导航）
└── E. 底部 3D 工具条 40px
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 顶部状态栏 | 40px | `--statusbar-height` |
| 侧栏 | 288 / 320px | `--sidebar-left-width` / `--sidebar-right-width` |
| 3D 主视口 | 中区 65% | `--color-surface-canvas` |
| MPR 三视图 | 中区 32% 高 | `--color-surface-canvas` |
| MPR 分隔条 | 4px | hover 2px `--color-accent-clinical` 指示 |
| 底部工具条 | 40px | `--toolbar-height` |

### 5.2 组件树与 Token 绑定

```
PlanPage
├── AppHeader (40px)                    # 面包屑追加「三维规划」
├── SidebarLeft (288px)
│   ├── PatientInfoCard
│   ├── DataSourceList# 可选数据源，可多选
│   └── ImplantLibrary        # tabler:tool 列表
├── PlanStage
│   ├── Viewport3D                       # --color-surface-canvas
│   │   ├── SceneContent                # 骨骼/血管/器官/植入物/路径
│   │   ├── OrientationCube# tabler:box 右上角 48×48px，可拖动
│   │   └── ViewportLabel               # "3D VR"
│   ├── MprTriptych (32%)           # 横/矢/冠
│   └── Toolbar3D (40px)
├── SidebarRight (320px)
│   ├── PlanParameterPanel# --text-sm 12px 密排
│   │   ├── NumericInput × 3 (X/Y/Z 偏移)
│   │   ├── NumericInput (钉尖角度)
│   │   └── NumericInput (螺钉长度 mm)
│   ├── KeyMeasureTable                # tabular-nums 右对齐
│   └── PlanActionBar                  # 保存方案 / 导出到 PACS / 请求术中导航
└── PlanVersionBar                     # version 乐观锁提示（PLAN-01）
```

**3D 场景配色（唯一许可在 Canvas 上使用颜色的地方，因3D 模型非灰阶）**：

| 对象 | Token | 说明 |
|---|---|---|
| 骨骼 | `--color-text-secondary`灰白实体 | 高漫反射材质，模拟 X 光骨窗 |
| 血管 | `--color-phase-venous`青 | 与期相静脉色同源，形成语义一致性 |
| 器官 | `--color-accent-clinical` | 主色族 |
| 植入物 | `--color-status-abnormal` 琥珀 | 「计划中的器械」语义，与实际组织区分 |
| 手术路径 | `--color-status-warning` 虚线 + 关键点数字标记 | `tabler:route` |

> **注意**：3D 视口不适用 P2「灰阶不可侵犯」——三维重建模型本身有色彩编码需求。但**MPR 三视图仍是灰阶影像**，必须 `--color-surface-canvas` 恒暗 + 零染色层。

### 5.3 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **Viewport3D** | `Loader2` + 「正在加载三维重建…」+ 阶段提示（体数据→网格→材质） | 「当前序列尚未生成三维重建，请等待分割任务完成（剩余 40 秒）」+ 「tabler:player-play 去提交分割任务」 | 「三维重建加载失败」+ 错误码 + 「重试」/「强制重采样重建（精度将下降）」 | 模型 + 视角立方体 | WebGL 不可用 → 降级 2D 单视图（见 UIUX.md §9.10），**三维按钮全部 disabled** |
| **MprTriptych** | 三格各自骨架 | 「该序列无有效图像数据」 | 「MPR 重建失败」+ 重试 | 三平面灰阶 | 单视图模式（WebGL 降级）下折叠隐藏，Canvas 显示 2D 单图 |
| **DataSourceList** | 骨架 | 「本检查无可用于规划的数据源」+ 「需含完整期相的增强 CT 或 CTA」 | 加载失败 + 重试 | 序列多选 | 多选 >3 个 → 提示「同时加载 4 个序列可能超出显存，已按 GPU 显存自动选择前 3 个」 |
| **PlanParameterPanel** | — | 「请先在 3D 视口拾取入钉点」 | 「参数超出合理范围（螺钉长度须在 30–60mm）」 | 数值输入 | X/Y/Z 偏移超范围（±20mm）→ 错误态+ 不阻断保存（允许，但要提示） |
| **KeyMeasureTable** | 骨架 | 「尚无测量记录」+ 「选择 tabler:ruler-measure 在模型上测量」 | — | 测量列表 | 测量 >50 条 → 分组折叠 |
| **PlanActionBar** | 保存中 `Loader2` | — | **409 冲突**：「方案已被他人修改（当前版本 v3，你基于 v2）」+ 「查看差异」/「另存为新版本」/「取消」 | 可操作 | 保存中用户再次点击 → 按钮禁用而非重复提交 |

### 5.4 交互规格

**3D 视口操作**：

| 操作 | 行为 |
|---|---|
| 左键拖拽 | 旋转（`tabler:rotate-360`） |
| 右键拖拽 | 平移 |
| 滚轮 | 缩放 |
| 中键拖拽 | 窗口居中（平移至模型中心） |
| 左键点击解剖点 | **拾取入钉点**（进入规划模式时） |
| 双击结构 | 隔离显示该结构（其余降透明度至 20%） |

**快捷键**：

| 键 | 动作 |
|---|---|
| `R` | 旋转模式 |
| `H` | 平移模式 |
| `M` | 三维测量（长度/角度/距离） |
| `P` | 拾取点（入路规划） |
| `B` | 切割平面开关（`tabler:axis-x`） |
| `V` | 结构显隐切换 |
| `1` `2` `3` `4` | 布局：3D 主视 / MPR 主视 / 并排 / 3D+MPR 四宫格 |
| `Ctrl`+`S` | 保存方案 |
| `Q` `W` `E` | 快速视角：前/后/左（正交快捷轴向） |
| `Shift`+`0` | 重置视角 |

**乐观锁提示（PLAN-01 / P1）**：Spec 锁定 PLAN-01 为预留功能，v1.0 仅 `version` 乐观锁 + 操作日志。UI 表达：

```
┌────────────────────────────────────────────────────────────┐
│ [tabler:alert-circle] 方案已被他人修改                      │
│ 当前服务器版本 v3（张×× 14:22:10 修改），你基于 v2 编辑│
│ [查看差异]  [另存为新版本]  [放弃我的修改并加载 v3]         │
└────────────────────────────────────────────────────────────┘
```

**点击热区**：3D 工具条按钮 40×40px；视角立方体 48×48px；参数区 NumericInput 32px 高 × 外扩 44px 热区。

### 5.5 数据绑定

> 字段名以 `openapi.yaml` 为准（camelCase），DB snake_case 由后端 repositories 层转换。

| 端点（Spec §5） | 用途 | 契约字段 → UI |
|---|---|---|
| `POST /api/v1/plans` | 保存规划方案（**幂等**） | 请求：`studyUid` / `planType` / `title` / `payload`。响应：`planId` / `version` |
| `PUT /api/v1/plans/{planId}` | 更新（带**顶层** `version`，冲突返 `409` / `20003`） | 同上 |
| —（本地） | 3D 渲染 | 模型来自 `/segmentation-tasks` 产出的 mask |

**payload → UI 映射**（契约 `PlanPayload`，必填 `entry` + `target`，其余为科室扩展键）：

| payload 键 | UI | 状态 |
|---|---|---|
| `entry.patientXYZmm` | 入路点坐标 → 3D 标记点 + 参数面板 X/Y/Z | **必填** |
| `entry.orientation` | 入路方位（8 枚举：anterior/posterior/posterolateral_right/posterolateral_left/lateral_right/lateral_left/superior/inferior） | 契约已有 |
| `entry.label` | 入点标签（如「L1 入钉点」） | 契约已有 |
| `target.patientXYZmm` | 靶点坐标 → 路径终点 | **必填** |
| `target.structureName` | 靶点解剖结构（`StructureName` 枚举，见下） | **必填** |
| `target.label` | 靶点标签 | 契约已有 |
| `approachAngleDeg` | 入路角度（0–90 度） | 契约已有 |
| `corridorWidthMm` | 手术通道宽度（mm） | 契约已有 |
| `avoidanceStructures[]` | 需避开的解剖结构 → 3D 高亮警示环 | 契约已有 |
| `notes` | 规划备注（自由文本，≤1000 字） | 契约已有 |
| `screws[]` | 螺钉数组 → 琥珀实体 + 参数面板（直径/长度/角度） | 科室扩展键 |
| `path[]` | 手术路径点 → `tabler:route` 虚线 + 关键点数字 | 科室扩展键 |
| `measurements[]` | 测量值 → KeyMeasureTable | 科室扩展键 |

**`version` 已从 payload 移除**（见 §6.7.2）：统一读**顶层** `version`（`UpdatePlanRequest.version`，必填，冲突返 `20003`）。payload 内若再放 version 会造成两个同名值，取错即静默并发覆盖。

**`structureName` 必须用契约 `StructureName` 枚举，下拉不允许自由输入**：枚举取自 TotalSegmentator 2.18.0 结构类别名（`liver` / `liver_left_lobe` / `portal_vein` / `aorta` / `lung_left` / `gallbladder` / `urinary_bladder` …）。契约 schema 注释明写「这是解剖结构名，**不是病灶名，更不是诊断结论**」——用枚举从数据结构上阻断「把病灶塞进结构字段」。

> **待架构师确认**：`StructureName` 当前枚举为腹部/胸部结构集，**不含脊柱**（无 `vertebra_*`）。骨科规划若需脊柱结构标识，属契约枚举扩展范围，设计上先按现有枚举实现，脊柱结构暂走科室扩展键承载。

**payload 内禁止结论性字段**（病灶性质 / 疗效评价 / 术式建议）：与 AI 合规边界同源（Spec §3「AI 病灶性质判定 / 治疗建议」明确不做）。因此规划备注 `notes` 输入框**不提供**结论性预设模板，也不做 AI 自动填充建议——纯自由文本。

**错误码**：

| 码 | UI |
|---|---|
| **20003**（HTTP 409） | 版本冲突 → §5.4 乐观锁提示，**不得静默覆盖** |
| **50003**（HTTP 409） | 报告已签名，plan_payload 一并锁定 → §6.7.3 |
| **50004**（HTTP 409） | 方案已归档，修改需医务部门审批凭证 → §6.7.3 |
| 10001 | 「规划数据格式错误，请检查入钉点坐标」 |
| 10003 | 「您的角色无规划权限（需手术科室医师或以上）」 |

> **业务分支一律看 `code`，不看 HTTP 状态码**——409 有三种语义（见 §6.7.3）。

### 5.6 无障碍要点

1. **3D 视口的等价文本**：3D 模型无法用 `role="img"` 表达。必须提供「结构清单」列表——每个结构（肝左外叶/门静脉右支/下腔静脉…）作为列表项，可 Tab 聚焦，聚焦时**对应结构在 3D 中高亮描边**并播报量化值。这是 3D 可访问性的核心手段。
2. **测量值列表是 3D 测量的文本等价物**，屏幕阅读器可完整读出所有测量值。
3. **视角立方体可键盘操作**：`Q`/`W`/`E` + 方向键，焦点在立方体上时 `aria-label` 播报当前视角（「前位」/「左侧位」/「足位」）。
4. **乐观锁冲突用 `role="alertdialog"`**，焦点落在「取消」（安全选项），并播报「方案已被他人修改，当前版本 v3」。
5. **参数输入错误用 `aria-describedby`**，错误文案具体（「螺钉长度须在 30–60mm 之间」，不是「输入无效」）。
6. **降级态不静默**：WebGL 不可用时三维入口 `disabled` + tooltip 说明原因 + 琥珀警示条（AC-06）。

### 5.7 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。3D 主视口 65% / MPR 32% 比例不变；侧栏 288/320px 不变。分辨率提升只让 3D 渲染更细腻（更多采样），**UI 尺寸恒定** |
| 1280（笔记本） | 3D 主视口 + MPR 改为上下（3D 60% / MPR 40%），侧栏折叠 |
| 1024（术中平板） | **单任务模式**：3D 与 MPR 二选一，用 `tabler:layout-grid` 切换；触控手势：双指旋转/缩放，单指平移；参数面板转底部抽屉 |
| 768（竖屏平板） | 仅 3D 单视口 + 参数底部抽屉；**P1 预留功能（PLAN-01 入路标注）在平板上保持可用**，但「请求术中导航」按钮禁用（v2.0+ 才做） |

---

## 6. 页面 `/reports/:reportId` — 报告编辑与签名

### 6.1 布局规格

```
1920×1080
├── A. 顶部状态栏 40px（患者/检查标识与阅片页一致 [!]防写错患者）
├── B. 报告工具条 40px（模板选择 / 保存 / 提交审核 / 签名）
├── C. 左侧模板树 264px
├── D. 中部编辑器（自适应）
│   ├── D1 受控字段区（5 类，签名阻断项）
│   ├── D2 检查所见（富文本，--text-md 14px / line-height 1.7）
│   ├── D3 诊断意见
│   ├── D4 危急值提示条（命中时插入）
│   └── D5 底部状态条 32px（自动保存时间 / 字数 / 口述状态）
└── E. 右侧 AI 建议 320px
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 顶部状态栏 | 40px | `--statusbar-height` |
| 报告工具条 | 40px | `--toolbar-height` |
| 左侧模板树 | 264px | 固定 |
| 右侧 AI 建议 | 320px | `--sidebar-right-width` |
| 编辑器正文 | 14px / 1.7 | `--text-md`（长文本可读性优先于紧凑） |
| 底部状态条 | 32px | — |
| 区块间距 | 16px | `--space-4` |

### 6.2 组件树与 Token 绑定

```
ReportPage
├── AppHeader (40px)                    # [!]患者标识与阅片页完全一致
├── ReportToolbar (40px)
│   ├── TemplateSelect                # tabler:file-type-txt
│   ├── SaveDraftButton               # tabler:file-pencil
│   ├── SubmitReviewButton            # tabler:send
│   └── SignButton                    # tabler:signature，primary
├── TemplateTree (264px)
│   └── TemplateNode                  # 行高 32px，勾选态
├── EditorArea
│   ├── ControlledFieldGroup          # [!]5 类受控字段（契约 structuredFields）
│   │   ├── ReadonlyField × 2        # examBodyPart / scanMode
│   │   │# --color-readonly-bg + --color-readonly-border + tabler:lock
│   │   └── ControlledField × 3      # findings / impression / followUpRecommendation
│   ├── FindingsEditor                # --text-md / 1.7  用于报告正文分段
│   │   └── FindingSection × N        # 每段: label + 文本区
│   ├── ImpressionEditor              # 含 authoredBy（服务端写入）
│   ├── FollowUpEditor                # 含 authoredBy
│   ├── CriticalValueBanner# 命中时插入，不可忽略
│   └── EditorStatusBar (32px)
│       ├── AutoSaveStatus            # tabler:device-floppy + "已自动保存 14:32:07"
│       ├── WordCount                 # tabular-nums
│       └── DictationStatus           # tabler:device-speaker
├── AiSuggestionPanel (320px)
│   ├── AiNoduleAnalysis              # tabler:brain
│   ├── AiHistoryComparison           # tabler:timeline-event
│   └── AiDisclaimer                # tabler:info-circle（契约 AiAssist.disclosure 原样渲染）
├── SignatureDialog                   # Modal Wide 720px，见 §6.5
└── SignedLockOverlay# [!]签名后启用
    # --color-lock-overlay + tabler:lock + 「已签名锁定」
```

### 6.3 受控字段（5 类，AC-12 签名阻断项）

Spec RPT-01 锁定「5 类受控字段，字段缺失阻断签名」。**以契约 `structuredFields` 为准**（`required: [examBodyPart, scanMode, findings, impression, followUpRecommendation, aiAssist]`）：

| # | 契约字段 | UI 名称 | 组件 | 可编辑 | 缺失时 |
|---|---|---|---|---|---|
| 1 | `examBodyPart` | 检查部位 | 只读文本 | **否**（由 `study.bodyPart` 自动带入） | 阻断签名 |
| 2 | `scanMode` | 扫描方式 | 只读文本 | **否**（自动带入） | 阻断签名 |
| 3 | `findings[]` | 检查所见 | **分段编辑器**（`FindingSection[]`） | 是 | 阻断签名（至少一段非空） |
| 4 | `impression` | 影像诊断意见 | 单段文本 + 作者署名 | 是 | 阻断签名 |
| 5 | `followUpRecommendation` | 建议随访 | 单段文本 + 作者署名 | 是 | 阻断签名 |

**修正说明**：我上轮写的 5 类是「检查所见 / 诊断意见 / 影像诊断医师 / 审核医师 / 报告日期」——**与契约不符**。契约里 `author`（报告医师）、`reviewer`（审核医师）、`reportTime`（报告时间）是**独立顶层字段**，不在 5 类受控字段内，但它们同样参与签名阻断（`reviewer` 缺失时按 `50001` 未审核不可签名）。**UIUX.md §6.3 的受控字段表需同步修正**（见 §9 变更记录）。

**缺失项文案由服务端下发**：契约在缺字段时返回 `code 10001` + `data.missingFields`。前端**直接渲染该清单**，不自行推断「哪些字段该填」——避免前端与后端对「必填」的理解漂移。

**受控字段视觉**：自动带入的只读字段用 `--color-readonly-bg` + `--color-readonly-border`，配 `tabler:lock` 16px 标识「自动带入，不可编辑」。**这是与签名锁定态不同的语义**——前者是「来源权威」，后者是「流程冻结」，两者不可共用同一视觉。

**作者署名**：`impression` 与 `followUpRecommendation` 各带 `authoredBy`（署名医师）。医师改写这两段时，`authoredBy` 由服务端按会话写入——**前端不提供署名选择器**，避免冒名代写。

### 6.4 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **FindingsEditor**（分段） | 骨架段落 4 段（每段一个 label + 文本区） | 「报告尚未创建」+「选择模板并开始书写」+「tabler:report-medical 从 AI 建议引用开始」 | 「草稿加载失败」+「重试」+「本地缓存草稿 HH:MM:SS」 | 分段正文 + 底部状态条 | 段落 >8 段 → 段标签横向滚动 + 「折叠未修改段」；单段 >5000 字 → 该段内滚动 + 字数提示；粘贴超长文本 → 「已粘贴 3200 字，是否插入当前位置？」 |
| **FindingSection**（单段） | 骨架 | 「本段暂无内容」+「tabler:sparkles 从 AI 建议引用」 | 「本段保存失败」+ 单段重试 | 段落文本 + 段标签（`key` 决定窗位，`label` 显示） | 段被删除 → 段位显示「（未填写）」并计入缺失项 |
| **ControlledField** | 骨架 | 「未选择」+ 占位（非 label 替代） | 「加载医师列表失败」+ 重试 | 已选 | 审核医师 = 报告医师时，提示「医师不得审核本人报告」（合规约束） |
| **AiSuggestionPanel** | 骨架卡片 | 「本检查无 AI 分析结果」+「可提交 AI 分割任务以获得量化参考」 | 「AI 结果加载失败」+ 重试 | 结节分析 + 历史对比 + 免责 | AI 与报告正文冲突时（「结节 8mm」vs AI「6mm」）→ 显示「数值不一致」提示但**不自动覆盖医生文本** |
| **AutoSaveStatus** | 「正在保存…」+ `Loader2` | — | 「自动保存失败（网络中断），草稿保留在本地」+ `tabler:alert-triangle` +「立即重试」 | 「已自动保存 14:32:07」+ `tabler:device-floppy` | 保存中用户继续输入 → 合并为一次保存请求（防请求风暴）；`字 186` 用 tabular-nums 不跳动 |
| **SignButton** | 签名中 `Loader2` +「正在签名…」 | 未满足条件时 `disabled` + 显示缺失项 | 见 §6.5 五类错误 | 可点击 | 签名中用户编辑正文 → 签名请求自动作废，提示「正文已变更，签名需重新发起」 |
| **CriticalValueBanner** | — | — | — | 命中时显示，不可忽略 | 命中多条 → 「本报告涉及 2 项危急值，签名前请确认已电话通知临床科室」；通知记录需勾选确认 |
| **SignedLockOverlay** | — | — | — | 签名后启用 | 锁定后尝试编辑 → 拦截 + tooltip「报告已于 2026-10-22 14:35:22 由张××签名，修改需走报告更正流程」；`signatureValid=false` 时改用签名失效态（§6.5） |

> **`findings` 是分段数组**（契约 `FindingSection[]`，见 §6.7 关键修正 1），因此编辑器不是一个富文本框，而是**多个按窗位/期相分段的编辑区**。状态矩阵中 `FindingsEditor` 与 `FindingSection` 分列两层：前者管容器与空/错/载，后者管单段的填写与校验。

### 6.5 电子签名流程（COM-01 / AC-13 / AC-14）

**SignatureDialog（Modal Wide 720px）**：

```
┌──────────────────────────────────────────────────────────────────┐
│ 电子签名                                     [tabler:signature]   │
├──────────────────────────────────────────────────────────────────┤
│ 待签内容摘要                                                       │
│  患者：张××  女  52 岁    检查号：ACC20261022017                   │
│  检查：腹部平扫+三期增强CT        报告日期：2026-10-22              │
│                                                                  │
│  正文摘要（SM3 · 本次签名绑定值）                                  │
│  7f3a9c1e5b2d8409 6a3f1c8e7d5b2a40  …                             │
│  [tabler:copy] 复制                                                  │
│  ▸ 归档交叉比对值（SHA-256）                                       │
├──────────────────────────────────────────────────────────────────┤
│ 签名方式  [UKey 数字证书] [工牌口令] [手写板]│
│  （tab 页，默认 UKey —— Spec §0 锁定双因素含 UKey）                 │
│                                                                  │
│  UKey 状态：tabler:usb 已检测到 UKey（序列号 4A:27:••:••:9E）      │
├──────────────────────────────────────────────────────────────────┤
│ [tabler:alert-octagon] 报告签名后不可修改，将作为医疗文书归档       │
│ 签名后正文任何变更将使本签名立即失效（AC-14）                       │
│ 签名时间以院内 NTP 为准（AC-15）                                   │
├──────────────────────────────────────────────────────────────────┤
│                          [取消]  [确认签名]                        │
└──────────────────────────────────────────────────────────────────┘
```

> **摘要展示决策与理由见 §6.7.1**：主行显示 SM3（真正参与签名运算的那一个），SHA-256 折叠为副行（归档交叉比对用）。「本次签名绑定值」这行标注**必须出现**，否则医师无法判断两个摘要谁在起作用。

**签名前置校验（任一不满足则签名按钮 disabled + 列出全部缺失项）**：

| # | 校验 | 缺失提示 |
|---|---|---|
| 1 | 5 类受控字段完整（AC-12） | 「未完成：诊断意见、建议随访」（按契约 `structuredFields` 实际缺失项列举） |
| 2 | AI 标记全部确认（AC-11） | 「还有 5 项 AI 标记待确认」+「去确认」链接跳 `/segmentation` |
| 3 | UKey 已插入且证书匹配 | 「未检测到 UKey 数字证书」 |
| 4 | NTP 时间偏移在阈值内（AC-15） | 「院内时间与本机时间偏差 47 秒，请校准后重试」 |
| 5 | 报告已审核（契约 `50001`） | 「报告尚未通过审核，无法签名」+「查看审核状态」 |

> 校验 1 的缺失项文案由后端 `data.missingFields` 返回，**前端不自行推断哪些字段该填**——契约在缺字段时返回 `code 10001` + `data.missingFields`，前端直接渲染该清单。

**三类签名错误**：

| 场景 | 契约码 | 文案 | 附加 |
|---|---|---|---|
| NTP 偏移超阈值 | — | 「院内时间校准失败，签名被拒绝」+ 错误码 | **绝不用本地时间兜底**（AC-15 明确禁止）；提供「重新校时后重试」 |
| 报告已签名（重复签名） | `50003` | 「报告已由张××于 2026-10-22 14:35:22 签名，正文与规划方案一并锁定」 | 「查看已签名报告」；不提供「覆盖签名」 |
| 未审核不可签名 | `50001` | 「报告尚未通过审核，无法签名」 | 「查看审核状态」 |
| AI 标记未全确认 | `20002` | 「还有 5 项 AI 标记待确认」 | 「去确认」 |
| CA/密码机不可用 | — | 「签名服务不可用（CA 证书链校验失败）」+ 联系信息科 | 不降级为「仅保存」 |

**二次确认**：点「确认签名」后再弹一层确认（Modal Default 480px），展示不可逆后果 +「确认签名并归档」/「返回」。二次确认层必须复述**摘要前 16 位**（医师在最后一步仍需核对是同一份正文），不重复展示患者信息（避免第二处患者标识源）。

**签名成功后**：

- 报告转**只读**：所有可编辑区 `--color-readonly-bg` + `--color-readonly-border` + `tabler:lock`
- `--color-lock-overlay` 覆盖层拦截编辑（`pointer-events` 仅允许选中复制）
- 底部状态条：`tabler:signature` + 「已签名 张×× / 2026-10-22 14:35:22」+ `tabler:file-certificate`「签名有效」
- 签名记录写 `signature_logs`（Spec §6：流水号 / 原文唯一序列号 / 服务主体标识 / 原文摘要值 / 摘要算法 / 证书序列号 / 签名数据，WS/T 847—2024 要求）→ 契约字段 `signature.serialNo` / `documentUniqueSn` / `subjectId` / `digestValue` / `digestAlgorithm` / `certSerial` / `signatureValue`

**签名失效态（`signatureValid = false`，此前遗漏，现补）**：

```
┌─ 报告锁定遮罩 ─────────────────────────────────────────────────┐
│ [tabler:alert-triangle] 原签名已失效                            │
│                                                                  │
│ 报告正文在 2026-10-22 15:02:11（张×× 补录延迟期所见）发生变更，│
│ 原签名已按 AC-14 自动失效。当前签名：无效（signatureValid=false）│
│ 变更内容：新增「延迟期」段落（门脉期 8.4mm → 7.1mm）              │
│                                                                  │
│ [tabler:signature] 重新签名                [tabler:history] 变更痕迹 │
└──────────────────────────────────────────────────────────────────┘
```

**这是与「正常已签名」完全不同的态**：正常已签名用中性锁定色 + `tabler:lock`；签名失效用 `--color-status-critical-subtle` + `tabler:alert-triangle` + 「**原签名已失效**」文字（三重编码）。混淆两者会让医师以为签名还有效，而它已经失效。

### 6.6 交互规格

**快捷键**：

| 键 | 动作 |
|---|---|
| `Ctrl`+`S` | 保存草稿 |
| `Ctrl`+`Enter` | 提交审核 |
| `Ctrl`+`Alt`+`S` | 打开签名对话框 |
| `Ctrl`+`Shift`+`D` | 切换语音口述 |
| `Tab` | 字段间移动（**必须完全可达**） |
| `Esc` | 关闭签名/引用浮层 |
| `Ctrl`+`Z` / `Ctrl`+`Y` | 撤销 / 重做 |

> **单键快捷键在报告页全部禁用**（`D`、`S`、`A` 等都不能用），因为它们是输入法的键。报告页只用组合键。

**状态矩阵（签名按钮）**：

| 状态 | Token |
|---|---|
| Default | `--color-button-primary-bg` |
| Hover | `--color-button-primary-hover` |
| Focus | 2px `--color-focus-ring` outline |
| Active | `--color-button-primary-active`，50ms `--motion-instant` |
| **Disabled** | `aria-disabled` + `cursor:not-allowed` + **必须显示缺失项清单**（不是简单置灰） |
| Loading | 左侧 `Loader2` +「正在签名…」+ `aria-busy` |

**点击热区**：工具条按钮 40×40px；模板树行 32px 高 × 264px 宽（密集树，可接受 <44px，因非触控主场景，但平板下自动放大至 44px）；AI 建议卡「采纳」/「否决」各 88×32px。

### 6.7 数据绑定

> 字段名以 `openapi.yaml` 为准（camelCase），DB 的 snake_case 由后端 repositories 层转换，前端**不感知**。

| 端点（Spec §5） | 用途 | 契约字段 → UI |
|---|---|---|
| `GET /api/v1/reports/{reportId}` | 获取报告 | `structuredFields` → 受控字段区；`lockState` → SignedLockOverlay；`signature` → 签名状态条；`revisionHistory` → 修改痕迹 |
| `POST /api/v1/reports/{reportId}/sign` | 电子签名（**幂等**） | 请求：`reportVersion` / `digestAlgorithm` / `ukeyCertSerial` / `nonce` / `signatureValue`。响应：`signature` 对象 |

**签名请求体（契约 `SignReportRequest`，`required` 五项）**：

| 契约字段 | 来源 | UI 关系 |
|---|---|---|
| `reportVersion` | 取当前 `GET` 返回的 `version` | **防止签了旧版**——若签名期间正文被改，服务端比对 `reportVersion` 不符返 `10001` |
| `digestAlgorithm` | 固定 `SM3` | 契约 enum 锁定，前端不自由选 |
| `ukeyCertSerial` | UKey 内证书序列号 | 与检测到的 UKey 一致 |
| `nonce` | 服务端下发或前端生成（契约 `^[0-9a-f]{32}$`） | 每次签名唯一，防重放 |
| `signatureValue` | UKey 内私钥对 `SM3(nonce ‖ reportId ‖ reportVersion ‖ bodyDigest)` 的 SM2 签名（Base64 DER） | **私钥不出 UKey**，前端只负责把待签串交给 UKey 硬件运算 |

**关键修正 5 —— `reportVersion` 是签名请求的必填项**：契约明确「与服务端当前版本不一致 → `code 10001`（防止签了旧版）」。这意味着签名对话框打开时必须**冻结**当前 `version`，签名提交时带上它。若用户在别处改了报告导致版本漂移，签名会被拒——这是防「签的不是我看到的」的保护。UI 上表现为：签名失败提示「报告已被修改，请重新打开签名对话框确认最新内容」。

**`GET /reports/{reportId}` 响应 → UI 精确映射**：

| 契约字段 | UI 位置 | 格式 |
|---|---|---|
| `reportId` | URL 参数，不显示 | — |
| `studyUid` | 「查看影像」链接参数 | — |
| `version` | 乐观锁版本（保存时回传） | 整数 |
| `status` | 报告状态 | 枚举 |
| `templateCode` | 模板标识（不显示，仅内部） | — |
| `patient` / `visit` / `study` | 顶部 AppHeader 患者标识 | — |
| `structuredFields.examBodyPart` | 受控字段 1（**只读**，`--color-readonly-bg`） | 「上腹部」 |
| `structuredFields.scanMode` | 受控字段 2（**只读**） | 「腹部平扫+三期增强CT」 |
| `structuredFields.findings[]` | 检查所见编辑器（**分段数组**，见下） | `FindingSection[]` |
| `structuredFields.impression` | 诊断意见编辑器 | `SignedImpression{text, authoredBy}` |
| `structuredFields.followUpRecommendation` | 建议随访编辑器 | `FollowUpRecommendation{text, authoredBy}` |
| `structuredFields.aiAssist` | AI 建议面板 + 声明条 | 见下 |
| `lockState.state` | 锁定遮罩状态机 | `DRAFT`/`PENDING_REVIEW`/`SIGNED`/`ARCHIVED` |
| `lockState.editable` | **是否可编辑（权威，前端据此禁用，不自行推导）** | boolean |
| `lockState.reason` | 锁定原因（遮罩上显示可读说明） | `SIGNED_LOCKED` 等 |
| `lockState.signatureValid` | **签名是否仍成立（独立第二维）** | boolean |
| `lockState.lockedAt` | 签名状态条时间 | tabular-nums |
| `lockState.lockedScope` | 锁定范围 | `["report_body","plan_payload"]` |
| `signature.serialNo` | 签名流水号 | `SN-2026-10-22-000117`（WS/T 847） |
| `signature.certSerial` / `certIssuerName` | 签名详情 | — |
| `bodyDigestAlgorithm` / `bodyDigest` | 签名对话框摘要（见 §6.5 决策） | SM3 |
| `bodySha256` | 摘要（见 §6.5 决策） | SHA-256 |
| `revisionHistory[]` | 修改痕迹 | `ReportRevision[]` |

**关键修正 1 —— `findings` 是分段数组，不是单个富文本**：
契约 `structuredFields.findings` 为 `FindingSection[]`，每段含 `key`（段落键）/ `label`（段落显示名）/ `windowType` / `text`。这意味着检查所见编辑器是**分段式**的——每段对应一个窗位或期相，UI 需为每段提供独立编辑框，而不是一个大富文本框。

| 契约 `key` | UI 段落标签（默认，来自模板） | 建议的窗位 |
|---|---|---|
| `plain` | 平扫 | 腹窗 |
| `arterial` | 动脉期 | 腹窗 |
| `portal` | 门脉期 | 腹窗 |
| `delayed` | 延迟期 | 腹窗 |
| `lung_window` | 肺窗 | 肺窗 |
| `mediastinum_window` | 纵隔窗 | 纵隔窗 |
| `bone_window` | 骨窗 | 骨窗 |
| `coronal_sagittal` | 冠状/矢状重建 | 软组织窗 |
| `other` | 其他 | 由 `label` 决定 |

`label` 与 `key` 分离的意义：**key 是模板契约（稳定），label 是显示名（可本地化）**。前端**不得**用 `label` 做业务判断（会因科室改模板而破），一律用 `key`。段落 `label` 可由科室模板覆盖。

**关键修正 2 —— 受控字段是 5 类，但与我上轮写的不同**：
契约定义 `structuredFields` 的 5 类受控字段为 `examBodyPart` / `scanMode` / `findings` / `impression` / `followUpRecommendation`。其中前两类是**自动带入且不可编辑**（只读底色），后三类由医师填写。我上轮写的「报告医师 / 审核医师 / 报告日期」不在这 5 类之内——它们由契约以 `author` / `reviewer` / `reportTime` 单独承载，缺失时按 `50001`（未审核不可签名）阻断。**UIUX.md §6.3 的受控字段表需同步修正**（见 §9 变更记录）。

**关键修正 3 —— 锁定状态是两维的，不是一维的**：
契约明确 `lockState` 有两个独立维度：`state`/`editable` 回答「**能不能改**」，`signatureValid` 回答「**签名还成不成立**」。二者组合出三种前端必须分别处理的情形：

| `state` | `editable` | `signatureValid` | UI 表现 |
|---|---|---|---|
| `SIGNED` | false | true | 正常已签名态：遮罩 + 「已签名锁定，不可修改」 |
| `SIGNED` | false | **false** | **签名已失效**（正文被改过）：遮罩色改为 `--color-status-critical-subtle` + `tabler:alert-triangle` + 「**原签名已失效**（报告正文在签名后发生变更），请重新签名」+「重新签名」按钮（`tabler:signature`） |
| `ARCHIVED` | false | true | 归档态：`tabler:archive` + 「报告已归档，修改需医务部门审批」+ `code 50004` |

**`signatureValid = false` 是新增的关键 UI 态**（此前我只设计了「已签名锁定」，没有「签名已失效」）。它必须与「正常已签名」视觉可区分——前者用危急值色 + `AlertTriangle` + 明确文字，后者用中性锁定色 + `Lock` 图标。否则医生会以为自己的签名还有效，而它已经失效了（AC-14）。

**签名后不可编辑的技术表达**：`lockState.editable` 是服务端权威判定，前端**不得**用本地 `signed_at` 或 `state` 自行推导（契约 schema 注释明确禁止）。前端拿到 `editable = false` 即渲染 `SignedLockOverlay`。

**卫健委电子病历必备字段覆盖**（Spec §6）：患者基本信息（`patient`）/ 就诊信息（`visit`）/ 检查所见（`structuredFields.findings`）/ 诊断意见（`structuredFields.impression`）/ 报告医师（`author`）/ 审核医师（`reviewer`）/ 报告时间（`reportTime`）/ 修改痕迹（`revisionHistory`）——全部落位。

### 6.7.1 摘要展示决策（SM3 vs SHA-256）

架构侧提出：签名对话框展示 SM3 前 16 位还是 SHA-256 前 16 位？

**我的决策：签名对话框主展示 SM3（即 `bodyDigest`），SHA-256 作为副行折叠展示。**

理由：

1. **SM3 才是签名真正绑定的值**。SM2 签名算法内部固定使用 SM3 摘要，无法改为对 SHA-256 签名（契约 schema 已注明）。给医师看一个不参与签名运算的摘要，会让「我看到的摘要」与「验签用的摘要」不一致——这在合规纠纷时是要命的。
2. **但 AC-13 的字面要求是 SHA-256**，且 SHA-256 是与既有 HIS/EMR 交叉比对的通用值。完全隐藏它会让院内其他系统无法与本系统对账。
3. 因此：**主行显示 SM3**（参与签名的那一个），**副行折叠显示 SHA-256**（标注「归档交叉比对值」，默认收起）。

签名对话框摘要区改为：

```
│ 待签内容摘要                                                       │
│  患者：张××  女  52 岁    检查号：ACC20261022017                   │
│  检查：腹部平扫+三期增强CT        报告日期：2026-10-22              │
│                                                                  │
│  正文摘要（SM3 · 本次签名绑定值）                                  │
│  7f3a9c1e5b2d8409 6a3f1c8e7d5b2a40  …                             │
│  [tabler:copy] 复制                                                  │
│  ▸ 归档交叉比对值（SHA-256）                                       │
│                                                                  │
│  [tabler:alert-octagon] 报告签名后不可修改，将作为医疗文书归档       │
│  签名后正文任何变更将使本签名立即失效（AC-14）                       │
│  签名时间以院内 NTP 为准（AC-15）                                   │
```

**「签名绑定值」这四个字必须出现在界面上**，否则医师无法判断两个摘要谁在起作用。折叠行默认收起，避免制造「有两个摘要，出问题了」的困惑。

> 我对架构师原方案的修正建议已发出：**不建议只留一个字段**。两个摘要都存、两个都能取到，差别只在 UI 呈现的主次。

### 6.7.2 计划 payload 的 version 归属（架构师提问的确认）

架构师问：payload 里的 `version` 键与 plans 顶层 `version` 冲突怎么办？

**我的确认：从 payload 中移除 `version`，统一读顶层 `version`。**

理由：契约 `UpdatePlanRequest.version` 是**顶层必填**的乐观锁字段，缺失返 `10001`，不一致返 `409 / 20003`。payload 里再放一个 `version` 会让前端有两个都叫 version 的值，取错就是静默的并发覆盖——这正是 ADR-006 选择乐观锁要避免的失败模式。

**PlanVersionBar 改为读顶层 `version`**（契约 `ReportLockState.version` 同理，也是顶层）。

同时按契约调整 payload 键名（契约 `PlanPayload` 要求 `entry` + `target`，其余键允许科室扩展）：

| 契约 payload 键 | UI 语义 | 状态 |
|---|---|---|
| `entry`（必填） | 入路点/入钉区。含 `patientXYZmm`（患者 DICOM 坐标系 mm）、`orientation`（8 枚举：anterior/posterior/posterolateral_right/…）、`label` | **必填**，3D 渲染入路锥体依据 |
| `target`（必填） | 靶点。含 `patientXYZmm`、`structureName`、`label` | **必填**，3D 渲染目标结构与路径终点 |
| `approachAngleDeg` | 入路角度（0–90 度） | 契约已有 |
| `corridorWidthMm` | 手术通道宽度（mm） | 契约已有 |
| `avoidanceStructures[]` | 需避开的解剖结构（`StructureName` 枚举） | 契约已有 |
| `notes` | 规划备注（医师自由文本，≤1000 字） | 契约已有 |
| `screws[]` | 骨科扩展键（螺钉明细） | 科室扩展键 |
| `path[]` | 胸外扩展键（路径点） | 科室扩展键 |
| `measurements[]` | 测量值 | 科室扩展键 |

**`structureName` 用契约的 `StructureName` 枚举，不自造**：枚举取自 TotalSegmentator 2.18.0 结构类别名（`liver` / `portal_vein` / `aorta` / `lung_left` …）。**这天然阻断了「把病灶名塞进结构字段」**——`StructureName` 的 schema 注释明写「这是解剖结构名，不是病灶名，更不是诊断结论」。前端下拉必须**只能选枚举值，不允许自由输入**。

> 注意：`StructureName` 枚举当前为腹部/胸部结构集，**不含脊柱**（`vertebra_*` 未列出）。骨科规划若需脊柱结构标识，属契约枚举扩展范围，需架构师确认是否补枚举——**这不是前端能自行决定的**，我已就此发问。设计上先按现有枚举实现，脊柱结构走 `avoidanceStructures` 之外的科室扩展键承载。

**结论性字段禁令**：payload 内禁止出现病灶性质、疗效评价、术式建议等结论性字段。这条与 AI 合规边界同源（Spec §3「AI 病灶性质判定 / 治疗建议」不做），前端在「规划备注 `notes`」输入时**不得**提供结论性预设模板或 AI 自动填充建议——只提供自由文本。

### 6.7.3 409 的三种语义（架构师提示的分支规则）

业务分支**一律看响应体 `code`，不看 HTTP 状态码**。409 有三种语义，前端须分别处理：

| `code` | 语义 | UI |
|---|---|---|
| `20003` | 乐观锁版本冲突 | §5.4 乐观锁提示：「方案已被他人修改（当前版本 v3，你基于 v2）」+「查看差异」/「另存为新版本」/「放弃我的修改并加载 v3」 |
| `50003` | 报告已签名（含 plan_payload 一并锁定） | 报告页：「报告已于 2026-10-22 14:35:22 由张××签名，正文与规划方案一并锁定，修改需走报告更正流程」+「查看已签名报告」 |
| `50004` | 方案已归档，修改需医务部门审批凭证 | 「方案已归档（2026-10-20），修改需医务部门审批凭证」+「申请审批」+「查看归档版本」 |

**`50003` 的范围提示要写进 UI**（契约 `lockedScope: ["report_body","plan_payload"]`）：报告签名后**规划方案一并锁定**，医生在规划页遇到 50003 时，提示语要说清「是报告签名导致的」，否则会以为是规划系统故障。

### 6.8 无障碍要点（本页特有）

1. **表单错误播报**：签名前置校验失败时，用 `role="alert"` + `aria-live="assertive"` 播报**完整缺失清单**（文案取服务端 `data.missingFields`，如「未完成：诊断意见、建议随访」），不能只让视觉列表变红。焦点移到第一个缺失字段。
2. **错误就近呈现**：每个字段的错误显示在**该字段下方**（`aria-describedby` 关联），不在页面顶部汇总（顶部汇总会让屏幕阅读器用户丢失定位）。
3. **锁定态可被感知**：`SignedLockOverlay` 激活时用 `aria-live="assertive"` 播报「报告已签名锁定，不可编辑」，并把 Tab 焦点从编辑区移到只读区开头，避免焦点陷阱在已禁用控件上。
4. **富文本区域**：`role="textbox"` + `aria-multiline="true"` + `aria-label="检查所见正文"`。
5. **自动保存状态**：`aria-live="polite"`，但**保存成功不播报**（过于频繁），仅播报失败。
6. **签名对话框**：Focus Trap + 初始焦点在「取消」（安全选项）；`role="dialog"` + `aria-modal="true"`；二次确认用 `role="alertdialog"`。
7. **签名后只读不阻断复制**：只读区允许 `Ctrl`+`A` / `Ctrl`+`C`（医生需要复制报告内容），仅阻断修改。
8. **危急值提示条**用 `role="alert"`，且**必须**在签名前确认已通知临床（勾选项 + `aria-required`）。

### 6.9 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。模板树 264px、AI 面板 320px、字号 14px 全部不变。2K/4K 仅编辑器正文区变宽（每行仍控制在 50–75 字符，超宽时正文区**居中限宽**，两侧留白，而非拉满） |
| 1280（笔记本） | AI 建议面板折叠为右侧抽屉（`tabler:layout-sidebar-right` 触发）；模板树 264px 不变 |
| 1024（术中平板） | 三栏改单栏 + `tabler:tabs` 切换（模板 / 编辑 / AI 建议）；按钮放大到 44px；**签名入口保持可用**（平板是合法人工签名终端） |
| 768（竖屏平板） | 单栏；**签名功能禁用**（小屏签名易误操作，且 Spec §0 提到移动端只读约束）；显示提示「请在工作站上完成签名」 |

---

## 7. 页面 `/admin/audit` — 审计查询与追溯回放

### 7.1 布局规格

```
1920×1080
├── A. 顶部状态栏 40px（审计查询 tab 高亮）
├── B. 左侧主导航 240px（可折叠 64px）
├── C. 内容区
│   ├── C1 筛选栏 48px（可折叠）
│   ├── C2 结果统计条 28px
│   └── C3 审计表格（表头 32px + 行 36px）
└── D. 底部状态栏 40px
```

| 区域 | 尺寸 | Token |
|---|---|---|
| 筛选栏 | 48px | — |
| 表格行高 | **36px** | 比工作台密——审计是**低频、长时间阅读**场景，且**非触控主场景**（审计员用鼠标+键盘） |
| 区块间距 | 16px | `--space-4` |

> **行高差异说明**：工作台 44px（医生触控/快速扫读）vs 审计 36px（质控科长时间逐行阅读、需要一屏看更多记录）。这是按**用户任务**而非按组件统一性决定密度，符合 VISUAL_DENSITY=8 的场景化落地。

### 7.2 组件树与 Token 绑定

```
AuditPage
├── AppHeader (40px)
├── SideNav (240px / 64px)
├── AuditContent
│   ├── FilterBar (48px, collapsible)
│   │   ├── DateRangePicker            # tabler:calendar 起始/结束
│   │   ├── ActorInput                 # 操作人
│   │   ├── ActionTypeSelect           # tabler:filter
│   │   ├── PatientIdInput             # 患者ID
│   │   ├── ResetButton                # tabler:refresh
│   │   └── QueryButton                # primary
│   ├── ResultCountBar (28px)          # "共 247 条记录"
│   └── AuditTable                    # [!]全列只读
│       ├── AuditTableHeader (32px)    # tabler:sort-ascending
│       └── AuditRow (36px)
│           ├── TimestampCell          # [!]tabular-nums 等宽时间戳
│           ├── ActorCell
│           ├── RoleCell
│           ├── PatientIdCell
│           ├── ActionCell             # tabler:history + 动作名
│           ├── ResourceCell           # 对象 ID
│           ├── IpCell                 # tabular-nums
│           ├── ResultCell             # 成功/失败 + 原因
│           └── RowActions# hover 显示：仅 [Eye] 查看详情
├── AuditDetailDrawer      # tabler:eye 打开，宽 480px，右侧抽屉
│   ├── DetailFieldList# 全部字段只读
│   ├── HashChainProof         # tabler:shield-check hash_prev / hash_self
│   └── ReplayTimeline         # tabler:timeline 追溯回放
└── ReplayPlayer# 追溯回放控件
```

**审计表只读铁律**：全列无编辑/删除入口。行 hover **仅**显示 `tabler:eye`「查看详情」。**任何情况下不提供编辑 UI**——即使技术上可写，UI 层面也不暴露（AC-18：append-only + hash chain）。

**追溯回放（Replayer）**：选中一条审计记录后，展示该资源（患者/检查/报告）的**操作时间线**，每步显示：时间 / 操作人 / 动作 / 结果。回放控件：`tabler:player-play` 播放 / `tabler:player-pause` 暂停 / `tabler:player-track-next` 步进。**回放是只读的时间线可视化，不重放任何写操作**。

### 7.3 状态矩阵

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| **AuditTable** | 8 行骨架（`--color-skeleton-base`，150ms 微光） | **「2026-10-01 至 2026-10-22 无匹配记录」** + 明确回显当前筛选条件 + 「重置筛选条件」按钮（`tabler:filter-off` 32px） | 「审计服务暂时不可用（超时 10s）」+ 「重试」+ 「导出当前筛选结果」（`tabler:alert-triangle`） | 正常表格 | **>10000 条** → 分页 + 虚拟滚动 +顶部提示「仅显示最近 10,000 条，请缩小时间范围」（`tabler:info-circle`） |
| **FilterBar** | 筛选项加载骨架 | 「当前无可用筛选项」 | 「操作人列表加载失败」+ 重试 | 正常 | 已选条件 >5 项 → 折叠为「已选 8 项」+ `tabler:chevron-down` |
| **AuditRow** | — | — | 「该条记录详情加载失败」+ 单行重试 | 只读展示 | 超长资源 ID（如 `1.2.840.10008.5.1.4.1.1.2.1.8392041`）→ `ellipsis` + `title` 完整值 |
| **ResultCell** | — | — | — | 成功（`tabler:circle-check` + `--color-status-normal` + 「成功」文字）/ 失败（`tabler:circle-x` + `--color-status-critical` + 「失败」文字，**tooltip 显示原因**） | 失败原因超长 → tooltip 内完整显示，不截断关键信息 |
| **AuditDetailDrawer** | 详情骨架 | 「该记录详情已被归档清理」（若超出留存期） | 加载失败 + 重试 | 字段列表 + hash 链证明 | 字段 >30 项 → 分组折叠 |
| **ReplayTimeline** | 回放加载中 | 「该资源仅有 1 条操作记录，无可回放内容」 | 「操作日志加载失败」+ 重试 | 时间线 | 记录 >500 条 → 虚拟滚动 + 按日期分组吸顶 |
| **HashChainProof** | 校验中 | — | 「哈希链校验失败，该区间日志可能已被篡改」+ `tabler:alert-octagon` + 「导出该区间日志并联系信息科」（**安全事件**） | 「哈希链完整（hash_prev → hash_self 校验通过）」+ `tabler:shield-check` | 校验耗时 >3s → 显示进度 |

### 7.4 交互规格

**表格交互**：

| 操作 | 行为 |
|---|---|
| 单击行 | 打开详情抽屉（**只读**） |
| `↑` `↓` | 行间移动（roving tabindex） |
| `Enter` | 打开详情抽屉 |
| `Esc` | 关闭抽屉，焦点回原行 |
| 表头点击 | 排序（时间/操作人/结果可排序；**患者ID 不可排序**——避免按患者聚类的隐私侧信道） |
| 行 hover | **仅**显示 `tabler:eye`「查看详情」 |

**快捷键**：

| 键 | 动作 |
|---|---|
| `/` | 聚焦筛选栏第一个输入 |
| `Ctrl`+`Enter` | 执行查询 |
| `Alt`+`1..4` | 聚焦 时间范围 / 操作人 / 动作类型 / 患者ID |
| `↑` `↓` | 行间移动 |
| `Enter` | 查看详情 |
| `E` | 导出当前筛选结果 |
| `R` | 重置筛选 |
| `Esc` | 关闭抽屉 |
| `?` | 快捷键帮助 |

**状态矩阵（行）**：

| 状态 | Token |
|---|---|
| Default | `--color-surface-panel` |
| Hover | `--color-table-row-hover` |
| Selected（打开详情时） | `--color-table-row-selected` + 左侧 2px `--color-accent-clinical` |
| Focus | 2px `--color-focus-ring` outline |
| 失败行 | 左侧 4px `--color-status-critical`（**状态指示**）+ `tabler:circle-x` + 「失败」文字（三重编码） |

**点击热区**：行 36px 高 × 全宽；行内 `tabler:eye` 按钮 44×44px（视觉 16px + 外扩，满足触控标准即使行高只有 36px）。

### 7.5 数据绑定

`GET /api/v1/audit-logs`（**管理员权限**）

> 字段名以 `openapi.yaml` 为准（camelCase），DB snake_case 由后端 repositories 层转换。

| 契约字段 | UI 位置 | 格式 |
|---|---|---|
| `auditLogId` | 行 key | — |
| `eventTime` | TimestampCell | `YYYY-MM-DD HH:mm:ss` **tabular-nums**（等宽时间戳便于纵向对齐扫描）；权威授时 |
| `actorId` | ActorCell tooltip | 用户 ID |
| `actorNameMasked` | ActorCell | **脱敏值**（如「赵*」），契约已脱敏，直接渲染不还原 |
| `actorDepartment` | RoleCell | 科室（主任医师/住院医师/质控科/信息科所在科室） |
| `action` | ActionCell | 动作名（LOGIN / VIEW_STUDY / SIGN_REPORT / AI_CONFIRM / EXPORT…）+ `tabler:history` |
| `resource` | ResourceCell | 患者ID / 报告ID / 任务ID 等 |
| `result` | ResultCell | 成功 / 失败（+ 失败原因 tooltip） |
| `ip` | IpCell | `10.20.3.45` tabular-nums |
| `hashPrev` / `hashSelf` | DetailDrawer | 上一条哈希 / 本条哈希 |
| `ukeyCertSerial` | DetailDrawer | 签名事件专用：UKey 证书序列号 |
| `reportVersion` | DetailDrawer | 签名事件专用：待签名版本 |
| `digestAlgorithm` | DetailDrawer | 摘要算法（SM3） |
| `nonce` | DetailDrawer | 随机数 |

**脱敏规则**：`actorNameMasked` 是契约层已脱敏值（如「赵*」），前端直接渲染。这不是「显示不全」，而是 PHI 最小暴露在审计侧的落地——审计员需要能追溯到**人**，但不需要看到全名。

**hash chain 验证（AC-18）**：详情抽屉提供「哈希链校验」按钮，对所选区间逐条验证 `hashSelf[n] == H(hashPrev[n] + 内容[n])`。校验通过显示 `tabler:shield-check` + 「哈希链完整」；失败显示 `tabler:alert-octagon` + 「该区间日志可能已被篡改」+ 导出建议。**这是 append-only 的可视化证据**，让审计员能独立验证而非信任系统声明。

**追溯回放数据**：选中一条记录 → 按 `resource` 查询该资源的全部操作 → 按 `eventTime` 升序组成时间线。回放**只读**，不触发任何写操作。

**错误码**：

| 码 | UI |
|---|---|
| 10003 | 「您的角色无审计查询权限」+ 「审计查询权限由质控科或审计管理员持有」 |
| 10002 | 会话过期 → 跳转 `/login` |
| 10001 | 筛选参数非法 → 「时间范围不合法：起始时间须早于结束时间」+ 定位到对应字段 |

> **业务分支一律看 `code`，不看 HTTP 状态码**（见 §6.7.3）。

### 7.6 无障碍要点（本页特有）

1. **审计表的屏幕阅读器可读性**：`role="table"` + `<caption>` +每列 `scope="col"`。时间戳因使用 tabular-nums，朗读时需确保读出完整时间而非「数字堆」——在单元格内加 `<time datetime="ISO8601">` 语义。
2. **哈希链证明必须可被朗读**：`tabler:shield-check` + 「哈希链完整，校验通过 N 条」，且**校验失败用 `role="alert"`**（安全事件不能只靠视觉）。
3. **筛选条件的回显**：Empty 态回显当前筛选条件（「2026-10-01 至 2026-10-22 无匹配记录」），这对屏幕阅读器用户尤其重要——他们看不到筛选栏。
4. **只读语义**：表格容器加 `aria-readonly="true"`（若用 `grid` role），并在表格上方说明「审计日志为只读，不可修改或删除」。
5. **导出的无障碍**：导出按钮需 `aria-label="导出当前筛选结果为 CSV 文件"`，并播报导出完成。
6. **追溯回放**：`tabler:player-play` 切换时用 `aria-live="polite"` 播发当前步（时间 + 操作 + 结果），使回放过程对屏幕阅读器用户可理解。
7. **表格虚拟滚动的焦点保持**：`aria-rowcount` 随分页更新；虚拟滚动时焦点不得丢失（滚动到不可见区域用 `aria-activedescendant`）。
8. **失败结果三重编码**：颜色 + `tabler:circle-x` + 「失败」文字，且失败原因可聚焦查看（tooltip 不可聚焦，必须同时提供可点击查看）。

### 7.7 响应式

| 视口 | 差异 |
|---|---|
| 1920 / 2560 / 3840 | **完全一致**。行高 36px、侧栏 240px、字号全部不变。2K/4K 仅表格右侧留白增加；**列宽固定 + 横向滚动**（不用 `width:100%` 挤压列） |
| 1280（笔记本） | 侧栏折叠 64px；表格保留全列，横向滚动 |
| 1024（术中平板） | 表格切卡片模式；筛选栏转抽屉；**导出功能保留**（质控科需在移动端导出证据） |
| 768（竖屏平板） | 单列卡片；**只读，无编辑**；导出按钮保留 |

---

## 8. 跨页面一致性检查表（前端自检）

实现完成后逐条核对：

| # | 检查项 | 依据 |
|---|---|---|
| 1 | 三档分辨率下工具栏图标、字号、侧栏宽度**逐像素相同** | Spec §10 |
| 2 | 全项目零 emoji，图标仅 `@tabler/icons-react` | P0-1 |
| 3 | 零紫色→粉色渐变 | P0-2 |
| 4 | 零硬编码色值，全部 `var(--color-*)` | P0-4 / Spec §8 |
| 5 | 亮色主题下 Canvas 仍为 `#1A1A1A` | 硬约束 1 |
| 6 | Canvas 角标用 `--color-text-on-canvas` | 硬约束 2 |
| 7 | 危急值处处三重编码（颜色 + `AlertTriangle` + 「危急值」文字） | 硬约束 3 / AC-22 |
| 8 | 所有临床数值应用 `--number-font-feature` + 右对齐 | P4 |
| 9 | 所有状态色配图标 + 文字，无纯色圆点 | P3 |
| 10 | 每个组件五态（Loading/Empty/Error/Populated/Edge）齐全 |本文各页 §状态矩阵 |
| 11 | Empty 态文案均为真实临床/运维场景，零「暂无数据」 | P0-3 |
| 12 | 10004 与 10005 的 UI 表现**完全一致** | AC-16 |
| 13 | 所有浮动交互有键盘等价路径 | P5 |
| 14 | 焦点在输入框内时单键快捷键失效 | §3.7.3 |
| 15 | `prefers-reduced-motion` 下动效归零，spinner 降为静态图标 + 「加载中」 | P6 |
| 16 | 所有触控目标 ≥ 44×44px | P5 |
| 17 | AI 分割失败不用空结果冒充成功 | AI-02 |
| 18 | 降级态明确告知精度损失，禁止静默降级 | PIT-02 |
| 19 | 签名后报告只读，无撤回入口 | COM-01 |
| 20 | 审计表无任何编辑入口 | AC-18 |
| 21 | **业务分支一律看 `code`，不看 HTTP 状态码**（409 有 20003/50003/50004 三种语义） | §6.7.3 |
| 22 | 锁定与编辑态一律读 `lockState.editable`，**不自行推导** | §6.7 |
| 23 | 签名失效态（`signatureValid=false`）与正常已签名态**视觉可区分** | §6.5 |
| 24 | 期相置信度 <0.70 的分组**不得默认选中** | §3.5 / 契约 `PhaseGroup.confidence` |
| 25 | `structureName` 下拉**只允许枚举值**，不接受自由输入 | §5.5 / 契约 `StructureName` |
| 26 | 脱敏字段（`nameMasked` 等）**原样渲染，不尝试还原** | §2.5 / §7.5 |
| 27 | 签名请求必带 `reportVersion`（防签旧版） | §6.7 |
| 28 | `ntpOffsetMs` 登录时即提示（1000ms 提示 / 60000ms 拒绝两档） | §1.5 |

---

## 9. P2 阶段修订 Token 记录

| Token | 修订内容 | 原因 |
|---|---|---|
| `text-primary`（description） | 「对 panel 15.2:1」→「实测对 panel-dark #161C21 为 14.57:1 (AAA)，对 canvas-dark #000000 为 17.80:1 (AAA)」 | 原描述**引用面标注错误**：15.2:1 与实测 14.57:1 不符。色值本身正确，仅改描述 |
| `text-on-canvas`（description） | 「实测对 canvas 17.80:1」→「实测对 canvas-dark #000000 为 17.80:1，对 canvas-light #1A1A1A 为 14.75:1（均 AAA）」 | 原描述只给单值，但该 Token 双主题恒为 `#E8EDF0` 而 canvas 两主题值不同（`#000000` / `#1A1A1A`），必须按引用面分别标注 |
| `touch-target-min` | **新增进 CSS/JSON产物** | 该Token 在 UIUX.md §10.5 被引用，但生成器后缀过滤漏掉 `min` 导致产物中缺失 |
| `layout` CSS 变量名 | `--toolbar--height` → `--toolbar-height` 等 7 个 | 生成器链式 `.replace()` 产出双横杠畸形变量名，**全部 layout 变量均不可用** |

**色值零变更**——本阶段仅修正描述文字与变量名，未改动任何颜色/间距/字号的取值。

---

## 附录A：快捷键总表（跨页汇总）

| 分类 | 快捷键 | 页面 |
|---|---|---|
| 全局 | `?` `Ctrl+\` `Ctrl+Alt+t` `Esc` | 全部 |
| 工具切换 | `V` `W` `C` `L` `M` `A` `T` `D` `R` `Shift+M` | viewer / plan |
| 视图导航 | `↑` `↓` `PgUp` `PgDn` `←` `→` `Home` `End` `Space` | viewer |
| 布局 | `1` `2` `3` `4` | viewer / plan |
| 窗宽窗位 | `Shift+←→` `Shift+↑↓` `Ctrl+Shift+←→` `[` `]` `Ctrl+0` | viewer |
| 全屏/截图 | `F` `Ctrl+S` | viewer / plan |
| 3D 专用 | `R` `H` `M` `P` `B` `V` `Q` `W` `E` `Shift+0` | plan |
| AI 确认 | `Enter` `Shift+Enter` `M` `Ctrl+Enter` | segmentation |
| 报告 | `Ctrl+S` `Ctrl+Enter` `Ctrl+Alt+S` `Ctrl+Shift+D` `Ctrl+Z` `Ctrl+Y` | reports |
| 列表 | `/` `↑` `↓` `j` `k` `Enter` `Alt+1..4` `r` `f` | worklist |
| 审计 | `/` `Ctrl+Enter` `Alt+1..4` `↑` `↓` `Enter` `E` `R` `Esc` | admin/audit |

> **冲突裁决**：`W`（窗宽窗位）在 viewer/plan 生效，在 worklist 无绑定；`M`（测量）在 viewer 与 segmentation 语义不同（测量 vs 修改）——已在 §4.6 与 §3.4.3 分别定义，互不冲突（不同页面）。**`E`（导出）仅 audit 生效。**

## 附录 B：组件清单汇总（共 42 个页面级组件）

| # | 组件 | 出现页面 | 状态矩阵所在节|
|---|---|---|---|
| 1 | AppHeader | 全部 | §2.2 |
| 2 | SideNav | worklist / admin-audit | §2.2 |
| 3 | SidebarLeft | viewer / segmentation / plan | §3.2 |
| 4 | SidebarRight | viewer / plan | §3.2 |
| 5 | StudyTable + StudyRow | worklist | §2.3 |
| 6 | Viewport + CornerOverlay | viewer / plan | §3.3 |
| 7 | SeriesListPanel | viewer | §3.3 |
| 8 | SeriesNavBar | viewer | §3.2 |
| 9 | Toolbar / Toolbar3D | viewer / plan | §3.4.2 |
| 10 | WindowLevelPanel | viewer | §3.3 |
| 11 | MeasurementPanel | viewer / plan | §3.3 |
| 12 | AiResultPanel | viewer | §3.3 |
| 13 | ReportSummaryPanel | viewer | §3.3 |
| 14 | CriticalBanner | viewer / reports | §3.3 / §6.4 |
| 15 | LoginCard + LoginForm | login | §1.3 |
| 16 | UkeyInsertHint | login | §1.2 |
| 17 | DisclaimerBar | segmentation | §4.4 |
| 18 | ConfirmProgressBar | segmentation | §4.4 |
| 19 | AiMarkRow | segmentation | §4.4 |
| 20 | TaskStatusPanel | segmentation | §4.3 |
| 21 | ModifyDialog | segmentation | §4.6 |
| 22 | DataSourceList | plan | §5.3 |
| 23 | ImplantLibrary | plan | §5.2 |
| 24 | PlanParameterPanel | plan | §5.3 |
| 25 | KeyMeasureTable | plan | §5.3 |
| 26 | PlanVersionBar | plan | §5.4 |
| 27 | TemplateTree | reports | §6.2 |
| 28 | ControlledField × 5 | reports | §6.3 |
| 29 | FindingsEditor | reports | §6.4 |
| 30 | AiSuggestionPanel | reports | §6.4 |
| 31 | AutoSaveStatus | reports | §6.4 |
| 32 | SignatureDialog | reports | §6.5 |
| 33 | SignedLockOverlay | reports | §6.4 |
| 34 | AuditTable + AuditRow | admin-audit | §7.3 |
| 35 | FilterBar | admin-audit | §7.3 |
| 36 | AuditDetailDrawer | admin-audit | §7.3 |
| 37 | HashChainProof | admin-audit | §7.3 |
| 38 | ReplayTimeline | admin-audit | §7.3 |
| 39 | ShortcutHelpModal | 全部 | §3.2 |
| 40 | ThemeSwitcher | 全部 | §1.2 |
| 41 | Toaster | login / 全部 | §1.2 |
| 42 | StatusBadge / ConfirmStateBadge | worklist / segmentation | §2.3 / §4.5 |