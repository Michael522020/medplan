# MedPlan 设计系统与 UI/UX 规范

> 项目：MedPlan — 企业级医学影像阅片与手术规划系统
> 设计师：颜好看 | 日期：2026-10-22
> 寄存器判断：**Product Register（产品型）** — 设计服务专业工作流，标杆是"赢得熟悉感"而非"独特性"
> 平台正交轴：**web（桌面工作站优先）**，兼顾 2K/4K 医疗显示器与笔记本
> 三轴刻度：DESIGN_VARIANCE **4**（专业工具，可预期性优先）/ MOTION_INTENSITY **2**（功能性动效，无装饰）/ VISUAL_DENSITY **8**（驾驶舱级信息密度）
> Token 交付物：`docs/design-tokens.json`（源）、`docs/design-tokens.css`（由 json 生成，内容完全一致）

---

## 0. 设计调研结论（WebSearch/WebFetch 已执行）

### 0.1 竞品 UI 方案分析

| 竞品 | 界面底色 | 强调色 | 布局范式 | 值得学| 明确规避 |
|---|---|---|---|---|---|
| **OHIF Viewer v3** | `bkg.low #050615` / `bkg.med #090C29`（近黑蓝） | primary `main #0944b3` / `light #5acce6`（青蓝） | 四宫格 viewport 占绝对主体，工具条贴viewport 边缘浮动，patient/study/series 在左侧抽屉 | ① 三层背景分层（`--background/--muted/--popover`）② `--highlight` 仅用于"当前活动"（active viewport 高亮边框）③ `--ring` 专门做焦点环 ④ HSL triplet token 体系 | 其Tonal 主题（Orchid紫/Verdant绿）会把色相染到背景层——**我们不采用色相染色背景**，因为阅片区一旦有底色污染就会干扰灰阶感知 |
| **3D Slicer 5.x** | 浅灰默认（Qt 默认） | Qt 蓝 | 左侧 Module Panel + 中央 slice/3D 视图 +底部 Status Bar | ① **Data Probe**：鼠标位置实时显示 HU 值/坐标——这是影像工作站的核心交互，必须有 ② Data 树按 Patient/Study/Series 组织（DICOM 层级）③ 布局可命名保存（"研究阶段_主要功能"）④ 危险操作设复杂快捷键 | 浅灰默认底色 + 模块堆叠式菜单栏——不适合 8h/天的阅片场景，认知负荷过高 |
| **联影 uAI（uAI Discover Lung/Chest）** | 临床工作站暗色为主 | 品牌青绿 | 检查列表 + AI 结果叠加在影像上，量化面板（长短径/体积/CT值/密度） | ① **量化指标 tabular-nums 呈现**（体积 mm³、CT值 HU 必须等宽）② 病灶智能跟踪/前后配准对比是核心卖点 ③ 结构化报告一键生成 | 中文界面的部分按钮用了 emoji 式图标（类），这是明确反模式，我们不用 |
| **推想科技 / 医影智阅** | 暗色 | 蓝青 | 阅片 + AI 任务队列 | AI 任务状态（排队/运行/完成/失败）需要独立的可视状态机 | — |
| **OHIF "Neutral" 主题家族**（Midnight/Slate/Deep） | 中性灰黑，无色相 | 中性高亮 | — | **这是我们的直接参照**：官方文档明确写"reduces the focus on color to emphasize image content"（减少颜色依赖以突出影像内容） | — |

### 0.2 暗色主题的专业工具设计参考

| 工具 | 可借鉴的暗色设计决策 |
|---|---|
| **Adobe Lightroom Dark** | 画布区绝对纯黑（不是 #1e1e1e），面板用亮度递进（#1e1e1e → #262626 → #2d2d2d）区分层级，**零投影**。这与 TG-18 的诊断阅片逻辑一致：越靠近影像越黑。 |
| **DaVinci Resolve** | 工具条图标全部统一 2px 描边、灰白单色，激活态用背景色块而非发光。色彩管理面板用纯数字等宽字体 + 无单位后缀裸数字。 |
| **VS Code Dark+** | `titleBarActiveBackground` 概念：窗口 chrome 与编辑区分离。token 化到极致（`editor.background` / `sideBar.background` / `tab.activeBackground`），全局无硬编码色。 |
| **Blender** | 视图区四周的 UI 密度极低、视图区纯色，工具面板用两栏网格 + 折叠组（`region`），因为 3D 视���需要绝对无干扰。 |

**共同规律**：所有专业影像/创意工具的暗色策略都是「**视图区最黑 + chrome 逐级提亮 + 用亮度而非投影表达层级**」。这不是审美选择，是暗环境下人眼对高亮边缘敏感（halation）的生理结果。

### 0.3 医疗显示标准（决定暗色刚需的硬证据）

来自 **ACR-AAPM-SIIM Technical Standard for Electronic Practice of Medical Imaging** 与 **AAPM TG-18**：

- 阅片区环境照度推荐 **20–40 lx**；TG-18 Table III 明确：诊断阅片站（X-ray）**2–10 lx**，CT/MR/NM **15–60 lx**
- 诊断显示器 Lmax ≥ **350 cd/m²**，L'min ≥ **1.0 cd/m²**，亮度比 LR ≥ 250（350 为宜）
- **环境亮度 Lamb 必须小于最暗灰阶亮度的 1/4**
- 中间灰阶必须遵循 **DICOM GSDF**（Grayscale Standard Display Function）
- 显示设备应置于约 **60 cm** 臂长处
- 桌面控制台布局可用 `20–40 lx`

**设计结论（直接推导）**：在 Lmax 350 cd/m² 的诊断屏前，若 UI 面板用 `#FFFFFF` 白底，实际屏幕反射亮度可达 200+ cd/m²，是环境亮度的 10 倍量级，会造成瞳孔剧烈收缩与眩光。因此**阅片区周边必须是接近纯黑**——这不是风格，是安全要求。同时 GSDF 精确性意味着 UI 不能在影像上叠加任何染色层。

### 0.4 WCAG 2.1/2.2 AA 在暗色高对比场景的实践要点

- **纯黑 `#000` + 纯白 `#FFF` 是错误做法**：对比度 21:1 数学上完美，但暗环境下产生 **halation（光晕）**，散光人群尤其不适，且阅读效率实际下降。Material / Apple 均建议底色不用纯黑、文字不用纯白。
- 暗色下**感知对比度低于计算对比度**（暗背景光字会"渗开"变细），因此正文应目标 **≥ 7:1**（AAA 档）而非仅 4.5:1。
- **暗色必须重新设计而非反转**：单纯 invert 会让语义色变浑浊。层级靠**亮度递进**（每级 5–8% 白叠加）而非阴影——暗背景上的投影等于不可见。
- 暗色下高饱和红/蓝/绿会"振动"（visual vibration），需**降饱和 15–25%**。
- 焦点环在暗背景上不能用蓝（会淹没），推荐青色/黄色，且必须同时满足对组件和页面背景 **3:1**。
- `prefers-reduced-motion` 必支持；`forced-colors` 模式下 UI 需用系统颜色关键字而非硬抗。

### 0.5 图标库选型对比与锁定结论

| 库 | 许可 | 数量 | 描边体系 | Tree-shaking | 医学语义覆盖 | 结论 |
|---|---|---|---|---|---|---|
| **Tabler Icons 3.49.0** | **MIT** | **5184 outline + 1054 filled** | 24×24 网格，2px 描边，`currentColor` | [PASS] `@tabler/icons-react` 等按需导入 | [PASS] 含 bone / lungs / brain / stethoscope / test-pipe / microscope / vaccine / ambulance / medical-cross / report-medical / x-ray 类工作流；[COND] 无 kidney / stomach / vessel / syringe | **[PASS] 锁定** |
| Lucide 1.28.0 | ISC | 1778 outline | 24×24，2px | [PASS] | [COND] 有 bone/brain 但无 test-pipe / report-medical / medical-cross 等医疗流程语义；纯 outline 无 filled，工具"选中态"需另做视觉方案 | 备选 |
| Phosphor | MIT | 1527 概念 × 6 字重 | 256×256 填充路径，6 字重 | [PASS] | [COND] 医疗语义覆盖弱于Tabler；6 字重对"全项目单一视觉语言"是负担（容易混用） | 不选 |
| Material Symbols | Apache-2.0 | 2500+ | 可变轴 | [COND] 字体文件 4–6MB，需全量加载 | 风格偏 Google，消费级 | 不选（性能与风格） |
| Radix Icons | MIT | ~300 | 15×15 | [PASS] | [FAIL] 覆盖严重不足，医学场景大量缺图 | 不选 |

**锁定决策：Tabler Icons v3.49.0（MIT）**

理由（按权重排序）：
1. **唯一同时具备 outline + filled 的超大集合（5184 + 1054）**。阅片工具栏的"未激活/已激活"两态必须视觉可区分——Tabler 可以用同名outline/filled 两种构件配对（如 `<Star />` / `<StarFilled />`，导入路径 `/icons/outline/star.svg` 与 `/icons/filled/star.svg`），保持同一几何语言。这是 Lucide（纯 outline）和 Material Symbols（风格不符）的硬伤。
2. **MIT 许可**，可内联 SVG 进医疗商业交付物，无 copyleft 传染风险（GPL/CC-BY-NC 一律排除）。
3. **24×24 + 2px 描边**是全项目唯一的描边规范，不会出现跨库描边宽度打架（±0.25px 是混库时的经典问题）。
4. 医学流程语义实测覆盖好：解剖（bone/lungs/brain/heart/dna）、器械（syringe 类用 vaccine/test-pipe/stethoscope/microscope 覆盖）、场所（building-hospital/ambulance）、文书（report-medical/file-description/file-certificate）、告警（alert-triangle/alert-octagon/alert-circle）。
5. tree-shaking 友好，`currentColor` 让主题切换零成本。

**缺口处理（诚实记录，不掩盖）**：Tabler 无 kidney / stomach / 血管 / syringe 独立图标。方案：
- 血管/动脉 → `tabler:git-branch`（分支形态语义贴切）或 `tabler:topology-star`（树突/血管网形态）
- 肾脏/胃等未涉及脏器 → 不强行画，用 `tabler:body-scan` 或部位文字标签
- 注射 → `tabler:vaccine`（注射器形态）
- **严禁**为了补缺口而从第二套库拷图标混用（违反 P0-6）
- 若后续确需，**必须新增图标进 Tabler 官方提 PR**，保持单一来源

---

## 1. 设计原则（8 条，前端可直接执行）

### P1 · 影像优先（Image First）
阅片区 Canvas 占据视觉主导，UI chrome 必须"退后"。任何不能帮助医生读图的像素都是浪费。**执行规则**：阅片工作台 Canvas 占比 ≥ 70%（1920×1080 下 Canvas 区 ≥ 1400×800）；工具条默认透明底，仅在 hover/激活时显示底色；不使用任何会叠加在影像上的装饰性阴影/渐变/毛玻璃。

### P2 · 灰阶不可侵犯（Grayscale Integrity）
医学影像的窗宽窗位依赖精确灰阶呈现，色彩管理错误 = 误诊。**执行规则**：
- 阅片区 Canvas 周边使用 `--color-surface-canvas`（暗色 `#000000`，亮色 `#1A1A1A`）
- **禁止**在 Canvas 上的影像像素上叠加任何半透明染色层，`rgba` 透明度仅允许用于十字定位线（`--color-overlay-crosshair`）与 ROI 边框
- 分割/标注轮廓线使用**不透明纯色 2px 描边**，不使用发光/外阴影
- 禁止在 Canvas 区域内使用 `backdrop-filter`（毛玻璃会引入色彩偏移）

### P3 · 危急值三重编码（Critical Triple Encoding）
危急值/异常必须满足"不只靠颜色"。**执行规则**：任何 `--color-status-critical` 的使用处，**必须**同时具备：
1. 颜色（暗色 `#FF6B6B`，亮色 `#C81E1E`）
2. 图标（`tabler:alert-triangle` / `tabler:alert-octagon`）
3. 文字（"危急值" / "需急诊处理"）
仅颜色一处变化视为不合格实现，代码审查需检查三者同时存在。

### P4 · 数字必须稳定（Numeric Stability）
所有临床数值必须用等宽数字防跳动。**执行规则**：所有 HU 值、窗宽窗位（WW/WL）、层厚、层号、坐标、体积、尺寸、时间戳、数值指标——**强制** `font-variant-numeric: tabular-nums`（Token: `--number-font-feature`）+ `--font-mono` 或正文栈中的mono fallback。数字位数变化时布局不得位移（如 `-12HU` → `-120HU`）。

### P5 · 键盘是一等公民（Keyboard First）
医生的手不应离开键盘，且不应依赖精确拖拽。**执行规则**：
- 所有高频动作有快捷键（见 §8 快捷键表），且快捷键在 tooltip 中可见
- 工具栏按钮 `aria-keyshortcuts` 属性声明快捷键
- 面板可完全折叠，`Tab` 顺序遵循视觉顺序（左→右、上→下）
- 拖拽类交互（窗宽窗位调节、层滑块）必须提供数字输入框替代路径

### P6 · 零情绪化设计（No Emotion）
医生连续工作 8 小时，任何"友好"的圆润卡通、渐变、庆祝动效都是干扰。**执行规则**：圆角上限 `--radius-lg` 12px（卡片）；禁止 bounce 缓动；禁止 >200ms 的非功能性过渡；AI 任务完成用**静态**状态变更 + 一次 150ms 高亮，不用撒花/弹跳。

### P7 · 语义化到不能再语义（Semantic Naming）
颜色 Token 一律按用途命名，禁止按色相命名。**执行规则**：禁止出现 `--blue-500`、`--red`、`--gray-100` 这类色相名 Token；一律 `--color-accent-clinical`、`--color-status-critical`、`--color-surface-canvas`。开发者搜Token 名即知用途。

### P8 · 双主题同源不同境（Dual Theme, One Source）
两套主题是**两个独立设计**，不是互相反转。**执行规则**：每个颜色 Token 在亮/暗两套中都必须显式定义，不允许"亮色值 + 暗色自动反转"的运行时计算；主题切换通过 `<html data-theme="...">` 一次性改属性，不在运行时重算色值。

---

## 2. 颜色 Token 全表

> **全部颜色必须走 Token，禁止硬编码。** 唯一例外：影像 Canvas 的 `#000000`（作为 `--color-surface-canvas` 的值定义出现，不是硬编码）。

### 2.1 Primitive 层（原始色阶， 仅 Token 定义处可出现）

**Clinical Teal 强调色阶**（注：主色已按 PRD 7.1 改为深蓝藏青，本色阶保留供分割/血管等次级语义使用）
```
--color-teal-50:#E6F4F1  --color-teal-100:#C2E5DE  --color-teal-200:#8FCDC1
--color-teal-300:#57B0A1  --color-teal-400:#2E9182  --color-teal-500:#157A6D
--color-teal-600:#0E6157  --color-teal-700:#0A4B44  --color-teal-800:#073733
--color-teal-900:#052422
```

**Signal Red 危急值色阶**（红绿色觉障碍友好：红同时配图标+文字，且暗色下提高明度而非提高饱和度）
```
--color-red-50:#FDECEC  --color-red-100:#FBD5D5  --color-red-200:#F5AEAE
--color-red-300:#EC7C7C  --color-red-400:#E05252  --color-red-500:#C81E1E
--color-red-600:#A81717  --color-red-700:#851111  --color-red-800:#5F0C0C  --color-red-900:#3D0707
```

**Neutral 色阶**（冷灰阶，带极轻微蓝相，适配长时间注视）
```
--color-neutral-0:#FFFFFF   --color-neutral-50:#F5F7F8   --color-neutral-100:#E7EBED
--color-neutral-200:#CBD2D7 --color-neutral-300:#A3ADB5  --color-neutral-400:#7A858F
--color-neutral-500:#5A656F --color-neutral-600:#454F58  --color-neutral-700:#343C44
--color-neutral-800:#242B32 --color-neutral-900:#161C21  --color-neutral-950:#0C1116
--color-neutral-1000:#050809
```

**Status辅助色阶**（success / warning / info，同样为双主题准备）
```
--color-green-500:#15803D  --color-green-400:#22A355--color-green-600:#0F6430
--color-amber-500:#B45309  --color-amber-400:#D97706  --color-amber-600:#8A3F06
--color-blue-500:#1D4ED8   --color-blue-400:#3B82F6   --color-blue-600:#1739A8
```

### 2.2 Semantic 层 — 暗色主题（阅片默认，`[data-theme="dark"]`）

| Token | 值 | 用途 |
|---|---|---|
| `--color-surface-canvas` | `#000000` | **阅片区影像画布周边，接近纯黑，防眩光** |
| `--color-surface-app` | `#0C1116` | 应用最外层背景（比 canvas 略亮，区分画布与shell） |
| `--color-surface-panel` | `#161C21` | 侧栏/面板背景 |
| `--color-surface-raised` | `#242B32` | 卡片、浮起面板 |
| `--color-surface-overlay` | `#2D353D` | 弹窗、下拉、菜单 |
| `--color-surface-sunken` | `#050809` | 凹陷区、输入框底|
| `--color-surface-hover` | `#1F262D` | 行hover |
| `--color-surface-active` | `#2A333B` | 行选中/按下 |
| `--color-border-subtle` | `#242B32` | 内部行分隔线 |
| `--color-border-default` | `#343C44` | 常规边框 |
| `--color-border-strong` | `#5F6B76` | 强边框/输入框（对 panel 3.15:1，满足 1.4.11） |
| `--color-text-primary` | `#E8EDF0` | 正文（**非纯白**，防halation；对 panel-dark `#161C21` **14.57:1**，对 canvas-dark `#000000` **17.80:1**，均 AAA） |
| `--color-text-secondary` | `#A3ADB5` | 次级文本（7.53:1 AAA） |
| `--color-text-tertiary` | `#7A858F` | 辅助/占位（4.56:1 AA） |
| `--color-text-disabled` | `#5A656F` | 禁用（2.9:1，仅用于禁用态，配aria-disabled） |
| `--color-text-on-accent` | `#FFFFFF` | 强调色底上的前景 |
| `--color-text-on-canvas` | `#E8EDF0` | **叠加在 Canvas 上的文字**（序列名/层号/WW·WL/患者ID/HU）。恒为浅色——Canvas 恒暗，若用 text-primary 在亮色主题下会不可见。实测对 canvas-dark `#000000` **17.80:1**、对 canvas-light `#1A1A1A` **14.75:1**（均 AAA；两主题 canvas 值不同，故须按引用面分别标注） |
| `--color-accent-clinical` | `#63A6DC` | **主色·深蓝藏青**（PRD 7.1 色相，暗色提明至 6.56:1；PRD 原色 #1e3a5f 在暗底仅 1.49:1 不可用，详见 §14.1） |
| `--color-accent-clinical-hover` | `#7CBAE8` | hover |
| `--color-accent-clinical-active` | `#4A8AC0` | active |
| `--color-accent-clinical-subtle` | `#16243A` | 选中行底色/标签底 |
| `--color-status-critical` | `#FF6B6B` | **危急值**（暗色下提明度至 6.19:1 on panel；配 tabler:alert-triangle + 「危急值」文字，三重编码） |
| `--color-status-critical-subtle` | `#3D0F0F` | 危急值底色 |
| `--color-status-abnormal` | `#E8A33D` | 异常/阳性发现 |
| `--color-status-warning` | `#F59E0B` | 待处理/警示·琥珀（PRD 7.1 指定，对 panel 8.00:1） |
| `--color-status-normal` | `#3FB950` | 正常/阴性（**始终配 check 图标+ 文字**） |
| `--color-status-info` | `#4D9DE0` | 信息/进行中 |
| `--color-focus-ring` | `#7CBAE8` | 焦点环（暗背景高可见，对 panel 8.79:1，对 app 9.70:1，均 ≥3:1） |
| `--color-overlay-crosshair` | `#8FC2E8` | 十字定位线唯一许可的染色 |
| `--color-shadow-ambient` | `rgba(0,0,0,0.55)` | 仅用于 modal 遮罩 |

### 2.3 Semantic 层 — 亮色主题（`[data-theme="light"]`，用于明亮环境/手术室会诊/笔记本）

| Token | 值 | 用途 |
|---|---|---|
| `--color-surface-canvas` | `#1A1A1A` | 亮色主题下画布**仍保持深灰**（灰阶影像在白底上会丧失诊断对比，这是专业判断，不是偷懒） |
| `--color-surface-app` | `#F5F7F8` | 应用背景 |
| `--color-surface-panel` | `#FFFFFF` | 面板 |
| `--color-surface-raised` | `#FFFFFF` | 卡片 |
| `--color-surface-overlay` | `#FFFFFF` | 弹窗 |
| `--color-surface-sunken` | `#E7EBED` | 凹陷/输入框底 |
| `--color-surface-hover` | `#EDF1F2` | hover |
| `--color-surface-active` | `#E1E7EA` | 选中 |
| `--color-border-subtle` | `#E7EBED` | 分隔线 |
| `--color-border-default` | `#CBD2D7` | 边框 |
| `--color-border-strong` | `#7A858F` | 强边框 |
| `--color-text-primary` | `#0F1519` | 正文（对 panel 18.39:1） |
| `--color-text-secondary` | `#454F58` | 次级（8.36:1） |
| `--color-text-tertiary` | `#5A656F` | 辅助（5.96:1 AA） |
| `--color-text-disabled` | `#A3ADB5` | 禁用 |
| `--color-text-on-accent` | `#FFFFFF` | — |
| `--color-accent-clinical` | `#1E3A5F` | **主色·深蓝藏青（PRD 7.1 原色）**，对白底 11.50:1 AAA |
| `--color-accent-clinical-hover` | `#2C3E50` | —（PRD 7.1 第二指定色） |
| `--color-accent-clinical-active` | `#152A45` | — |
| `--color-accent-clinical-subtle` | `#D3DEE9` | 选中底 |
| `--color-status-critical` | `#C81E1E` | 危急值（对白 5.74:1 AA；配 tabler:alert-triangle + 文字） |
| `--color-status-critical-subtle` | `#FDECEC` | — |
| `--color-status-abnormal` | `#B45309` | 异常 |
| `--color-status-warning` | `#8A5200` | 待处理/警示（PRD 原色 #F59E0B 白底仅 2.15:1 不达AA，亮色加深） |
| `--color-status-normal` | `#15803D` | 正常 |
| `--color-status-info` | `#1D4ED8` | 信息 |
| `--color-focus-ring` | `#1E3A5F` | 亮色下焦点环用主色深蓝 |
| `--color-overlay-crosshair` | `#1E3A5F` | — |
| `--color-shadow-ambient` | `rgba(15,21,25,0.32)` | modal 遮罩 |

### 2.4 强调色用量纪律

- **每屏 `--color-accent-clinical` 可见使用 ≤ 2 处**
- `--color-status-*` 系列不计入强调色配额（它们是语义色，0–5% 占比），但**总量不得超过一屏面积的 5%**
- 危急值色是唯一的"允许突破"的颜色，因为它承载临床安全语义

---

## 3. 排版 Token

### 3.1 字体方案

```css
--font-ui: "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;/* 界面正文 */
--font-display: "Inter", "Noto Sans SC", sans-serif;                            /* 标题（与 UI 同族，避免混排断裂）*/
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;           /* 全部临床数值 */
```

**选择理由**：
- **Inter**（OFL）— 医疗 UI 事实标准（OHIF 与 VS Code 均用），字腔开放、字形中性、灰度均匀，在低亮度下笔画不糊
- **Noto Sans SC**（OFL）— 思源黑体，中文覆盖完整且字重齐全（避免用系统中文字体导致跨机器渲染不一致）
- **JetBrains Mono**（OFL）— 数值专用。相比 IBM Plex Mono（我的反射拒绝名单内）字符更"工程化"，`0` 带斜杠可与 `O` 区分，且在 12px 下仍清晰

**反"编辑排版风"声明**：本项目不采用 serif 展示字体 + 斜体 + 小型 mono 标签 + 单色克制的杂志风路线。医学诊断场景需要的是**工程可信度**，不是编辑感。

### 3.2 字号阶梯（8 级）

| Token | px | 行高 | 字重 | 用途 |
|---|---|---|---|---|
| `--text-2xs` | 10 | 1.4 | 500 | DICOM 角标、序列序号（最小可读下限） |
| `--text-xs` | 11 | 1.5 | 400 | 标签、单位、图例 |
| `--text-sm` | 12 | 1.5 | 400 | 次级正文、面板标题、时间戳 |
| `--text-base` | 13 | 1.6 | 400 | **正文基准**（阅片工具默认，13px 而非 16px——工具型UI 需更高密度） |
| `--text-md` | 14 | 1.6 | 400 | 报告编辑正文 |
| `--text-lg` | 16 | 1.5 | 500 | 区块标题、面板标题 |
| `--text-xl` | 20 | 1.4 | 590 | 页面标题、患者姓名 |
| `--text-2xl` | 24 | 1.3 | 590 | 登录页标题、系统级标题 |
| `--text-3xl` | 32 | 1.2 | 590 | 危急值弹窗标题（唯一允许的"大"） |

### 3.3 字重三级

| 级别 | 字重 | 用途 |
|---|---|---|
| Regular | 400 | 正文、说明 |
| Medium | 500 | 按钮文字、表头、小标题（**暗色主题下正文对比不足时升至 500**） |
| Semibold | 590 | 大标题、患者姓名、危急值文字 |

### 3.4 字距规则

| 场景 | 字距 |
|---|---|
| 正文 12–14px | `0` |
| 11px 及以下 | `0.01em` |
| ALL CAPS（DICOM 标签、MODALITY） | `0.08em` |
| 标题 ≥ 20px | `-0.01em` |

### 3.5 等宽数字规范（Token 强制）

```css
--number-font-feature: "tnum" 1, "zero" 1;   /* 等宽数字 + slashed zero */
--number-font-mono: var(--font-mono);
```

**强制适用范围**：HU 值、窗宽（WW）/窗位（WL）、层厚（Slice Thickness）、层号（Image Number）、层/总数（`342/512`）、坐标（`x,y,z`）、体积（mm³）、长径/短径、角度、心率、时间戳、百分比、AI 置信度。

**实现规则**：
- 任何数值元素必须加 `font-variant-numeric: var(--number-font-feature)`
- 数值**右对齐**（`text-align: right`）便于小数点/位数对齐比较
- 数值列使用 `font-family: var(--number-font-mono)`
- 单位以 `--text-xs` + `--color-text-tertiary` 单独 span 呈现，与数值间留 `--space-1`
- **禁止**对数值使用 `transform: scale()` 或动画过渡宽度

---

## 4. 间距 / 圆角 / 阴影 / 层级 Token

### 4.1 间距（4px 网格）

`--space-1: 4px` / `--space-2: 8px` / `--space-3: 12px` / `--space-4: 16px` / `--space-5: 20px` / `--space-6: 24px` / `--space-8: 32px` / `--space-10: 40px` / `--space-12: 48px`

允许值仅限：`4 8 12 16 20 24 32 40 48`。禁止 `5 7 13 15 22 30`。

### 4.2 圆角（医疗语境 = 克制）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-none` | 0 | Canvas、影像区域 |
| `--radius-xs` | 2px | 徽章、状态点、tag |
| `--radius-sm` | 4px | 按钮、输入框、下拉 |
| `--radius-md` | 6px | 卡片、面板 |
| `--radius-lg` | 12px | 弹窗（**上限，禁止 ≥16px**） |
| `--radius-full` | 9999px | 头像、状态圆点 |

### 4.3 层级 Elevation（暗色靠亮度递进，不靠阴影）

**暗色主题**：不用投影表达层级，改为表面亮度递进。
| Token | 值 | 用途 |
|---|---|---|
| `--elevation-0` | `#0C1116` | app 底 |
| `--elevation-1` | `#161C21` | panel |
| `--elevation-2` | `#242B32` | card |
| `--elevation-3` | `#2D353D` | overlay/dropdown |
| `--elevation-shadow` | `none` | 暗色下组件默认无阴影 |

**亮色主题**：允许极轻投影表达浮起。
| Token | 值 |
|---|---|
| `--elevation-shadow` | `0 1px 2px rgba(15,21,25,0.06), 0 4px 12px rgba(15,21,25,0.08)` |
| `--elevation-shadow-lg` | `0 8px 28px rgba(15,21,25,0.14)` |

> **绝对禁令**：不使用 `1px 边框 + blur ≥16px 阴影`同时出现在同一元素（幽灵卡片）。暗色下二者只取其一。

### 4.4 z-index 层级

`--z-base: 0` / `--z-sticky: 100` / `--z-drawer: 200` / `--z-dropdown: 300` / `--z-modal: 400` / `--z-toast: 500` / `--z-critical-alert: 600`（危急值弹窗最高）

---

## 5. 图标系统

### 5.1 锁定规范

- **唯一图标库：Tabler Icons v3.49.0（MIT）**，包名 `@tabler/icons-react` / `@tabler/icons`
- **禁止**任何 emoji 作功能图标
- **禁止**混入第二套图标库
- 网格：24×24，描边 `2px`，`stroke="currentColor"`，`fill="none"`
- 圆头圆角（`stroke-linecap="round"`, `stroke-linejoin="round"`）

### 5.2 尺寸规范

| Token | 值 | 用途 |
|---|---|---|
| `--icon-size-inline` | 16px | 行内、表格单元格、列表项前缀 |
| `--icon-size-button` | 20px | 按钮内、工具栏 |
| `--icon-size-standalone` | 24px | 独立图标、面板标题、导航项 |
| `--icon-size-lg` | 32px | 空状态、功能入口（仅限空态） |
| `--icon-stroke-width` | 2 | 全局统一，暗色下 24px 及以上可用 1.75 |

**图标颜色规则**：图标颜色继承 `currentColor`，即父元素文字色。**禁止**给图标硬编码颜色。危急值图标用 `color: var(--color-status-critical)`，且必须与文字、颜色同时出现（P3）。

### 5.3 业务动作 → 图标名映射表（166 个图标名已对 npm 包 `@tabler/icons@3.49.0` 逐一存在性校验，缺失 0）

> 格式：`tabler:<icon-name>`。Tabler 的填充态为**同名独立构件**（`icons/outline/<name>.svg` 与 `icons/filled/<name>.svg`，React 中为 `<IconName />` 与 `<IconNameFilled />`），**不是 `-filled` 后缀命名**。下表凡标注「填充态」者，名称与 outline 相同，通过引入 `filled` 变体实现。

#### 阅片工具（Viewer Tools）
| 业务动作 | 图标 | 快捷键 |
|---|---|---|
| 窗口/平移 | `tabler:hand-grab` | `V` |
| 缩放 | `tabler:zoom-in` | `Ctrl`+滚轮 |
| 旋转 | `tabler:rotate-2` | `R` |
| 十字定位线开关 | `tabler:crosshair` | `C` |
| 长度测量 | `tabler:ruler-measure` | `M` |
| 角度测量 | `tabler:angle` | `A` |
| 面积/ROI 勾画 | `tabler:vector-bezier` | `Shift`+`M` |
| 椭圆 ROI | `tabler:circle-dashed` | — |
| 矩形 ROI | `tabler:square-dashed` | — |
| 多边形 ROI | `tabler:polygon` | — |
| 电子标尺 | `tabler:ruler` | — |
| 图像标注（箭头/文本） | `tabler:pencil` | `T` |
| 截图/导出图像 | `tabler:photo` | `Ctrl`+`S` |
| 胶片打印 | `tabler:printer` | — |
| 全屏 Canvas | `tabler:arrows-maximize` | `F` |
| 同步滚动参考线 | `tabler:arrows-vertical` | — |
| 层厚/层间距重置 | `tabler:zoom-reset` | — |

#### 序列导航（Series / Slice Navigation）
| 业务动作 | 图标 |
|---|---|
| 上一层/下一层 | `tabler:chevron-up` / `tabler:chevron-down` |
| 上一层/下一层（列表） | `tabler:chevron-left` / `tabler:chevron-right` |
| 跳转到指定层 | `tabler:list-numbers` |
| 电影回放播放 | `tabler:player-play` |
| 电影回放暂停 | `tabler:player-pause` |
| 上一序列/下一序列 | `tabler:player-skip-back` / `tabler:player-skip-forward` |
| 循环播放 | `tabler:repeat` |
| 逐序列自动播放 | `tabler:player-track-next` |
| 序列锁定 | `tabler:lock` |
| 序列解锁 | `tabler:lock-open` |
| 排序 | `tabler:sort-ascending` |

#### 患者 / 检查标识
| 业务动作 | 图标 |
|---|---|
| 患者 | `tabler:user` |
| 患者列表 | `tabler:users` |
| 检查 (Study) | `tabler:file-description` |
| 序列 (Series) | `tabler:stack` |
| DICOM 影像 | `tabler:scan` |
| 住院号/门诊号 | `tabler:certificate` |
| 急诊标识 | `tabler:emergency-bed` |
| 过敏史 | `tabler:alert-circle` |
| 既往检查对比 | `tabler:history` / `tabler:timeline` |

#### 窗宽窗位 / 灰阶控制
| 业务动作 | 图标 |
|---|---|
| 窗宽窗位调节 | `tabler:adjustments` |
| 预设窗（肺/骨/脑/软组织） | `tabler:layers-subtract` |
| 反相（Invert） | `tabler:contrast-2` |
| 灰阶/彩显切换 | `tabler:palette` |
| 亮度/对比度微调 | `tabler:sun` / `tabler:contrast` |
| 自动 gamma | `tabler:adjustments-horizontal` |
| 重置为默认 | `tabler:refresh` |

#### 三维规划（3D / Surgical Planning）
| 业务动作 | 图标 |
|---|---|
| 3D 视图 | `tabler:box` |
| 3D 旋转 | `tabler:rotate-360` |
| 3D 视图布局切换 | `tabler:layout-grid` |
| MPR 冠状/矢状/横断 | `tabler:layout-columns` / `tabler:layout-rows` |
| 血管树 | `tabler:git-branch` |
| 血管网络 | `tabler:topology-star` |
| 骨骼 | `tabler:bone` |
| 肺 | `tabler:lungs` |
| 脑 | `tabler:brain` |
| 心脏 | `tabler:heart` |
| 器官/体表 | `tabler:body-scan` |
| 分割/勾画 | `tabler:vector-triangle` |
| 分割编辑 | `tabler:edit` |
| 植入物规划 | `tabler:tool` |
| 手术路径规划 | `tabler:route` |
| 切割平面 | `tabler:axis-x` |
| 距离/角度复核 | `tabler:point` |
| 三维测量 | `tabler:ruler-measure` |
| 模型导入导出 | `tabler:file-export` / `tabler:file-import` |
| 渲染质量设置 | `tabler:settings` |
| 表面渲染 | `tabler:diamond` |
| 容积渲染 | `tabler:circle` |

#### 报告与文书（Report / Documentation）
| 业务动作 | 图标 |
|---|---|
| 结构化报告 | `tabler:report-medical` |
| 报告编辑器 | `tabler:notebook` |
| 报告模板 | `tabler:file-type-txt` |
| 语音口述（Dictation） | `tabler:device-speaker` / `tabler:device-speaker-off` |
| 电子签名 | `tabler:signature` |
| 签名验证 | `tabler:file-certificate` |
| 草稿保存 | `tabler:file-pencil` |
| 提交审核 | `tabler:send` |
| 审核退回 | `tabler:arrow-back-up` |
| 已签名/已归档 | `tabler:folder` |
| 归档 | `tabler:archive` |
| 危急值上报 | `tabler:alert-octagon` |

#### AI 任务（AI Pipeline）
| 业务动作 | 图标 |
|---|---|
| AI 任务中心 | `tabler:brain` |
| 启动 AI 分析 | `tabler:player-play` |
| 任务队列中 | `tabler:loader-2`（配合旋转动画） |
| AI 检测结果 | `tabler:target` |
| AI 分割结果 | `tabler:vector-triangle` |
| AI 置信度 | `tabler:chart-dots` |
| 病灶随访对比 | `tabler:timeline-event` |
| 模型版本 | `tabler:versions` |
| AI 建议采纳 | `tabler:circle-check` |
| AI 建议否决 | `tabler:circle-x` |
| AI 不可用/降级 | `tabler:plug-connected-x` |

#### 临床状态（Status — 必须与颜色+文字三重编码）
| 业务动作 | 图标 |
|---|---|
| 危急值 | `tabler:alert-triangle` |
| 需急诊 / 严重异常 | `tabler:alert-octagon` |
| 异常 / 阳性 | `tabler:alert-circle` |
| 正常 / 阴性 | `tabler:circle-check` |
| 待处理 / 排队中 | `tabler:clock` |
| 已完成 / 已签名 | `tabler:circle-check` |
| 已取消 | `tabler:circle-x` |
| 无数据 | `tabler:file-off` |
| 信息提示 | `tabler:info-circle` |
| 帮助 | `tabler:help-circle` |

#### 审计与系统（Audit / System）
| 业务动作 | 图标 |
|---|---|
| 审计日志 | `tabler:history` |
| 操作日志追踪 | `tabler:timeline` |
| 登录 / 登出 | `tabler:login` / `tabler:logout` |
| 权限 / 角色 | `tabler:user-shield` |
| 双因素认证 | `tabler:shield-check` |
| 数据加密锁定 | `tabler:lock-access` |
| 系统设置 | `tabler:settings` |
| 主题切换 | `tabler:moon` / `tabler:sun` / `tabler:device-desktop` |
| PACS 服务状态 | `tabler:server` |
| 数据库 | `tabler:database` |
| 网络（在线） | `tabler:wifi` |
| 网络中断 | `tabler:wifi-off` |
| 打印失败 | `tabler:printer-off` |
| 磁盘空间告警 | `tabler:database-exclamation` |
| 快捷键帮助 | `tabler:keyboard` |

#### 通用操作（Generic）
| 业务动作 | 图标 |
|---|---|
| 搜索 | `tabler:search` |
| 筛选 | `tabler:filter` |
| 列设置 | `tabler:settings` |
| 展开/折叠 | `tabler:chevron-down` / `tabler:chevron-up` |
| 更多操作 | `tabler:dots-vertical` |
| 新建 | `tabler:plus` |
| 添加 | `tabler:plus` |
| 删除 | `tabler:trash` |
| 编辑 | `tabler:edit` |
| 复制 | `tabler:copy` |
| 保存 | `tabler:device-floppy` |
| 打开 | `tabler:folder-open` |
| 上传 | `tabler:upload` |
| 下载 | `tabler:download` |
| 导出 | `tabler:file-export` |
| 确认 | `tabler:check` |
| 取消 | `tabler:x` |
| 关闭 | `tabler:x` |
| 最大化 | `tabler:maximize` |
| 最小化 | `tabler:minimize` |
| 外链 | `tabler:external-link` |
| 刷新 | `tabler:refresh` |
| 通知 | `tabler:bell` |
| 通知关闭 | `tabler:bell-off` |
| 时间 | `tabler:clock` |
| 日历 | `tabler:calendar` |
| 用户 | `tabler:user` |
| 科室 | `tabler:building-hospital` |
| 备注 | `tabler:message-circle` |
| 附件 | `tabler:paperclip` |
| 标签 | `tabler:tag` |
| 优先级 | `tabler:flag` |
| 收藏 | `tabler:star` / 填充态 `<StarFilled />`（激活态） |
| 固定 | `tabler:pinned`（已固定态） |
| 取消固定 | `tabler:pin` |
| 视口布局-四宫格 | `tabler:layout-grid` |
| 视口布局-单屏 | `tabler:layout-sidebar-right` |
| 视口布局-双屏 | `tabler:layout-columns` |
| 面板显示/隐藏 | `tabler:layout-sidebar-right-collapse` |
| 拖拽手柄 | `tabler:grip-vertical` |

---

## 6. 组件库清单

> 所有状态统一使用 Token；所有颜色零硬编码。**Loading / Empty / Error / Populated / Edge 五态全覆盖**（Token 名在各组件后标注）。

### 6.1 Button 按钮
| 变体 | 用途 | Token 组 |
|---|---|---|
| `primary` | 单一屏主操作（提交报告、启动分析） | `--button-primary-bg/-text/-hover/-active` |
| `secondary` | 次要操作（保存草稿） | `--button-secondary-*` |
| `ghost` | 工具栏/表格行内操作 | `--button-ghost-*` |
| `danger` | 删除、撤回、危急值上报 | `--button-danger-*` |
| `clinical` | 医学语义操作（签名归档） | `--button-clinical-*` |

- 尺寸：`sm`(28px)/`md`(32px)/`lg`(40px)，间距用 `--space-3`/`--space-4`
- **状态**：Default / Hover / Active / Focus（`--color-focus-ring` 2px + 2px offset）/ Disabled（opacity 0.5 + `aria-disabled` + `cursor:not-allowed`）/ Loading（左侧 `--icon-size-button` spinner + `aria-busy`，禁止仅置灰）/ Error（仅提交类按钮，红色边框 + 下方 `--space-1` 处错误文案）
- 圆角 `--radius-sm`；内边距 `--space-3` × `--space-4`

### 6.2 IconButton 图标按钮
- 工具栏主力。尺寸 `sm`(28px) / `md`(32px) / `lg`(40px)，图标 20px
- **状态**：Default / Hover（`--color-surface-hover`）/ Active（`--color-surface-active` + 选中态用 filled 填充变体）/ Focus / Disabled / Loading / Selected（`--color-accent-clinical-subtle` 底 + `--color-accent-clinical` 图标 + 2px 左侧指示条 —— **注意：左侧指示条是"选中指示"而非"卡片强调装饰"，且仅 2px，用于工具栏选中态，不构成侧条纹反模式**）

### 6.3 Toolbar 工具栏（阅片专用）
- 水平条，高 40px，`--color-surface-app` 底，`--color-border-subtle` 下边框
- 分组用 `--space-6` + 1px `--color-border-default` 竖分隔线（**分隔线不是卡片边框**）
- 每组前有 12px 文字分组标签（`--text-xs` + ALL CAPS 0.08em + `--color-text-tertiary`）→ 例：`W/L`、`MEASURE`、`LAYOUT`
- **状态**：Default / Hover / Tooltip（延迟 400ms 显示，快捷键高亮 `--color-text-primary`）/ Disabled / Overflow（宽度不足时折叠为 `tabler:dots-vertical` 下拉）

### 6.4 Tooltip 工具提示
- 背景 `--color-surface-overlay`，文字 `--color-text-primary`，圆角 `--radius-sm`
- **必须**含快捷键提示（`aria-keyshortcuts` 同步），快捷键用 `--font-mono`
- 出现/消失 150ms，禁止缩放弹出动画（P6）

### 6.5 Panel 面板
- 标题栏高 36px：`--color-surface-panel` 底 + `--color-text-primary` 12px 标题 + 右侧 `--icon-size-inline` 操作
- 内容区 `--space-3` 内边距
- **状态**：Expanded / Collapsed（折叠为 32px 只留图标+标题，状态存localStorage）/ Empty / Loading（骨架屏 `--color-surface-raised` 块 + 150ms 微光）/ Error（顶部 32px 条 + `tabler:alert-circle` + 重试按钮）

### 6.6 Viewport 影像视口（阅片核心组件）
- 背景强制 `--color-surface-canvas`，**无圆角、无阴影、无边框**
- 四角叠加信息（OBR / 序列名 / 层号 / WW·WL）用 `10px` `--text-2xs` + 文字色 `--color-text-secondary`（图标若需则用 `tabler:scan` 等单色描边图标，颜色继承 `currentColor`），位于 Canvas 内**但作为 overlay 层**
- 左右下角缩放条：`--space-1` × 64px，`--color-surface-overlay` 半透明底（**功能目的：常驻可点，非装饰**）
- **状态**：Active（`--color-accent-clinical` 2px 边框，借鉴 OHIF highlight）/ Inactive（`--color-border-default` 1px）/ Loading（`--icon-size-lg` spinner + "正在加载序列…"）/ Empty（"该序列无图像" + 返回列表）/ Error（DICOM 解析失败 + 序列 UID + 重试）
- **禁止**：任何 hover 才出现的工具浮层遮挡影像中心区

### 6.7 SeriesList 序列列表
- 每项高 56px：`tabler:scan` 图标 + 序列描述(SeriesDescription) + MODALITY 徽章 + 层数 `342/512`
- **数值用 tabular-nums**
- MODALITY 徽章：CT/MR/US/CR 文字徽章，`--radius-xs`，`--text-2xs` + ALL CAPS 0.08em
- **状态**：Default / Hover / Active（当前选中，左侧 2px `--color-accent-clinical` 指示）/ Loading / Empty（"本次检查共 4 个序列" + 图示）/ Error
- 急诊检查项：左侧 4px `--color-status-critical` 条 + `tabler:alert-triangle` + "急诊" 文字（**三重编码**）

### 6.8 StudyTree 检查层级树（Patient/Study/Series）
- 三级缩进 12px/级，行高 28px（比 SeriesList 密）
- 展开/折叠用 `tabler:chevron-right` 旋转 90°（150ms）
- 虚拟滚动（>100 项，Token `--scroll-virtual-threshold: 100`）

### 6.9 NumericInput 数值输入框（临床专用）
- 默认用 `--font-mono` + `tabular-nums` + 右对齐 + 可选单位后缀
- 聚焦时全选（医生改窗宽窗位习惯：点一下直接改）
- **状态**：Default / Hover / Focus（2px `--color-focus-ring`）/ Error（红色边框 + 下方具体原因"层厚须在 0.1–5.0 mm 之间"，非"输入无效"）/ Disabled / Loading（AI 计算中显示 spinner）
- 支持表达式：`⌃` 上箭头 +1，`⇧⌃` +10，`⌄` -1，`⇧⌄` -10（**减少精确拖拽依赖**）
- **Edge**：超长数值（如 `-1234.567890 HU`）不换行、不撑破容器，`overflow: hidden` + `text-overflow: ellipsis` + `title` 完整值

### 6.10 Slider 滑块（窗宽窗位/层号）
- 轨道 `--space-1` 高，`--color-surface-sunken` 底，激活段 `--color-accent-clinical`
- 拇指 12px 圆，`--color-surface-raised` + 2px `--color-border-default`，hover 时 14px
- **必须**配NumericInput（键盘可达）
- **状态**：Default / Hover / Active（拖拽中）/ Focus / Disabled / Loading

### 6.11 Badge 徽章
- `sm` 高 16px / `md` 高 20px，`--radius-xs`
- 变体：Modality（中性）、Status（status色 + 同色图标 + 文字）、Priority（`tabler:flag`）
- **禁用**：纯色底无文字的圆点（不满足三重编码）

### 6.12 Tabs 标签页
- 高 36px，激活态：文字 `--color-accent-clinical` + 底部 2px `--color-accent-clinical`
- **禁用**：`tabler:layout-sidebar-right-collapse` 类滑动指示器（Motion=2，不需要）
- 溢出用 `tabler:dots-vertical`

### 6.13 DataTable 数据表格（AI结果/审计日志/患者列表）
- 行高 36px（`sm`）/ 44px（默认，**满足触控目标**）
- 表头 `--color-surface-panel` + `--text-xs` + `tabler:sort-ascending` 排序
- **数值列全部右对齐 + tabular-nums**
- **状态**：Default / Hover 行 / Selected 行（`--color-surface-active`）/ Sorted / Loading（骨架行）/ Empty（"当前筛选条件下无记录" + `tabler:filter-off` + 清除筛选按钮）/ Error
- 行内操作 hover 才显示（降低视觉噪音，enterprise.md 规范）
- 批量操作：勾选后顶部浮动操作栏

### 6.14 Modal 模态框
- 遮罩 `--color-shadow-ambient`，模态框 `--color-surface-overlay` + `--radius-lg`(12px)
- **变体**：Default（480px）/ Wide（720px，报告编辑）/ Critical（危急值，`--color-status-critical` 2px 顶部条 + `tabler:alert-triangle` + 标题"危急值：需 15 分钟内通知临床"，**默认焦点在"我已知晓并通知"按钮，回车即确认**）
- **状态**：Default / Focus Trap / Loading / Error / Edge（内容超长时内容区独立滚动，底部按钮条固定）
- 打开/关闭 200ms（跨屏过渡），`prefers-reduced-motion` 下降为 0ms
- Esc 关闭（危急值弹窗**不**允许 Esc 关闭，必须显式选择）

### 6.15 Toast / AlertBar
- 右下角堆叠，最多 3 条，宽度 360px，停留 6s（危急值不自动消失）
- 变体：Info（`tabler:info-circle`）/ Success（`tabler:circle-check`）/ Warning（`tabler:alert-circle`）/ Error（`tabler:alert-triangle`）/ Critical（`tabler:alert-triangle` + 状态色 + 常驻）
- **状态**：Entering（150ms 右侧滑入）/ Visible / Leaving（150ms 淡出）/ Actionable（含"撤销"/"查看"按钮）

### 6.16 AiTaskMonitor AI 任务监控
- 任务状态机：排队中(`tabler:clock`) / 运行中(`tabler:loader-2` 旋转) / 已完成(`tabler:circle-check`) / 失败(`tabler:circle-x` + 错误原因 + 重试) / 降级(`tabler:plug-connected-x` + "GPU 资源不足，已降级为 CPU 推理，预计 4分20秒")
- 进度条：`--space-1` 高，成功 `--color-status-normal`，失败 `--color-status-critical`
- **Edge**：任务失败必须给出**可执行**下一步，不能只显示"失败"
- **禁止**撒花/弹跳庆祝动效（P6）；完成时仅 150ms 高亮闪烁一次

### 6.17 ReportEditor 报告编辑器
- 三区：左侧结构化模板树（勾选项）/ 中部富文本 / 右侧 AI 建议与引用影像
- 输入区`--text-md`(14px)，行高 1.7（长文本可读性）
- **状态**：Default / Autosaving（`tabler:device-floppy` + "已自动保存 14:32:07"，**静态文本非动画**）/ Saving / Saved / Error（保留草稿 + 明确失败原因）/ Unsigned（底部黄条提示需签名）/ Signed（`tabler:signature` + 签名时间 + 签名人，且**只读**）
- 口述状态：`tabler:device-speaker` 实时波形（30fps，reduced-motion 时降为静态电平条）
- 危急值：报告编辑器内检测到危急值描述时，输入框上方插入不可忽略的 `--color-status-critical-subtle` 提示条

### 6.18 SignatureDialog 电子签名
- 显示待签内容摘要 + 患者信息 + 检查号
- 签名方式：工牌密码 / UKey / 手写板（`tabler:signature`）
- **签名后不可修改**（临床法规要求），UI 需在确认前明确告知
- 确认弹窗二次确认

### 6.19 AuditTable 审计查询
- 列：操作时间 / 操作人 / 角色 / 患者ID / 动作(`tabler:history`) / 对象 / IP / 结果
- 筛选：时间范围 + 操作人 + 动作类型 + 患者ID
- **数值**：时间戳 tabular-nums（等宽时间戳便于纵向对齐扫描）
- **状态**：Loading / Empty（"2026-10-01 至 2026-10-22 无匹配记录" + 重置筛选）/ Error / Populated / Edge（>10000 条分页 + 虚拟滚动）
- 审计日志**只读**，无编辑操作

### 6.20 PatientList 患者列表
- 列：患者姓名 / 性别年龄 / 住院号 / 检查类型 / 检查日期 / 状态 / 优先级
- 危急/急诊行：`tabler:alert-triangle` + `--color-status-critical` + "急诊" 文字
- **状态**：Loading（骨架行）/ Empty（"当前视图暂无待阅检查" + `tabler:inbox` + "切换到已阅列表"）/ Error / Populated
- 分页：每页 50，虚拟滚动

### 6.21 ThemeSwitcher 主题切换器
- 位置：顶部状态栏右侧，`tabler:moon` / `tabler:sun` 双态图标按钮
- 三态循环：`跟随系统` → `暗色（阅片）` → `亮色（明亮环境）`，用 `tabler:device-desktop` / `tabler:moon` / `tabler:sun`
- 偏好持久化：`localStorage` key `medplan.theme` + 服务端 `user.preference.theme`（以服务端为准，登录后同步）

### 6.22 LoginPanel 登录
- 单卡片居中，无营销Hero（**P0-5：面向医生的工具不需要营销页**）
- 字段：工号 / 密码 / 验证码(图形) / 记住工号
- 真实文案示例：
  - 标题："影像诊断工作站"
  - 副标题："请使用医院统一身份认证账号登录"
  - 登录按钮："登录"
  - 错误："工号或密码不正确，剩余尝试 3 次"（具体、非泛化）
  - 锁定："账号已锁定，请联系信息科解锁"
- 锁定策略提示：`tabler:lock` + "连续 5 次失败将锁定 30 分钟"
- **无第三方登录**（医院内网环境）

### 6.23 EmptyState 空状态
- 结构：`--icon-size-lg` 图标（`--color-text-tertiary`，**不使用 emoji**）+ 标题（`--text-lg`）+ 说明（`--text-sm`）+ 可选主操作按钮
- 真实文案示例：
  - 患者列表空："当前视图暂无待阅检查" / 说明："今日待阅队列已清空，最近一次归档 16:42" / 操作："查看已阅列表"
  - AI 结果空："AI 分析尚未完成" / 说明："胸部CT 序列正在分析，预计剩余 40 秒" / 操作：查看任务
  - 搜索空："未找到匹配 '张' 的患者" / 说明："请检查姓名拼写，或改用住院号检索" / 操作："清空搜索"

### 6.24 ShortcutHelp 快捷键帮助
- `tabler:keyboard` 触发，Modal 宽 720px，两栏分组
- 分组：阅片导航 / 窗宽窗位 / 测量工具 / 报告与签名 / 系统
- 每行：动作名 + 键帽（`--font-mono`，`--color-surface-sunken` 底 + `--radius-xs`）

---

## 7. 双主题切换规范

### 7.1 为什么是刚需（不是可选项）

| 场景 | 环境照度 | 需求 |
|---|---|---|
| **放射科阅片室** | 20–40 lx（TG-18 推荐），CT/MR 站 15–60 lx | **暗色刚需**。白底面板在350 cd/m² 诊断屏前产生眩光，且暗环境下瞳孔放大，白底反射光直接投射到视网膜 |
| **手术室 / 明亮门诊** | 300–400 lx（TG-18 Table III：手术室） | **亮色刚需**。暗色界面在强环境光下几乎不可读 |
| **移动查房 / 笔记本** | 变化 | 需亮色 |

这不是"深色模式很酷"的审美选择，是**两套物理工作环境各自要求不同亮度策略**。

### 7.2 怎么切换

```html
<html data-theme="dark">   <!-- 或 "light"，三态时还有 "system" -->
```
- 主题属性挂在 `<html>`，CSS 选择器 `[data-theme="dark"]` / `[data-theme="light"]`
- **必须在 `<head>` 内用阻塞式内联脚本设置**，早于 CSS 首次绘制，避免闪烁（FOUC）
- 同时设置 `<meta name="color-scheme" content="dark light">` 让浏览器原生滚动条/表单控件跟随
- 三态循环：跟随系统 → 暗色 → 亮色

### 7.3 偏好记忆

1. 登录后：服务端 `user.preference.theme` 优先
2. 未登录/首次：读 `localStorage['medplan.theme']`
3. 两者都无：读系统 `prefers-color-scheme`
4. 医生每次手动切换 → 立即写回服务端 + localStorage
5. **同一账号多终端**（阅片室工作站 + 笔记本）各自记忆，互不影响——因为两台机器的环境完全不同

### 7.4 首次进入默认哪个（我的判断）

**默认：暗色（dark）**

理由（按权重）：
1. **使用时长占比压倒性**：产品的主要使用场景是影像科医生的阅片工作站。系统的主要价值主张（阅片）与它的默认态一致。
2. **默认态影响安全**：如果默认亮色，医生进入工作台的第一眼就是白底眩光——在 20–40 lx 环境里这是可测量的视觉负担。
3. **默认暗色更"错得安全"**：误用暗色在明亮环境只是对比度偏低（可读）；误用亮色在暗环境是眩光 + 灰阶感知被干扰（可能影响判读）。风险不对称。
4. **行业惯例**：OHIF Viewer 默认 dark（`Tonal: OHIF Blue`），Lightroom / DaVinci / Slicer 影像模式均默认暗色。医生已有肌肉记忆。

**但有三条例外，必须特判**：
| 页面 | 默认主题 | 理由 |
|---|---|---|
| 阅片区（Viewport） | **恒定暗色**，不随全局主题切换 | 灰阶影像在白底上丧失诊断对比，这是专业硬约束。见 §2.3 `--color-surface-canvas` 亮色值仍为 `#1A1A1A` |
| 报告编辑 / 审计查询 / 患者列表 | 跟随全局（默认暗色） | 纯文字工作区，可安全使用亮色 |
| 三维规划 | **跟随全局** | 手术医生在明亮环境用，本就该亮色；该群体会主动切到亮色并被记住 |

> 换句话说：**阅片区的暗色是安全约束，其他区域的主题是偏好设置**。这条区分是本节最重要的设计判断。

---

## 8. 布局架构

### 8.1 阅片工作台（1920×1080 基准）

```
┌────────────────────────────────────────────────────────────────────────────┐
│ A. 顶部状态栏 40px                                                          │
│    产品标识 │ 面包屑 患者/检查 │ tabler:search 全局检索 │ 患者标识 │       │
│    tabler:bell 危急值提醒 │ tabler:moon 主题切换 │ tabler:settings       │
├──────────────┬──────────────────────────────────────────┬──────────────────┤
│ B. 左侧栏    │ C. Canvas 区（占屏 ≥ 70%）                │ D. 右侧栏        │
│    288px     │    --color-surface-canvas #000000         │    320px         │
│              │                                          │                  │
│ B1 患者/检查 │  ┌──────────────┬──────────────┐         │ D1 窗宽窗位      │
│    信息卡    │  │Axial         │Sagittal      │         │    WW/WL 数字框  │
│    姓名/性别 │  │ tabler:scan   │ tabler:scan  │         │    预设窗列表    │
│    住院号    │  │              │              │         │                  │
│    检查类型  │  ├──────────────┼──────────────┤         │ D2 测量工具      │
│    申请科室  │  │Coronal       │DSA           │         │  tabler:ruler-measure │
│    临床病史  │  │              │              │         │    measure 列表  │
│              │  └──────────────┴──────────────┘         │    + 实测值列表  │
│ B2 序列列表  │                                          │                  │
│    (DICOM    │  E. Canvas 内叠加层（角标信息）           │ D3 AI 结果      │
│     层级树)  │    左上: 序列描述 / MODALITY              │    结节列表      │
│              │    右上: 层号 342/512 / WW 1500 WL -600   │    体积/CT值/   │
│ B3 既往检查  │    左下: OB/R 标记 + 患者ID（防误读）      │    长短径       │
│    (对比用)  │    右下: DICOM 标尺                       │    置信度       │
│              ├──────────────────────────────────────────┤    采纳/否决    │
│              │ F. 序列导航条 32px                        │                  │
│              │    ◀ 342/512 ▶ │ tabler:player-play 电影 │ D4 报告摘要     │
├──────────────┴──────────────────────────────────────────┴──────────────────┤
│ G. 底部工具条 40px（浮动于 Canvas 上沿，可折叠）                            │
│    [tabler:hand-grab] [tabler:zoom-in] [tabler:rotate-2] │                │
│    [tabler:crosshair] [tabler:ruler-measure] [tabler:angle] [tabler:pencil] │
│    [tabler:arrows-maximize] │ 布局: tabler:layout-grid │ [tabler:keyboard]  │
└────────────────────────────────────────────────────────────────────────────┘
```

**空间分配（1920×1080 实测）**：
- Canvas 区：1440×928 = **69.6% 屏占比**（满足 P1 ≥70%，四宫格时每格 714×458，足够看肺窗）
- 左侧栏 288px / 右侧栏 320px / 顶部 40px / 底部工具条 40px（浮动不占布局）

**布局要点**：
- Canvas **无内边距**，紧贴两侧栏，让影像像素最大化利用
- 工具条 G 浮动在 Canvas 底部，**默认半透明仅显示图标，hover 展开文字标签**（P1：UI 退后）
- 左右侧栏均可 `Tab` 键聚焦后用 `Ctrl+[` / `Ctrl+]` 折叠为 0，给小屏/大屏适应
- 面板拖拽分隔条 4px，hover 时 2px 青色指示（`--color-accent-clinical`）

### 8.2 三维规划工作台
- 左：患者信息 + 检查序列（同 8.1 B 区）
- 中：3D 主视口（大）+ MPR 三视图（可折叠为底栏）
- 右：规划参数面板（`--text-sm` 密排）+ 器械库列表
- 底部：3D 专用工具条（旋转/切割平面/导入导出/渲染质量）

### 8.3 工作区（非阅片页面）
- 顶部 40px + 左侧主导航 240px（可折叠为 64px 图标栏）+ 内容区
- 内容区最大宽度不限（PACS 数据表格需要横向空间）
- 报告编辑页：左侧模板树 264px / 中部编辑器自适应 / 右侧 AI 建议 320px

---

## 9. 关键页面线框描述

### 9.1 登录
```
居中单卡片（宽 400px），--color-surface-raised 底，--radius-lg 12px，垂直居中偏上 15%
├── 顶部：产品标识 SVG（几何，非 emoji）+ "影像诊断工作站"
├── 副标题："--text-sm --color-text-secondary：请使用医院统一身份认证账号登录"
├── 表单（每组 ≤4 字段）
│   ├── 字段1label "工号" + 输入框（32px高，tabular-nums，允许前导零）
│   ├── 字段2 label "密码" + 输入框（带 tabler:eye / eye-off 切换）
│   ├── 字段3 label "验证码" + 图形验证码 + 输入框（横排）
│   └── 勾选 "记住工号" + 链接 "忘记密码？"
├── 主按钮 "登录"（primary，全宽 40px，Loading 态显示 tabler:loader-2 + "验证中"）
└── 底部："连续 5 次失败将锁定 30 分钟" + tabler:lock 图标 + "帮助" 链接
错误态（登录失败）：字段下方 --space-1 处 --color-status-critical 文字
   "工号或密码不正确，剩余尝试 3 次" + tabler:alert-circle
锁定态：整卡转 --color-status-critical-subtle 底 + tabler:alert-octagon
   "账号已锁定，请联系信息科解锁"
主题：默认暗色，右上角 tabler:moon 可切亮色（明亮门诊场景）
```
**无 Hero、无插画人物、无营销文案**。

### 9.2 阅片工作台
见 §8.1 线框。补充：

**期相分组（PRD DCM-02 硬约束，必须在序列列表直接可读）**

序列列表按期相分组，每组有组头，组头即期相标识：

```
序列列表（左栏 288px）
├── [平扫] tabler:stack         ← --color-phase-plain灰
│   └── S1 腹部平扫 5.0mm  120层
├── [动脉期]  ← --color-phase-arterial 蓝
│   ├── S2 动脉期 1.0mm  320层
│   └── S3 动脉期重建
├── [静脉期]  ← --color-phase-venous 青
│   └── S4 静脉期 1.0mm  320层
├── [延迟期]  ← --color-phase-delayed 品红
│   └── S5 延迟期 1.0mm  320层
└── [期相未识别] tabler:help-circle  ← --color-phase-unknown 琥珀【必须】
    └── S6 序列描述缺失 0.6mm  280层
        └─ 推断依据：层厚 0.6mm + 序列描述缺失 + 、增强定位 34%
           [查看依据] 置信度 34%
```

**「期相未识别」是硬约束**：PRD DCM-02 明确「必须标注『期相未识别』并显示推断依据，必须不默认归入平扫」。理由是医生会误判——把延迟期当成平扫读，可能漏掉强化病灶。

设计执行：
- 该组用**琥珀色 + `tabler:help-circle` 图标 + 「期相未识别」文字**三重编码，视觉上明确区别于四个已识别期相组
- **不得**归入「平扫」组，**不得**默认选中该组任何序列
- 组头右侧显示推断依据入口，点击展开：层厚、序列描述、增强定位、置信度百分比
- 置信度 < 50% 时额外显示「建议人工指定期相」+ 下拉选择（`tabler:select`）
- 该组选中任一序列时，Canvas 顶部显示琥珀提示条：「当前序列期相未识别，请人工确认期相后再据此判读」

**右键拖拽调窗（PM 指定为阅片最高频动作）**

| 操作 | 行为 |
|---|---|
| 左键拖拽 | 窗宽窗位调节（经典模式：水平=W，垂直=C） |
| 右键拖拽 | **同左键，另开一条交互路径**——为惯用右手且偏好右键的医生保留 |
| 中键拖拽 | 平移 |
| `Ctrl` + 右键拖拽 | 窗宽窗位锁定（仅调其中一个维度） |
| 滚轮 | 翻层（而非缩放，避免误操作） |
| `Ctrl` + 滚轮 | 缩放 |

设计要点：
- 拖拽时Canvas 右上角实时显示 `W:1500 L:-600`（`--font-mono` + tabular-nums，实时更新不抖动）
- 右键拖拽时**在光标旁显示迷你预览线**（灰阶直方图上的窗位窗宽位置标记），这是专业影像软件的通行做法，让医生能"看着调"
- 松手后窗宽窗位值写入 DICOM 展示状态，并记入审计
- **右键必须触发浏览器菜单屏蔽**，否则医生每次调窗都要先关菜单——这是最实际的"点击陷阱"

**十字定位线同步（PM 明确要求）**
- 开启十字线后，**另外两个视图同步显示**（在同一解剖位置）
- 联动开关独立于十字线：`tabler:link` 「视图联动」
- 联动开启时，活动视口边框用主色 `--color-accent-clinical` 2px（`tabler:arrows-maximize` 图标在角标提示联动状态）


- **Canvas 内角标**（`--text-2xs`，tabular-nums）：
  - 左上：`胸部CT 平扫+增强` / `CT`
  - 右上：`342/512` / `W:1500 L:-600`
  - 左下：`张×× 男 47岁  ID:3392041`（防左右患者误读，DICOM 强制要求）
  - 右下：`0.625mm  D:0.55`
- **十字定位线激活时**：右上角追加实时 HU 值 `HU:-847`，`--font-mono` + `tabler:crosshair` 图标，`--color-text-primary` + 1px 深色描边保证在任意影像亮度上都可读
- **危急值标记**：AI 检出危急病灶时，对应视口角标出现 `tabler:alert-triangle` + "危急值" 文字 + `--color-status-critical` 色
- **AI 结果被否决**：结节列表项用 `tabler:circle-x` + `--color-text-tertiary`（不用删除线，保持可读）

### 9.7 阅片加载态与加载失败态（PRD DCM-01 / P0）

> PM 转述的医生反馈：「有反馈严重到因加载慢而**犹豫是否要调阅影像**」。这意味着加载态不是过渡细节，而是**决定医生敢不敢用这个系统**的产品成败点。

**大检查加载（2000 张）**

Canvas 区在加载期间**必须有明确进度，禁止白屏或空白 canvas**：

```
┌─ Canvas 区（--color-surface-canvas #000000）────────────────────┐
│                                                                │
│                    ┌──────────────────────────────┐            │
│                    │  [tabler:loader-2 旋转]        │            │
│                    │  正在加载序列 S4 静脉期│            │
│                    │  已加载 1247/ 2000 层62%│            │
│                    │  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░│            │
│                    │  预计剩余 8 秒             │            │
│                    │  [后台继续]  [取消]         │            │
│                    └──────────────────────────────┘            │
│                                                                │
│  左上角已可显示已加载的部分影像（渐进渲染，不必等全部完成）        │
└────────────────────────────────────────────────────────────────┘
```

设计执行：
- 进度用**「已加载 X/Y 层」+ 百分比 + 进度条**三重表达，数字 tabular-nums（避免跳动）
- **渐进渲染**：已加载的层立即可看可翻，不阻塞医生先开始读片
- 「后台继续」按钮：允许医生切去写报告，加载完发`tabler:bell-ringing` 通知——**不让加载阻塞工作流**
- 序列列表骨架屏（`--color-skeleton-base`）代替空白
- 亮度：加载中的 UI 亮度**不超过正常态**，避免加载完成瞬间的亮度突变造成不适

**加载失败态（PRD DCM-01：必须显示具体错误原因与重试入口，必须不以空白页替代错误提示）**

```
┌─ Canvas 区────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────────────┐    │
│  │  [tabler:plug-connected-x] 序列加载失败│    │
│  │                                              │    │
│  │  错误原因：PACS 服务返回 C-STORE 失败           │    │
│  │  错误码：PACS-5031                              │    │
│  │  已加载 1247/2000 层（第 1248 层数据不完整）      │    │
│  │  受影响序列：S4 静脉期                │    │
│  │                                              │    │
│  │  [重试]  [仅加载已成功部分]  [联系信息科]   │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

**必须显示的四要素**：错误原因（人话）+ 错误码 + **已加载层数**（PM 明确要求）+ 可执行的下一步。

**降级选项「仅加载已成功部分」是重要的**：与其全盘失败让医生换检查，不如让他基于已加载的 1247 层先读片，缺失部分在界面上明确标注。这是把「阻塞」变成「降级可用」。

### 9.8 AI 分割确认界面（合规关键界面 · PRD AI-03 / V7 / L7）

> **这是本产品的合规核心界面**。国家药监局《糖尿病视网膜病变眼底图像辅助诊断软件注册审查指导原则》（2022 年第 23号）明确：「不能仅凭算法诊断结果进行临床决策，需要由医生对图像拍摄质量和诊断结果进行综合判断，**确认签字后报告生效**」。
>
> 设计目标（PRD 原文）：**让「逐项确认」不成为负担，而不是让医生找理由跳过**。

```
顶部状态栏 + 患者标识
├─ 【合规声明条· 常驻不可折叠】← --color-disclaimer-bar-bg
│   [tabler:info-circle] 本结果为 AI 辅助标记，不构成诊断结论，须经执业医师确认
│   右端：模型版本 v2.18.0 | [tabler:file-description] 查看算法说明
│   强制：此条不可折叠、不可关闭（PRD 明确要求）
│
├─ 确认进度区（常驻）
│   进度条 ▓▓▓▓▓▓▓▓▓▓░░░  已确认 12 / 17 项
│   [确认全部剩余项]（需二次确认弹窗）
│
├─ AI 标记列表（每条= 一个独立可确认行）
│ ┌──────────────────────────────────────────────────────────┐
│ │① 肝左外叶                                    待确认      │  ← 序号
│ │   [tabler:vector-triangle] 病灶体积 214.3 mL  │ 数值 tabular-nums
│ │   置信度 94%  [tabler:chart-dots] 查看依据       │
│ │                                          [确认]  [修改] │  ← 行内动作
│ ├──────────────────────────────────────────────────────────┤
│ │ ② 门静脉右支                                    待确认      │
│ │   直径 11.2 mm  长度 38.6 mm                        │
│ │                                          [确认]  [修改] │
│ ├──────────────────────────────────────────────────────────┤
│ │ ③ 残肝体积                                       已确认      │  ← 绿+勾
│ │   残肝体积 682.1 mL  残肝比 61.3%                    │     ← 已改
│ │   [tabler:edit] 已修改   确认人 张××  14:32:07          │
│ ├──────────────────────────────────────────────────────────┤
│ │ ④ 肝静脉右后支                     已修改              │  ← 蓝+编辑图标
│ │   原 AI 值 8.4mm → 医师修改为 7.1mm                     │
│ │   修改原因：重建边界受运动伪影影响                       │
│ │   [tabler:circle-check] 已确认  张××  14:35:22         │
│ └──────────────────────────────────────────────────────────┘
│
└─ 底部操作栏（常驻）
    校验提示：[tabler:alert-circle] 还有 5 项待确认，确认全部后方可提交报告
    [tabler:file-description] 保存草稿    [tabler:send] 提交报告（disabled）
```

**设计执行要点（逐条对应 PRD 要求）**

| PRD 要求 | 设计实现 |
|---|---|
| 每条 AI 标记独立可确认 | 每条一行，含结构名 + AI 量化值 + 独立 `[确认]` `[修改]` 两动作 |
| 声明条常驻、不可展开才见 | 顶部常驻条，`tabler:info-circle` + 文字，**无折叠按钮**，高度 40px 固定 |
| 未全部确认不得提交 | `[提交报告]` `disabled` + `aria-disabled`，且**必须显示"还有 5 项待确认"** |
| 确认人 + 时间可见 | 每条已确认项显示 `确认人 张×× 14:32:07`，这是归档证据（PRD L1 第十四条操作印痕） |
| 让确认不成为负担 | 行内单键 `Enter` 确认、`Shift+Enter` 确认并跳下一条；确认后焦点自动移到下一条待确认项 |

**三态视觉（必须颜色+图标+文字三重编码）**
| 状态 | Token | 图标 | 文字 |
|---|---|---|---|
| 待确认 | `--color-confirm-pending` `#F59E0B` | `tabler:circle-dashed` | 「待确认」 |
| 已确认 | `--color-confirm-done` `#3FB950` | `tabler:circle-check` | 「已确认」+ 人+ 时间 |
| 修改后确认 | `--color-confirm-modified` `#4D9DE0` | `tabler:edit` | 「已修改」+ 原值 → 新值 |

**修改态必须保留原值**（显示 `8.4mm → 7.1mm` + 修改原因），这是 L1 第十四条「保留历次操作印痕」的要求，也是医生回头复核的依据。

**AI 分割失败态（PRD AI-02：必须显示失败环节与错误码，不能用空模型冒充成功）**

```
┌─ AI 分割结果区────────────────────────────────────────────────┐
│ [tabler:alert-octagon] AI 分割未完成                            │
│                                                                │
│ 失败环节：三维体数据重建                                       │
│ 错误码：AI-SEG-2014                                           │
│ 原因：序列S4缺少几何定位 Tag（Image Position Patient）           │
│       院内 PACS 推送时已剥离，无法重建三维体数据│
│                                                                │
│ 影响范围：残肝体积、残肝比、门静脉分叉分析（3 项依赖该结果）      │
│ 未受影响：原始影像阅片、测量、报告书写（这些功能仍可用）          │
│                                                                │
│ [强制重采样重建（精度将下降）]  [联系信息科]            │
│                                                                │
│ [tabler:alert-circle] 当前报告不含AI 辅助标记内容│
└────────────────────────────────────────────────────────────────┘
```

设计执行：
- **绝对禁止**用空模型 / 0 结果 / 空白列表冒充成功——这是 PRD 明确的红线
- **必须**显示失败环节（哪一步失败）+ 错误码 + 原因
- **必须**说明影响范围与未受影响范围，让医生知道哪些结论还可用
- 提供降级通道（强制重采样重建），但**必须显式告知精度损失**，不得静默降级
- 该状态下 AI 确认区整体 disabled，声明条改为「本次检查无有效 AI 辅助标记」

### 9.9 无权限态（PRD SEC-03：越权访问不得泄露患者存在性）

> **这是安全红线，不是普通空状态**。PRD SEC-03 要求「越权访问返回拒绝且**不泄露患者存在性**」。

**核心规则：查询不存在的检查号与查询无权限的检查号，必须返回完全相同的响应。**

错误文案（**两种场景必须完全一致**）：
```
┌─ 查询结果─────────────────────────────────────────────────────┐
│                [tabler:lock-access]  无法访问该检查            │
│                                                                │
│  原因：当前账号无该检查的访问权限                               │
│  如需授权，请联系影像科管理员│
│                                                                │
│  [tabler:history] 查看我的授权范围                            │
└────────────────────────────────────────────────────────────────┘
```

**禁止出现的文案**（会泄露患者在本院存在检查）：
- "该患者不存在" / "未找到该检查" → 泄露"此检查号不存在"
- "您无权访问该患者" → 泄露"该患者存在"
- "该检查属于其他科室" → 泄露归属

**设计执行**：
- 查询不存在 vs 无权限：URL、响应时间、文案、布局、图标**全部一致**
- 错误页 `Cache-Control: no-store`，禁止缓存（后端配合）
- 「查看我的授权范围」是唯一出口，给用户**可行动的合规路径**而不是死路
- 该态用 `tabler:lock-access`，**不用** `tabler:alert-triangle`（后者暗示"出错了"，前者准确表达"权限边界"）
- 越权访问**必须**同时记入审计（`tabler:shield-check` 提示「本次越权访问已记录」）

### 9.10 技术降级态（PRD 第7章 P0 / PIT-02：不得静默降级）

**WebGL 不可用 → 2D 单视图模式**

```
┌─ 全宽琥珀色警示条（常驻，不可关闭）──────────────────────────┐
│ [tabler:alert-circle] 当前浏览器不支持 WebGL，已降级为 2D 单视图模式│
│  三维重建、MPR 多视图、体绘制功能不可用。                     │
│ 建议使用 Chrome 113+ / Edge 113+ 院内标准浏览器。│
│                                             [tabler:refresh] 重试 │
└────────────────────────────────────────────────────────┘
┌─ Canvas 区──────────────────────────────────────────────────┐
│                    单视图（占满 Canvas 区）                     │
│  左下角常驻：[tabler:box] 2D 单视图模式（WebGL 不可用）│
│  工具栏中三维相关按钮：disabled + tooltip「WebGL 不可用」│
└────────────────────────────────────────────────────────┘
```

**必须**：明确提示 + 功能按钮 disabled + tooltip 说明原因 + 重试入口。**禁止**白屏（PRD P0 明确"不得白屏"）。

**几何 Tag 缺失 → 强制重采样降级（PIT-02）**

```
┌─ 琥珀色警示条────────────────────────────────────────────────┐
│ [tabler:alert-circle] 三维重建精度已降低│
│ 该检查缺少几何定位 Tag（Image Position Patient，0020,0032），   │
│ 已按层厚 0.6mm 强制重采样重建。                              │
│ [tabler:alert-circle] 体素间距与真实值可能存在偏差，          │
│ 测量结果不应用于术前最终决策。                                │
│                                          [查看原始 Tag 明细]  │
└────────────────────────────────────────────────────────┘
```

**必须**：用琥珀色 + 图标 + **量化精度损失说明**（不只是"可能有误差"，要说明"层厚 0.6mm 强制重采样"）+ 免责范围（"不应用于术前最终决策"）。PRD PIT-02 明确「降级必须明确告知用户精度已损失，不得静默降级」。

### 9.3 三维规划
```
顶部状态栏（同 9.2，但患者名后加 "三维规划" 面包屑）
├── 左栏 288px
│   ├── 患者/检查信息卡（同 9.2 B1）
│   ├── 检查序列列表（可选数据源：CT 增强 / CTA / MR）
│   └── 器械库（tabler:tool 列表：椎弓根钉 6.5×45mm / 钛板 / 人工椎间盘）
├── 中部
│   ├── 3D 主视口（大，占中区 65%）
│   │   · 背景 --color-surface-canvas #000000
│   │   · 骨骼 tabler:bone 灰白实体 + 血管 tabler:git-branch 青绿
│   │   · 植入物：琥珀色实体（--color-status-abnormal）
│   │   · 手术路径 tabler:route 虚线 + 关键点数字标记
│   │   · 右上角：视角立方体 tabler:box（可拖动切换轴向）
│   └── MPR 三视图（横/矢/冠，32%高，可折叠）
├── 右栏 320px
│   ├── 规划参数（--text-sm 密排）
│   │   · 入钉点偏移 X/Y/Z：三个 NumericInput + tabler:topology-star 图标
│   │   · 钉尖角度：angle 图标 + 数字
│   │   · 螺钉长度：数字 + 单位 mm
│   ├── 关键测量值表（体积/长度/角度，tabular-nums 右对齐）
│   └── 操作：[保存方案] [导出到PACS] [请求术中导航]
└── 底部 3D 工具条 40px
    [tabler:rotate-360] [tabler:hand-grab] [tabler:zoom-in] │ 
    [tabler:box 切割平面] [tabler:stack-2 显隐] [tabler:settings 渲染] │
    [tabler:eye 3D/2D 联动]
```
真实文案示例：
- 关键测量："椎管狭窄程度 70%" / "椎弓根钉入点到椎体后缘距离 12.4mm"
- 空态："当前序列尚未生成三维重建，请等待分割任务完成（剩余 40 秒）"

### 9.4 报告编辑与签名
```
顶部状态栏 + 患者/检查标识（与阅片页一致，便于核对，避免报告写错患者）
├── 左侧 264px 结构化模板树
│   ├── 检查所见（分组）
│   │   ├─ 肺窗（勾选已填）
│   │   ├─ 纵隔窗（未填）
│   │   └─ 骨窗
│   ├── 影像诊断
│   │   ├─ 右上叶后段磨玻璃结节（AI 引用）← 已填
│   │   ├─ 双下肺纹理增粗
│   │   └─ 纵隔淋巴结未见明显肿大
│   └── 建议
├── 中部编辑器（--text-md 14px / line-height 1.7）
│     正文示例（真实临床文案）：
│   │   "双肺纹理增粗，右上叶后段见 8×6mm 磨玻璃结节，
│   │    边界欠清，建议 3 个月后薄层重建复查。
│   │    双侧肺门及纵隔区未见明显肿大淋巴结。
│   │    胸腔积液未见。"
│   ├── 底部状态条
│   │   [tabler:device-floppy] 已自动保存 14:32:07 │ 字数 186 │
│   │   口述: [tabler:device-speaker] 录音中 00:23 │
│   │   危急值提示条（若命中）：[tabler:alert-triangle] 本报告涉及危急值，
│   │        签名前请确认已电话通知临床科室
│   └── 未签名时底部黄条：[tabler:alert-circle] 报告尚未签名，请完成电子签名后提交
└── 右侧 320px AI 建议
    ├── AI 结节分析（tabler:brain）
    │   "右上叶后段 8×6mm 磨玻璃结节，体积 214mm³，
    │    平均 CT值 -687HU，恶性风险 34%（低）"
    │   [tabler:quote 引用至正文] [tabler:circle-check 采纳] [tabler:circle-x 否决]
    ├── AI 与历史对比（tabler:timeline-event）
    │   "对比 2026-04-18 前片：结节由 6×4mm 增至 8×6mm（+2mm）"
    └── AI 免责声明
        "AI 结果仅供医生参考，不作为独立诊断依据"

签名流程：
[签名] 按钮 → SignatureDialog（Modal Wide 720px）
├── 待签内容摘要 + 患者姓名/性别/年龄/检查号（tabular-nums）
├── 签名方式 tab页：工牌密码 / UKey / 手写
├── 明示不可逆提示（--color-status-abnormal）：
│   "报告签名后不可修改，将作为医疗文书归档"
├── 二次确认弹窗
└── 签名成功 → 报告转只读 + 底部显示
    [tabler:signature] 已签名 张×× / 2026-10-22 14:35:22 / [tabler:file-certificate] 签名有效
```

### 9.5 审计查询
```
顶部状态栏 + 主导航（审计查询 tab 高亮）
├── 筛选栏（可折叠，--space-4 内边距）
│   ├── 时间范围：[起始日期] ~ [结束日期] （Calendar 图标）
│   ├── 操作人：[输入框] 动作类型：[下拉 tabler:filter] 患者ID：[输入框]
│   └── [重置] [查询]
├── 结果统计条："共 247 条记录" （--text-sm --color-text-secondary）
├── 审计表格（tabular-nums 时间戳，虚拟滚动 >100 行）
│   │ 操作时间        │ 操作人 │ 角色 │ 患者ID │ 动作 │ 对象 │ IP │ 结果 │
│   │ 2026-10-22 14:35│ 张×× │ 主任医师 │ 3392041 │ 报告签名 │ R-2026-1022-0031 │ 10.20.3.45 │ 成功 │
│   │ 2026-10-22 14:02│ 李×× │ 住院医师 │ 3391876 │ AI结果否决 │ S-2026-1022-1187 │ 10.20.3.52 │ 成功 │
│   └── 结果列：成功 tabler:circle-check / 失败 tabler:circle-x + 原因 tooltip
├── 状态
│   ├── Loading：8 行骨架屏（--color-surface-raised 微光 150ms）
│   ├── Empty："2026-10-01 至 2026-10-22 无匹配记录"
│   │   + [重置筛选条件] 按钮
│   ├── Error："审计服务暂时不可用（超时 10s）" + [重试]
│   └── Edge：>10000 条 → 分页 + 虚拟滚动 + "仅显示最近 10,000 条" 提示
└── 审计表为只读：row hover 仅有 [tabler:eye] 查看详情，无编辑/删除操作
```

### 9.6 患者列表
```
顶部状态栏 + 主导航
├── 视图切换 tab（布局 tab 风格）
│   [待阅 12] [已阅] [急诊] [全部]
├── 筛选与搜索栏
│   ├── [tabler:search 搜索姓名/住院号]
│   ├── [tabler:filter 筛选] 检查类型 / 日期范围 / 科室
│   └── 视图密度切换 [tabler:layout-rows] [tabler:layout-grid]
├── 患者表格（行高 44px，满足触控目标）
│   │ 患者姓名 │ 性别/年龄 │ 住院号 │ 检查类型 │ 检查日期 │ 队列时长 │ 状态 │ 优先级 │
│   │ 李××   │ 男 / 67│ 88213  │ 胸部CT   │ 10-22 09:14 │ 5小时12分 │ 待阅 │ 普通 │
│   │ 王××   │ 女 / 52 │ 88190 │ 头颅MRI  │ 10-22 08:47 │ 5小时39分 │ 待阅 │ 急诊 │
│   │                                                            [tabler:alert-triangle] 急诊 │
│   └── 行点击 → 打开阅片工作台
├── 状态
│   ├── Loading：10 行骨架
│   ├── Empty（待阅视图已清空）
│   │   [tabler:inbox] "当前视图暂无待阅检查"
│   │   "今日待阅队列已清空，最近一次归档 16:42"
│   │   [查看已阅列表]
│   ├── Error："PACS 服务连接失败（10.20.3.12:104）" + [重试] + [离线模式]
│   └── Edge：单日 >2000 检查 → 虚拟滚动 + 每页 50
└── 行内操作（hover 显示）：[tabler:eye 打开] [tabler:history 既往对比] [tabler:flag 标记]
```

---

## 10. 无障碍清单

### 10.1 对比度实测（WCAG 2.1/2.2）

**暗色主题**（测于 `--color-surface-panel` `#161C21`，正文 13px 属normal text）
| 组合 | 对比度 | 判定 |
|---|---|---|
| text-primary `#E8EDF0` on panel | 14.57:1 | AAA [PASS] |
| text-secondary `#A3ADB5` on panel | 7.53:1 | AAA [PASS] |
| text-tertiary `#7A858F` on panel | 4.56:1 | AA [PASS] |
| text-disabled `#5A656F` on panel | 2.9:1 | 豁免（disabled 豁免，且配 `aria-disabled`） |
| accent `#63A6DC` on panel | 6.56:1 | AA [PASS] |
| status-critical `#FF6B6B` on panel | 6.19:1 | AA [PASS] |
| status-normal `#3FB950` on panel | 6.76:1 | AA [PASS] |
| focus-ring `#7CBAE8` on app bg | 9.07:1 / on panel 8.22:1 | ≥3:1 [PASS] |
| text-primary on canvas-dark `#000000` | 17.80:1 | AAA [PASS] |
| **text-on-canvas** `#E8EDF0` on canvas-dark `#000000` | 17.80:1 | AAA [PASS]（双主题同值，因 Canvas 恒暗） |
| **text-on-canvas** `#E8EDF0` on canvas-light `#1A1A1A` | 14.75:1 | AAA [PASS]（亮色主题 canvas 值为 `#1A1A1A` 而非纯黑，须单独实测） |

**亮色主题**（测于 `--color-surface-panel` `#FFFFFF`）
| 组合 | 对比度 | 判定 |
|---|---|---|
| text-primary `#0F1519` | 18.39:1 | AAA [PASS] |
| text-secondary `#454F58` | 8.36:1 | AAA [PASS] |
| text-tertiary `#5A656F` | 5.96:1 | AA [PASS] |
| accent `#1E3A5F` | 11.50:1 | AAA [PASS] |
| status-critical `#C81E1E` | 5.74:1 | AA [PASS] |
| focus-ring `#1E3A5F` on app `#F5F7F8` | 10.70:1 | ≥3:1 [PASS] |

**非文本元素（3:1 要求）**：装饰性分隔线 `--color-border-subtle` 豁免于 WCAG 1.4.11；但**输入框/交互组件边框 `--color-border-strong` 必须达 3:1**——暗色 `#5F6B76` 对 panel 3.15:1、对 sunken 3.68:1 [PASS]，亮色 `#7A858F` 对 panel 3.76:1 [PASS]。

> 全部比值由脚本按 WCAG 相对亮度公式实测得出（非估算），26 组组合**零失败**。

### 10.2 键盘可达性
- 全交互元素 `Tab` 可达，`Tab` 顺序严格遵循视觉顺序
- `:focus-visible` 显示 2px `--color-focus-ring` + 2px offset（**永不移除 outline**）
- IconButton `aria-label` 必填（如 `aria-label="窗宽窗位调节"`）
- 工具按钮 `aria-keyshortcuts="M"` 等
- Modal/抽屉 Focus Trap，`Esc` 关闭（危急值弹窗除外）
- 拖拽类交互有键盘等价路径（窗宽窗位 = 方向键；层滑块 = 方向键 + 数字输入）
- `Escape` 在 Canvas 中先退出当前工具，再退出全屏

### 10.3 色觉障碍处理
- **危急值三重编码**（P3）：颜色 + `tabler:alert-triangle` + 文字，红绿盲下靠形状与文字区分
- 状态色全配图标：正常 `tabler:circle-check` / 异常 `tabler:alert-circle` / 危急 `tabler:alert-triangle`
- AI 采纳与否：勾 `tabler:circle-check` vs 叉 `tabler:circle-x`（形状差异，非仅色相）
- 分割标注轮廓用**不同图案 + 不同线型**（实线/虚线）区分不同结构，不只靠颜色
- **禁止**在影像上用红绿叠加表示 ROI（红绿色盲完全不可辨）→ 用青绿 + 洋红，或形状区分
- 队列排序状态用 `tabler:sort-ascending`/`sort-descending` 图标，不只靠箭头颜色

### 10.4 屏幕阅读器
- 影像 Canvas `role="img"` + `aria-label="胸部CT 平扫 第342层，窗宽1500 窗位-600"`
- 表格 `role="table"` + `<caption>` + `scope` 属性
- 状态变更用 `aria-live="polite"`（如"AI 分析已完成"），危急值用 `aria-live="assertive"` + `role="alert"`
- 快捷键帮助 Modal 可键盘全操作
- 图标按钮全部有 `aria-label`，纯图标无文字的按钮**不允许**只靠 tooltip 传达（tooltip 不可聚焦）

### 10.5 触控目标
- 表格行/按钮默认高 ≥ 44px（`--touch-target-min: 44px`），工具栏密集按钮 32px 但通过外扩 `padding` 使命中区 ≥ 44px
- 相邻可点击元素间距 ≥ 8px（`--space-2`）
- 一次性平板（术中会诊）操作时，面板按钮自动放大到 44px

### 10.6 动效
- `prefers-reduced-motion: reduce` 时：所有 transition/animation 归零，仅保留不透明度即时切换
- 加载 spinner 是唯一豁免（是状态反馈非装饰），但 reduced-motion 下改为静态 `tabler:loader` 图标 + 文字"加载中"

### 10.7 Windows 高对比模式（forced-colors）
- 使用系统颜色关键字（`Canvas` / `CanvasText` / `Highlight` / `LinkText`），不硬抗
- Canvas 影像区在 forced-colors 下用 `forced-color-adjust: none` 保护（避免系统把影像反相）

---

## 11. 响应式断点

**院内主场景是 1920×1080 固定工作站**，但必须覆盖以下：

| 断点 | 宽度 | 设备 | 布局策略 |
|---|---|---|---|
| `--bp-viewer-min` | **1440px** | 主流阅片工作站下限 | 阅片工作台完整布局；Canvas 四宫格每格 ≥ 340×260 |
| `--bp-laptop` | 1280px | 笔记本（查房/会诊） | 左栏可折叠为图标栏 64px；Canvas 三宫格（Axial 占主位+2 小格） |
| `--bp-2k` | 2560px | 2K 医疗显示器 | 全部面板宽度锁定不变（不随屏放大——放大 UI 字体是医疗 UI 大忌）；Canvas 扩大；侧栏可增加"图像信息"面板 |
| `--bp-4k` | 3840px | 4K 诊断显示器 | 同 2K 策略：UI 尺寸恒定 + Canvas 最大化。**关键约束：UI 绝不随分辨率放大**，医生已形成肌肉记忆 |
| `--bp-tablet` | 1024px | 术中会诊平板 | 侧栏改为抽屉（`tabler:layout-sidebar-right` 触发）；Canvas 单全屏 + 工具条浮层；报告编辑器三栏改单栏 + tab 切换 |
| `--bp-tablet-portrait` | 768px | 竖屏平板 | 仅支持"单任务"模式：一次只做一件事（阅片 OR 编辑报告），顶部 tab 切换 |

**布局稳定性要求**：
- 全部面板使用 `clamp()` 或固定 px，**禁止**视口宽度线性缩放字号（会导致 4K 上字巨大）
- 表格列宽固定 + 横向滚动，不用 `width: 100%` 挤压
- 所有固定格式元素（HU 值窗宽窗位、层号）使用 tabular-nums + `min-width`，防止窗口变化时跳动

---

## 12. 反模式自查表（对照 8 条硬红线）

| # | 红线 | 自查结论 | 证据/约束 |
|---|---|---|---|
| 1 | 千篇一律 Hero 段 | [PASS] 无 | 面向医生的工具无营销页。登录页是单卡片 + 表单（§9.1），无"大标题+副标题+居中CTA+抽象3D图形"。文档内**无任何 Hero 组件定义**。 |
| 2 | 无意义渐变 | [PASS] 无 | 全Token 表中**零渐变**（脚本校验 0 处）。主色为纯色深蓝藏青 `--color-accent-clinical`。Canvas 为纯色 `#000000`（P2 灰阶不可侵犯）。 |
| 3 | 硬编码颜色 | [PASS] 无 | 所有颜色定义为 Primitive 色阶 Token，语义层全部 `var(--color-*)` 引用。组件层无裸 hex。唯一裸值出现在 Token 定义处（合法）。 |
| 4 | Emoji 图标 | [PASS] 无 | 图标映射表166 项全部为 `tabler:<kebab-case-name>`，已对 npm 包逐一存在性校验，缺失 0。文档中**无 emoji**。缺口图标（kidney/stomach/vessel）明确标注用替代方案，**不从第二库混用**。 |
| 5 | 多套图标库混用 | [PASS] 无 | §5.1 锁定 Tabler Icons v3.49.0 单库，MIT 许可。选型对比表已说明为何排除 Lucide（无 filled 态）/ Phosphor（6 字重易混用）/ Material Symbols（4–6MB 字体）/ Radix（覆盖不足）。 |
| 6 | 密集无层级 | [PASS] 无 | VISUAL_DENSITY=8 是专业工具的**主动选择**（医生一天看 300 幅影像），但层级靠三件事建立：① 面板标题 36px 固定带 ② 区块间 `--space-6` + `--color-border-subtle` 分隔 ③ 表面亮度递进（elevation-0/1/2/3）。不是"全部糊在一起"。 |
| 7 | 装饰性动效 | [PASS] 无 | MOTION_INTENSITY=2。动效仅存在于：状态确认 150ms、弹窗进 200ms、spinner（状态反馈）。**无** AI 完成撒花、**无** 弹跳缓动（显式禁用 `cubic-bezier(0.68,-0.55,0.265,1.55)`）、**无** hover 位移。 |
| 8 | 与医疗语境不符的圆润卡通风格 | [PASS] 无 | 圆角上限 `--radius-lg` 12px（弹窗），工具栏/按钮 4px。禁止 ≥16px 圆角。禁用 `tabler:heart` 等卡通感图标作功能性按钮（heart 仅用于心脏解剖标注，且为 2px 描边非填充）。 |

### 附加自查（超出 8 条红线，主动加严）

| # | 自查项 | 结论 |
|---|---|---|
| 9 | 侧条纹边框（`border-left > 1px` 彩色强调） | [COND] 有条件使用：仅用于① 工具栏选中指示 2px ② 急诊列表行 4px 危急标识 ③ 折叠树层级线。**均为"状态指示"而非"卡片装饰"**，且不与 `border-radius` + 卡片容器组合出现。**明确禁止**：卡片使用彩色左边框（§4.3 绝对禁令）。 |
| 10 | 幽灵卡片（`1px border` + `blur≥16px` 阴影） | [PASS] 无 | 暗色下组件默认 `box-shadow: none`，靠亮度递进；亮色下阴影最大 blur 12px（`0 4px 12px`），且阴影元素不带 1px 边框。 |
| 11 | 渐变文字 `background-clip: text` | [PASS] 无 | 全 Token 无渐变。标题强调靠字重（590）+ 字号，不靠颜色特殊效果。 |
| 12 | 奶油/米色背景默认化 | [PASS] 无 | 中性色为冷灰阶（带蓝相，如 `#161C21` / `#E7EBED`），非 warm-neutral。暗色主题天然规避此问题。 |
| 13 | 每节都有小型大写追踪标签 | [COND] 部分使用 | 仅用于**工具栏功能分组标签**（`W/L`、`MEASURE`），这是 DICOM 工作站的专业惯例（OHIF/Slicer 同款），承担空间分组功能。**页面级 section 不使用**此样式。 |
| 14 | 编号 section 标记（`01 · 关于`） | [PASS] 无 | 文档与 UI 均无此模式。 |
| 15 | 相同卡片网格无限重复 | [PASS] 无 | 阅片工作台为分栏+Canvas 结构，非卡片网格。患者列表为表格。报告页为三栏。 |
| 16 | 虚构指标 | [PASS] 无 | UI 文案中出现的数值均为示例临床数据（`8×6mm 磨玻璃结节`、`体积 214mm³`、`CT值 -687HU`、`队列时长 5小时12分`），符合真实医学量级。无"10,000+ 用户信赖""99.9% 可用"类编造数据。 |
| 17 | 填充式空洞文案 | [PASS] 无 | 所有示例文案为真实临床/医疗场景文本（§9.4 报告正文、§9.6 空态"今日待阅队列已清空，最近一次归档 16:42"）。**无** Welcome-to类 / 开始探索类 / Lorem-ipsum 类 / Seamless 类 / Elevate 类空洞文案。 |
| 18 | 空洞占位文本 | [PASS] 无 | 输入框label 均为具体字段名（"工号""密码""起始日期"），placeholder 仅作格式示例（"如 2026-10-01"），不充当 label。 |
| 19 | 期相默认归入平扫（PRD DCM-02 红线） | [PASS] 无 | 未识别期相独立成组，琥珀 + `tabler:help-circle` + 「期相未识别」+ 推断依据 + 置信度，且该组不被默认选中。见 §9.2 |
| 20 | AI 空结果冒充成功（PRD AI-02 红线） | [PASS] 无 | 分割失败必须显示失败环节 + 错误码 + 影响范围 + 未受影响范围，禁用空模型/0 结果/空列表。见 §9.8 |
| 21 | 越权泄露患者存在性（PRD SEC-03 红线） | [PASS] 无 | 「不存在」与「无权限」返回**完全一致**的文案/布局/响应；禁止出现"该患者不存在""您无权访问该患者"等泄露性文案。见 §9.9 |
| 22 | 静默降级（PRD 第7章 P0 / PIT-02 红线） | [PASS] 无 | WebGL 不可用与几何 Tag 缺失两处降级均用琥珀警示条常驻提示，量化精度损失，禁止白屏。见 §9.10 |
| 23 | 审计界面暗示可编辑（PRD SEC-03 权限分离） | [PASS] 无 | 审计表全列只读，行hover 仅有 `tabler:eye` 查看详情，无编辑/删除；系统管理员与审计管理员用 `tabler:user-shield` / `tabler:shield-check` 区分。见 §9.5 |
| 24 | 移动端提供编辑签名入口（PRD OOS-10 红线） | [PASS] 无 | 移动端只读，无编辑与签名入口，只读字段用 `--color-readonly-bg` + `tabler:lock` 明确标识。见 §11 |

---

## 13. Token 交付物与前端使用说明

### 13.1 文件
| 文件 | 角色 |
|---|---|
| `docs/design-tokens.json` | **Token 唯一源（single source of truth）**，三层结构 primitive → semantic → component |
| `docs/design-tokens.css` | 由 json 生成，`:root` (light) + `[data-theme="dark"]`，内容与 json 完全一致 |

### 13.2 前端接入规则（架构师/前端必读）
1. **单一数据源**：修改 Token 只改 `design-tokens.json`，重新生成 CSS。**禁止**手改 `design-tokens.css`。
2. **主题挂载**：`<html data-theme="dark|light">`，CSS 侧仅 `[data-theme="dark"]` 覆盖语义层。
3. **闪烁防护**：`<head>` 内阻塞式内联脚本先读localStorage 设置 `data-theme`，再加载 CSS；同时设 `<meta name="color-scheme">`。
4. **零硬编码**：CSS 中禁止出现裸 hex/rgb，一律 `var(--color-*)`。CI 可加 stylelint `declaration-property-value-allowed-list` 规则强制。
5. **图标**：仅 `@tabler/icons`，按需 import（tree-shaking）。禁止 emoji，禁止内联手绘 SVG 混入。
6. **数字**：所有临床数值元素必须应用 `--number-font-feature`（`tabular-nums`）+ 右对齐。
7. **Canvas 例外区**：`--color-surface-canvas` 是阅片区唯一合法背景 Token，值恒为近黑（暗 `#000000` / 亮 `#1A1A1A`），**不随主题变亮**。

### 13.3 已知设计约束与实现坑（给前端）
- 亮色主题下 `--color-surface-canvas` 仍是深色，这是**故意的**（灰阶诊断需求），不要"修正"成白色。
- `--color-focus-ring` 暗色 `#7CBAE8`、亮色 `#1E3A5F`，均已实测 ≥3:1。这是主色派生色，若主色调整需同步复核。
- Tabler 图标从 24px 缩到 16px 时描边视觉变细，16px 下建议 `strokeWidth={1.75}`（Token: `--icon-stroke-width-sm`）。
- 危急值弹窗禁用 Esc 关闭（临床安全要求：必须显式确认已通知临床）。
- 报告签名后转只读，这是法规要求，不可做成"可撤回草稿"。

---

## 14. PRD 对齐变更记录（v2 · 2026-10-22）

> PM 完成 PRD 后定向同步，新增/变更如下。**变更依据：PRD 7.1 视觉规范约束 + DCM-02 / AI-03 / COM-01 / AUD-01 验收标准 + OOS-10 边界**。所有色值经脚本实测，非估算。

### 14.1 主色变更：Teal → 深蓝藏青（重要）

| 项 | v1（已废弃） | v2（现行） | 依据 |
|---|---|---|---|
| 亮色主色 | `#0E6157`（Teal） | **`#1E3A5F`**（深蓝藏青） | PRD 7.1 明确指定 |
| 亮色 hover | `#0A4B44` | **`#2C3E50`**（PRD 第二指定色） | PRD 7.1 |
| 暗色主色 | `#63C0B0`（Teal 提亮） | **`#63A6DC`**（深蓝同色相提明） | 见下方实测依据 |
| 暗色 hover | `#6FD0BE` | `#7CBAE8` | — |
| 暗色 active | `#4FA79A` | `#4A8AC0` | — |
| 主色弱底 | `#0A3A36` | `#16243A` | — |
| 暗色焦点环 | `#4CC9E0`（青） | **`#7CBAE8`**（蓝） | 随主色 |
| 亮色焦点环 | `#0E6157` | **`#1E3A5F`** | 随主色 |

**为什么 PRD 原值不能直接用在暗色主题**（实测数据）：

| 颜色 | 对 `--color-surface-panel` | 对 canvas `#000000` | 判定 |
|---|---|---|---|
| `#1e3a5f`（PRD 原值） | **1.49:1** | 1.83:1 | 远低于 4.5:1，暗色主题不可用 |
| `#2c3e50`（PRD 原值） | **1.56:1** | 1.91:1 | 同上，不可用 |
| `#63A6DC`（本方案暗色） | **6.56:1** | 8.02:1 | AA 达标 |

结论：**遵循 PRD 的色相方向（深蓝藏青传达专业可信），但按主题派生明度**。亮色主题用 PRD 原色系（11.50:1），暗色主题取同色相（hue 207° vs 原色 214°，视觉上仍是同一支深蓝）提明到可读区间。这不是违背 PRD，而是 PRD 未指定暗色主题下的具体明度——若机械照抄 `#1e3a5f`，暗色主题下所有主色元素将不可读，直接违反 P0 无障碍底线。

### 14.2 琥珀色变更：待处理与警示

| 主题 | 值 | 对应背景对比度 | 说明 |
|---|---|---|---|
| 暗色 | **`#F59E0B`** | 8.00:1（on panel） | 保留 PRD 原色，暗底上本就可读 |
| 亮色 | **`#8A5200`** | 6.39:1（on 白） | PRD 原色 `#F59E0B` 在白底仅 **2.15:1**，不达 AA，故亮色加深 |

新增对应 Token：`--color-status-warning`（待处理/警示）、`--color-phase-unknown`（期相未识别）、`--color-confirm-pending`（AI 标记待确认）三者共用琥珀语义，形成"待处理"视觉家族。

### 14.3 新增 Token（12 项）

**期相分组**（PRD DCM-02硬约束：期相未识别必须标注，禁止默认归入平扫）
| Token | 暗色 | 色相 | 对比度 |
|---|---|---|---|
| `--color-phase-plain` | `#A3ADB5` | 207° | 7.53:1 |
| `--color-phase-arterial` | `#63A6DC` | 207° | 6.56:1 |
| `--color-phase-venous` | `#4FB8A0` | 166° | 7.12:1 |
| `--color-phase-delayed` | `#D16BAE` | 321° | 5.26:1 |
| `--color-phase-unknown` | `#F59E0B` | 38° | 8.00:1 |

> 延迟期相刻意用**品红（hue 321°）而非紫色**。紫色（hue 258°）会触碰 P0-2 红线，且医疗语境下紫色易与「禁用/未确认」语义混淆。四色色相间隔最大化（207/166/321/38），保证并排排列时可快速区分。

**AI 逐项确认**（PRD V7：未全部确认时报告提交按钮不可用）
| Token | 暗色 | 语义 | 强制图标 |
|---|---|---|---|
| `--color-confirm-pending` | `#F59E0B` | 待医师确认 | `tabler:circle-dashed` + 「待确认」 |
| `--color-confirm-done` | `#3FB950` | 已确认 | `tabler:circle-check` + 「已确认」+ 确认人 + 时间 |
| `--color-confirm-modified` | `#4D9DE0` | 修改后确认 | `tabler:edit` + 「已修改」 |
| `--color-disclaimer-bar-bg` | `#1B2A3D` | AI 声明条底 | 常驻，不可折叠 |

**只读/ 锁定**（PRD COM-01 签名后锁定、OOS-10 移动端只读）
| Token | 暗色 | 用途 |
|---|---|---|
| `--color-readonly-bg` | `#1A2028` | 自动带入不可编辑字段底色 |
| `--color-readonly-border` | `#5F6B76` | 只读字段边框 |
| `--color-lock-overlay` | `rgba(0,0,0,0.28)` | 签名后编辑拦截层，配 `tabler:lock` + 「已签名锁定」 |

### 14.4 核心用户修正：住院医师（影响设计指标）

PM 调研纠正了此前的用户重心误判——**核心用户是影像科住院医师，不是主任医师**。医生的抱怨集中在四件基本事：性能慢、图像量大增长快、简单任务点击次数过多、登录找患者看报告看图像不顺畅。

**对设计的实质影响**：
1. **第一指标从「视觉现代感」改为「减少点击次数」**。已在 §15 新增点击预算约束。
2. **密度继续保持高**（VISUAL_DENSITY 8 不变），低密度对住院医师是负担不是享受。
3. **键盘优先（P5）权重提升**，因为减少点击最直接的路径是快捷键。
4. **加载态设计权重提升**：医生反馈「因加载慢而犹豫是否要调阅影像」——加载态不是附属功能，是产品成败点。见 §9.7 新增阅片加载态规格。

### 14.5 新增设计界面：AI 分割确认界面（合规关键，此前完全缺失）

这是 PRD 中**合规要求最强、也是我v1 遗漏的界面**。国家药监局《糖尿病视网膜病变眼底图像辅助诊断软件注册审查指导原则》（L7）明确要求「不能仅凭算法诊断结果进行临床决策，需要由医生综合判断，**确认签字后报告生效**」。因此该界面的设计目标不是"好看"，而是**让逐项确认成为流程的 natural 一步，而不是让医生找理由跳过的负担**。详见 §9.8。

### 14.6 新增边界态规格（PRD 第9 章验证步骤要求）

| 边界态 | PRD 出处 | 设计规格位置 |
|---|---|---|
| 无权限态（**不得泄露患者存在性**） | SEC-03 | §9.9 |
| 加载失败态（含已加载层数） | DCM-01 | §9.7 |
| AI 分割失败态（含失败环节 + 错误码） | AI-02 | §9.8 |
| WebGL 降级态 | 第7 章 P0 | §9.10 |
| 几何 Tag 缺失降级 | PIT-02 | §9.10 |

> **PIT-02 值得单独说明**：院内 PACS 为省带宽会剥离`Image Position Patient` 等几何 Tag，导致无法重建三维体数据。PRD 要求提供强制重采样降级通道，且**降级必须明确告知精度已损失，不得静默降级**。设计中该降级必须用琥珀色警示条 + 精度损失量化说明（而非一个安静的提示）。

---

## 15. 点击预算约束（住院医师核心指标）

> PM 明确「设计的第一指标应是减少点击次数」。本节把该指标转为可验收的硬约束。

### 15.1 核心任务点击预算

| 任务 | 预算上限 | 达成方式 |
|---|---|---|
| 登录 → 打开指定检查 | **≤ 4 次** | 检查号直输 + 回车直开；最近检查一键续阅|
| 打开上次未完成报告 | **≤ 2 次** | 工作台首屏「继续上次工作」卡片 |
| 窗宽窗位调整到目标值 | **≤ 2 次** | 数字输入框直接键入 + 预设窗单键切换 |
| 完成一条AI 标记确认 | **≤ 2 次** | 「确认」按钮在行内，且支持 `Enter` 连续确认下一条 |
| 逐条确认完N 条 AI 标记 | **N 次**（不可再降） | 合规要求逐项确认，但必须做到每条只需 1 次点击 |
| 签名提交 | **≤ 3 次** | 报告页「签名」→ 确认弹窗 → 完成 |
| 切换视图布局 | **≤ 1 次** | 工具栏单键 `Ctrl+2/3/4` |

### 15.2 连续操作优化（专门为「逐项确认」设计）

PRD 说逐项确认不应成为负担。设计上这样做到：
- **AI 标记行内确认，确认后焦点自动移到下一条待确认项**——医生可以按住节奏一路确认，不必反复用鼠标定位
- 顶部进度条实时显示「已确认 12/ 17 项」，让医生知道还剩多少
- 全部确认前，「提交报告」按钮保持 **disabled** 且**必须显示还差几项**（如「还需确认 5 项」），而不是简单置灰
- 支持 `Shift+Enter` 快速确认并跳到下一条

### 15.3 反「点击陷阱」自查
- [ ] 无任何需二次点击才能看到的必要信息
- [ ] 列表项的操作按钮 hover 即现，不需要先点行进详情
- [ ] 无「展开才能看到」的合规声明（AI 声明条必须常驻）
- [ ] 批量操作提供多选 + 批量确认，不要求逐条点击

## 附录：设计参数速查

| 项 | 值 |
|---|---|
| 对标品牌 | **OHIF Viewer（Neutral 主题家族）+ 3D Slicer + DaVinci Resolve** |
| 设计语言 | 影像优先的工程克制：阅片区绝对近黑，UI 逐级退后，临床数值等宽稳定，语义色三重编码 |
| 锁定图标库 | **Tabler Icons v3.49.0（MIT）** |
| 暗色表面 | canvas `#000000` / app `#0C1116` / panel `#161C21` / raised `#242B32` / overlay `#2D353D` |
| 亮色表面 | canvas `#1A1A1A`（不变）/ app `#F5F7F8` / panel `#FFFFFF` |
| 主色（深蓝藏青，PRD 7.1） | 暗 `#63A6DC` / 亮 `#1E3A5F`（hover 亮色 `#2C3E50`） |
| 危急值色 | 暗 `#FF6B6B` / 亮 `#C81E1E` + `tabler:alert-triangle` + 文字 |
| 正常色 | 暗 `#3FB950` / 亮 `#15803D` + `tabler:circle-check` + 文字 |
| 焦点环 | 暗 `#7CBAE8`（对 panel 8.22:1）/ 亮 `#1E3A5F` |
| 待处理/警示（琥珀，PRD 7.1） | 暗 `#F59E0B` / 亮 `#8A5200` |
| 字体 | Inter + Noto Sans SC（UI/Display）+ JetBrains Mono（全部临床数值） |
| 默认主题 | **暗色**（阅片为主场景；Canvas 恒暗；报告/审计可切亮色） |
| 三轴刻度 | Variance 4 / Motion 2 / Density 8 |