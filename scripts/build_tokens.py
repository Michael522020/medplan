#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MedPlan Design Token 生成器
- 唯一数据源：本文件中的 TOKENS 结构
- 产出：design-tokens.json（源） + design-tokens.css（由 json 生成）
- 两者内容必须完全一致：css 由本脚本从同一结构渲染，不允许手改css

用法：python scripts/build_tokens.py
"""
import json
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")


def rgb(hexstr):
    """#RRGGBB -> 'r, g, b'（用于 rgba() 拼接）"""
    h = hexstr.lstrip("#")
    return "%d, %d, %d" % (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


# ---------------------------------------------------------------- 语义色
# 双主题：每个语义 Token 在 light / dark 各有独立值（设计原则 P8）
SEMANTIC_COLOR = {
    # Canvas：阅片区影像画布。亮色主题下**仍是深色**——灰阶影像在白底上丧失诊断对比，
    # 这是专业硬约束，不可"修正"为白色。
    "surface-canvas":  {"light": "#1A1A1A", "dark": "#000000",
        "desc": "阅片区影像画布周边。恒为近黑，防眩光；亮色主题下仍保持深色（灰阶诊断需求）"},
    "surface-app":    {"light": "#F5F7F8", "dark": "#0C1116",
        "desc": "应用最外层背景 / 顶部状态栏 / 底部工具条"},
    "surface-panel":  {"light": "#FFFFFF", "dark": "#161C21", "desc": "侧栏与面板背景"},
    "surface-raised": {"light": "#FFFFFF", "dark": "#242B32", "desc": "卡片、浮起面板"},
    "surface-overlay":{"light": "#FFFFFF", "dark": "#2D353D", "desc": "弹窗、下拉、菜单"},
    "surface-sunken": {"light": "#E7EBED", "dark": "#050809", "desc": "凹陷区、输入框底"},
    "surface-hover":  {"light": "#EDF1F2", "dark": "#1F262D", "desc": "行 / 按钮 hover 底色"},
    "surface-active": {"light": "#E1E7EA", "dark": "#2A333B", "desc": "行选中 / 按钮按下底色"},
    "surface-selected":{"light": "#D3DEE9", "dark": "#16243A","desc": "选中项强调底色（工具栏选中、当前序列）"},

    "border-subtle":  {"light": "#E7EBED", "dark": "#242B32", "desc": "内部行分隔线"},
    "border-default": {"light": "#CBD2D7", "dark": "#343C44", "desc": "常规边框"},
    "border-strong":  {"light": "#7A858F", "dark": "#5F6B76",
        "desc": "强边框 / 输入框边框。暗色下 3.15:1 (vs panel)，满足 WCAG 1.4.11 非文本对比 3:1"},

    # 对比度实测（WCAG 相对亮度公式逐组重算，非估算）：
    #   text-primary dark #E8EDF0 vs panel-dark #161C21 = 14.57:1 (AAA)
    #   text-primary dark #E8EDF0 vs canvas-dark #000000 = 17.80:1 (AAA)
    "text-primary":   {"light": "#0F1519", "dark": "#E8EDF0",
        "desc": "正文。暗色用非纯白防halation；实测对 panel-dark #161C21 为 14.57:1 (AAA)，对 canvas-dark #000000 为 17.80:1 (AAA)"},
    "text-secondary": {"light": "#454F58", "dark": "#A3ADB5", "desc": "次级文本，暗色 7.1:1 (AAA)"},
    "text-tertiary":  {"light": "#5A656F", "dark": "#7A858F", "desc": "辅助/ 占位，暗色 4.6:1 (AA)"},
    "text-disabled":  {"light": "#A3ADB5", "dark": "#5A656F",
        "desc": "禁用态（WCAG 对disabled 豁免；必须同时设置 aria-disabled）"},
    "text-on-accent": {"light": "#FFFFFF", "dark": "#FFFFFF", "desc": "强调色底上的前景色"},
    # Canvas 恒为近黑（亮色主题下也是 #1A1A1A），因此叠在影像上的角标文字必须恒为浅色。
    # 不能用 text-primary——它在亮色主题下是深色，会导致角标在影像上不可见。
    # text-on-canvas 双主题恒为 #E8EDF0，但两个主题的 canvas 值不同（亮 #1A1A1A / 暗 #000000），
    # 因此对比度必须按引用面分别标注，不能只写一个数：
    #   vs canvas-dark  #000000 = 17.80:1 (AAA)
    #   vs canvas-light #1A1A1A = 14.75:1 (AAA)
    "text-on-canvas":  {"light": "#E8EDF0", "dark": "#E8EDF0",
        "desc": "叠加在阅片Canvas 上的文字（序列描述/ 层号 / WW·WL / 患者ID / HU 值）。恒为浅色，因 Canvas 恒暗；实测对 canvas-dark #000000 为 17.80:1，对 canvas-light #1A1A1A 为 14.75:1（均 AAA）"},

    # 主色：深蓝/藏青（PRD 7.1 指定 #1e3a5f / #2c3e50 传达专业可信）。
    # 实测 PRD 原值在暗色主题仅 1.49:1 / 1.56:1，完全不可用；
    # 因此按同色相族分主题派生：亮色用 PRD 原色系，暗色提明度至可读区间。
    "accent-clinical":         {"light": "#1E3A5F", "dark": "#63A6DC",
        "desc": "主色·深蓝藏青（PRD 7.1）。亮色用PRD 原色 #1E3A5F(11.5:1)；暗色同色相提明至 #63A6DC (6.56:1)，因原色在暗底仅 1.49:1 不可用"},
    "accent-clinical-hover":   {"light": "#2C3E50", "dark": "#7CBAE8", "desc": "主色 hover（亮色用 PRD 第二指定色 #2C3E50）"},
    "accent-clinical-active":  {"light": "#152A45", "dark": "#4A8AC0", "desc": "主色 active"},
    "accent-clinical-subtle":  {"light": "#D3DEE9", "dark": "#16243A",
        "desc": "主色弱底（标签 / 选中行 / 当前序列）"},

    # 临床安全色：必须与图标 + 文字三重编码（设计原则 P3），禁止仅用颜色
    "status-critical":       {"light": "#C81E1E", "dark": "#FF6B6B",
        "desc": "[FAIL] 危急值。必须配合 tabler:alert-triangle 与「危急值」文字，禁止仅用颜色"},
    "status-critical-subtle":{"light": "#FDECEC", "dark": "#3D0F0F", "desc": "危急值弱底"},
    "status-abnormal":       {"light": "#B45309", "dark": "#E8A33D",
        "desc": "异常 / 阳性发现，配tabler:alert-circle"},
    # 琥珀色：PRD 7.1 指定 #f59e0b 用于待处理与警示。
    # 实测 #F59E0B 在亮色主题（白底）仅 2.15:1，不达AA；故亮色加深为 #8A5200 (6.39:1)，
    # 暗色保留琥珀本质 #F59E0B (8.00:1)。
    "status-warning":        {"light": "#8A5200", "dark": "#F59E0B",
        "desc": "待处理/ 警示·琥珀（PRD 7.1）。暗色 #F59E0B(8.00:1)；亮色加深至 #8A5200(6.39:1) 因原色白底仅 2.15:1"},
    "status-normal":         {"light": "#15803D", "dark": "#3FB950",
        "desc": "正常 / 阴性，配 tabler:circle-check"},
    "status-info":           {"light": "#1D4ED8", "dark": "#4D9DE0", "desc": "信息 / 进行中"},

    "focus-ring":      {"light": "#1E3A5F", "dark": "#7CBAE8",
        "desc": "焦点环。暗背景禁用蓝色（会淹没），改用青色，对组件与背景均 ≥3:1"},
    "overlay-crosshair":{"light": "#1E3A5F", "dark": "#8FC2E8",
        "desc": "十字定位线。阅片区唯一许可的染色层（P2 灰阶不可侵犯）"},
    "shadow-ambient":  {"light": "rgba(15,21,25,0.32)", "dark": "rgba(0,0,0,0.55)",
        "desc": "仅用于模态遮罩"},
}

# ---------------------------------------------------------------- 组件层（双主题）
COMPONENT_COLOR = {
    "button-primary-bg":        {"light": "#1E3A5F", "dark": "#2E5F8F"},
    "button-primary-text":      {"light": "#FFFFFF", "dark": "#FFFFFF"},
    "button-primary-hover":     {"light": "#2C3E50", "dark": "#3A72A8"},
    "button-primary-active":    {"light": "#152A45", "dark": "#28527D"},

    "button-secondary-bg":      {"light": "#FFFFFF", "dark": "#242B32"},
    "button-secondary-text":    {"light": "#1E3A5F", "dark": "#8FC2E8"},
    "button-secondary-border":  {"light": "#7A858F", "dark": "#5F6B76"},
    "button-secondary-hover":   {"light": "#EDF1F2", "dark": "#2D353D"},

    "button-ghost-text":        {"light": "#454F58", "dark": "#A3ADB5"},
    "button-ghost-hover":       {"light": "#EDF1F2", "dark": "#1F262D"},

    "button-danger-bg":         {"light": "#C81E1E", "dark": "#B01616"},
    "button-danger-text":       {"light": "#FFFFFF", "dark": "#FFFFFF"},
    "button-danger-hover":      {"light": "#A81717", "dark": "#C81E1E"},

    "input-bg":                 {"light": "#FFFFFF", "dark": "#050809"},
    "input-border":             {"light": "#7A858F", "dark": "#5F6B76"},
    "input-text":               {"light": "#0F1519", "dark": "#E8EDF0"},
    "input-placeholder":        {"light": "#5A656F", "dark": "#5A656F"},
    "input-error-border":       {"light": "#C81E1E", "dark": "#FF6B6B"},
    "input-error-ring":         {"light": "#FDECEC", "dark": "#3D0F0F"},
    "input-disabled-bg":        {"light": "#E7EBED", "dark": "#161C21"},

    "table-header-bg":          {"light": "#F5F7F8", "dark": "#161C21"},
    "table-row-hover":          {"light": "#EDF1F2", "dark": "#1F262D"},
    "table-row-selected":       {"light": "#E1E7EA", "dark": "#1F262D"},
    "table-border":             {"light": "#E7EBED", "dark": "#242B32"},

    "critical-banner-bg":       {"light": "#FDECEC", "dark": "#3D0F0F"},
    "critical-banner-border":   {"light": "#C81E1E", "dark": "#FF6B6B"},
    "critical-banner-text":     {"light": "#A81717", "dark": "#FF6B6B"},

    # ---- 期相分组（PRD DCM-02：期相必须可读，未识别不得归入平扫）----
    "phase-plain":       {"light": "#454F58", "dark": "#A3ADB5", "desc": "平扫期相标识"},
    "phase-arterial":    {"light": "#1E3A5F", "dark": "#63A6DC", "desc": "动脉期相相标识"},
    "phase-venous":      {"light": "#0E6157", "dark": "#4FB8A0", "desc": "静脉期相标识"},
    # 期相四色色相间隔最大化：平扫 208° / 动脉 214°(主色同族) / 静脉 173° / 延迟 322°(品红) / 未识别 38°(琥珀)
    # 延迟期相刻意不用紫色（hue 258°会触碰 P0-2，且医疗语境易与「禁用/未确认」混淆）
    "phase-delayed":     {"light": "#A83E80", "dark": "#D16BAE",
        "desc": "延迟期相标识（品红 hue322°）。刻意避开紫色系，色相与主色蓝 214°/静脉青 173°/琥珀 38° 间隔最大化"},
    "phase-unknown":     {"light": "#8A5200", "dark": "#F59E0B",
        "desc": "期相未识别——必须标注「期相未识别」+ 推断依据 + 置信度，禁止默认归入平扫（PRD DCM-02硬约束）"},

    # ---- AI 逐项确认（PRD V7 / L7 法规：未全部确认不得提交报告）----
    "confirm-pending":    {"light": "#8A5200", "dark": "#F59E0B",
        "desc": "AI 标记待医师确认。必须配tabler:circle-dashed + 「待确认」文字"},
    "confirm-done":       {"light": "#15803D", "dark": "#3FB950",
        "desc": "AI 标记已由医师确认。必须配 tabler:circle-check + 「已确认」+ 确认人 + 确认时间（归档证据）"},
    "confirm-modified":   {"light": "#1D4ED8", "dark": "#4D9DE0",
        "desc": "AI 标记经医师修改后确认。必须配 tabler:edit + 「已修改」文字，与未修改态区分"},
    "disclaimer-bar-bg":  {"light": "#EDF1F2", "dark": "#1B2A3D",
        "desc": "AI 声明条底色。必须常驻可见，不得折叠隐藏（PRD要求）"},

    # ---- 只读/ 锁定态（PRD COM-01签名后锁定、OOS-10 移动端只读）----
    "readonly-bg":       {"light": "#E7EBED", "dark": "#1A2028",
        "desc": "只读字段底色。用于自动带入不可编辑字段（患者信息/检查号/影像参数）与签名锁定区"},
    "readonly-border":   {"light": "#A3ADB5", "dark": "#5F6B76", "desc": "只读字段边框"},
    "lock-overlay":      {"light": "rgba(15,21,25,0.04)", "dark": "rgba(0,0,0,0.28)",
        "desc": "签名锁定后的编辑拦截层。配 tabler:lock 图标 + 「已签名锁定」文字，不可移除"},

    "skeleton-base":            {"light": "#E7EBED", "dark": "#242B32"},
    "skeleton-highlight":       {"light": "#F5F7F8", "dark": "#2D353D"},
}

# ---------------------------------------------------------------- 排版
FONT_FAMILY = {
    "ui":       {"value": 'Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'},
    "display":  {"value": 'Inter, "Noto Sans SC", "PingFang SC", sans-serif'},
    "mono":     {"value": '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'},
}

FONT_SIZE = {
    "2xs": {"value": "10px", "lineHeight": "1.4", "weight": 500, "desc": "DICOM 角标、序列序号"},
    "xs":  {"value": "11px", "lineHeight": "1.5", "weight": 400, "desc": "标签、单位、图例"},
    "sm":  {"value": "12px", "lineHeight": "1.5", "weight": 400, "desc": "次级正文、面板标题、时间戳"},
    "base":{"value": "13px", "lineHeight": "1.6", "weight": 400, "desc": "正文基准（阅片工具默认）"},
    "md":  {"value": "14px", "lineHeight": "1.6", "weight": 400, "desc": "报告编辑正文"},
    "lg":  {"value": "16px", "lineHeight": "1.5", "weight": 500, "desc": "区块标题"},
    "xl":  {"value": "20px", "lineHeight": "1.4", "weight": 590, "desc": "页面标题、患者姓名"},
    "2xl": {"value": "24px", "lineHeight": "1.3", "weight": 590, "desc": "登录页标题"},
    "3xl": {"value": "32px", "lineHeight": "1.2", "weight": 590, "desc": "危急值弹窗标题"},
}

FONT_WEIGHT = {"regular": 400, "medium": 500, "semibold": 590}
LETTER_SPACING = {"body": "0", "small": "0.01em", "caps": "0.08em", "heading": "-0.01em"}

# ---------------------------------------------------------------- 间距 / 圆角 / 阴影 / 层级
SPACING = {"1": "4px", "2": "8px", "3": "12px", "4": "16px",
           "5": "20px", "6": "24px", "8": "32px", "10": "40px", "12": "48px"}

RADIUS = {
    "none": "0", "xs": "2px", "sm": "4px", "md": "6px",
    "lg": "12px",   # 圆角上限。禁止 >=16px（AI 过度圆滑）
    "full": "9999px",
}

# 暗色：靠亮度递进表达层级，不用阴影（暗背景上投影不可见）
ELEVATION_DARK = {
    "0": "#0C1116", "1": "#161C21", "2": "#242B32", "3": "#2D353D",
    "shadow": "none",
}
# 亮色：允许极轻投影；blur 最大 12px，且带阴影元素不加 1px 边框（禁幽灵卡片）
ELEVATION_LIGHT = {
    "0": "#F5F7F8", "1": "#FFFFFF", "2": "#FFFFFF", "3": "#FFFFFF",
    "shadow": "0 1px 2px rgba(15,21,25,0.06), 0 4px 12px rgba(15,21,25,0.08)",
    "shadow-lg": "0 8px 28px rgba(15,21,25,0.14)",
}

Z_INDEX = {"base": 0, "sticky": 100, "drawer": 200, "dropdown": 300,
           "modal": 400, "toast": 500, "critical-alert": 600}

# ---------------------------------------------------------------- 图标（锁定单库）
ICON = {
    "library": "Tabler Icons",
    "version": "3.49.0",
    "license": "MIT",
    "grid": "24x24",
    "strokeWidth": 2,
    "strokeWidthSm": 1.75,
    "sizes": {"inline": "16px", "button": "20px", "standalone": "24px", "lg": "32px"},
    "rule": "唯一图标库；禁止 emoji；禁止混用第二套库；颜色继承 currentColor",
}

# ---------------------------------------------------------------- 动效
MOTION = {
    "instant":     {"value": "50ms",  "easing": "ease-out", "desc": "按钮按下、开关切换"},
    "fast":        {"value": "150ms", "easing": "cubic-bezier(0.2, 0, 0, 1)", "desc": "状态确认（收敛值）"},
    "base":        {"value": "200ms", "easing": "cubic-bezier(0.2, 0, 0, 1)", "desc": "弹窗进入"},
    "screen":      {"value": "300ms", "easing": "cubic-bezier(0.2, 0, 0, 1)", "desc": "跨屏过渡上限"},
    "easing":      {"value": "cubic-bezier(0.2, 0, 0, 1)"},
    "easingBanned":{"value": "cubic-bezier(0.68, -0.55, 0.265, 1.55)", "desc": "[FAIL] 禁止：弹跳缓动"},
}

# ---------------------------------------------------------------- 布局
LAYOUT = {
    "viewer-canvas-min-ratio": "70%",
    "toolbar-height": "40px",
    "statusbar-height": "40px",
    "series-nav-height": "32px",
    "sidebar-left-width": "288px",
    "sidebar-right-width": "320px",
    "touch-target-min": "44px",
    "control-min-size": "32px",
}

BREAKPOINT = {
    "tablet": "1024px", "tabletPortrait": "768px", "laptop": "1280px",
    "viewerMin": "1440px", "2k": "2560px", "4k": "3840px",
}

Z_LAYOUT_NOTE = "UI 尺寸恒定，绝不随分辨率放大——医生已形成肌肉记忆；仅 Canvas 随屏扩大"

# LAYOUT 键 → CSS 自定义属性名（kebab-case，单横杠）。
# 显式列出而非字符串替换：链式 replace 会产出 "toolbar--height" 这类畸形名。
LAYOUT_CSS_NAME = {
    "viewer-canvas-min-ratio": "viewer-canvas-min-ratio",
    "toolbar-height":          "toolbar-height",
    "statusbar-height":        "statusbar-height",
    "series-nav-height":       "series-nav-height",
    "sidebar-left-width":      "sidebar-left-width",
    "sidebar-right-width":     "sidebar-right-width",
    "touch-target-min":        "touch-target-min",
    "control-min-size":        "control-min-size",
}


def build_json():
    color = {"semantic": {}, "component": {}}
    for k, v in SEMANTIC_COLOR.items():
        color["semantic"][k] = {
            "light": {"value": v["light"], "type": "color"},
            "dark": {"value": v["dark"], "type": "color"},
            "description": v["desc"],
        }
    for k, v in COMPONENT_COLOR.items():
        color["component"][k] = {
            "light": {"value": v["light"], "type": "color"},
            "dark": {"value": v["dark"], "type": "color"},
        }

    return {
        "$schema": "https://design-tokens.org/schema.json",
        "name": "MedPlan",
        "version": "1.0.0",
        "meta": {
            "product": "MedPlan — 企业级医学影像阅片与手术规划系统",
            "register": "Product",
            "platform": "web",
            "iconLibrary": "%s %s (%s)" % (ICON["library"], ICON["version"], ICON["license"]),
            "defaults": {"theme": "dark"},
            "themeAttribute": "data-theme",
            "storageKey": "medplan.theme",
            "axes": {"designVariance": 4, "motionIntensity": 2, "visualDensity": 8},
            "rules": [
                "唯一数据源为本文件；design-tokens.css 由 scripts/build_tokens.py 生成，禁止手改 CSS",
                "全部颜色走 Token，禁止硬编码 hex；唯一例外为 Token 定义处",
                "surface-canvas 在亮色主题下仍为 #1A1A1A（灰阶诊断需求），不得改为白色",
                "危急值/正常/异常必须 颜色+图标+文字 三重编码，禁止仅用颜色",
                "所有临床数值必须应用 number-font-feature（tabular-nums）并右对齐",
                "图标仅用 Tabler Icons v3.49.0，禁止 emoji，禁止混用第二套库",
            ],
        },
        "color": color,
        "font": {
            "family": {k: {"value": v["value"], "type": "fontFamily"} for k, v in FONT_FAMILY.items()},
            "size": {k: {"value": v["value"], "type": "dimension",
                         "lineHeight": v["lineHeight"], "fontWeight": v["weight"],
                         "description": v["desc"]} for k, v in FONT_SIZE.items()},
            "weight": {k: {"value": v, "type": "fontWeight"} for k, v in FONT_WEIGHT.items()},
            "letterSpacing": {k: {"value": v, "type": "dimension"} for k, v in LETTER_SPACING.items()},
            "numeric": {
                "fontFeature": {"value": '"tnum" 1, "zero" 1',
                                "type": "fontFeatureSettings",
                                "description": "等宽数字 + slashed zero。HU/窗宽窗位/层号/体积/时间戳强制应用"},
                "align": "right",
            },
        },
        "space": {k: {"value": v, "type": "dimension"} for k, v in SPACING.items()},
        "radius": {k: {"value": v, "type": "dimension"} for k, v in RADIUS.items()},
        "elevation": {
            "light": {k: {"value": v, "type": "color" if v.startswith("#") else "shadow"}
                      for k, v in ELEVATION_LIGHT.items()},
            "dark": {k: {"value": v, "type": "color" if v.startswith("#") else "shadow"}
                     for k, v in ELEVATION_DARK.items()},
            "description": "暗色靠亮度递进表达层级（0→1→2→3），默认无阴影；亮色允许 <=12px blur 轻投影",
        },
        "zIndex": {k: {"value": v, "type": "number"} for k, v in Z_INDEX.items()},
        "icon": {
            "library": {"value": ICON["library"], "description": ICON["library"]},
            "version": {"value": ICON["version"]},
            "license": {"value": ICON["license"]},
            "grid": {"value": ICON["grid"]},
            "strokeWidth": {"value": ICON["strokeWidth"], "type": "dimension"},
            "strokeWidthSm": {"value": ICON["strokeWidthSm"], "type": "dimension",
                              "description": "16px 下使用，补偿缩放后描边视觉变细"},
            "size": {k: {"value": v, "type": "dimension"} for k, v in ICON["sizes"].items()},
            "rule": {"value": ICON["rule"]},
            "importHint": {"value": "import { IconName, IconNameFilled } from '@tabler/icons-react'"},
        },
        "motion": {
            "duration": {k: {"value": v["value"], "type": "duration",
                             "easing": v["easing"], "description": v.get("desc", "")}
                         for k, v in MOTION.items() if k not in ("easing", "easingBanned")},
            "easing": {"value": MOTION["easing"]["value"], "type": "cubicBezier"},
            "easingBanned": {"value": MOTION["easingBanned"]["value"],
                             "description": MOTION["easingBanned"]["desc"]},
            "reducedMotion": {"value": "prefers-reduced-motion: reduce 时全部 transition/animation 归零，"
                                        "仅保留不透明度即时切换；spinner 降级为静态图标 + 文字「加载中」"},
        },
        "layout": {
            #后缀过滤：width / height / size / ratio / min。
            # "min" 必须包含，否则 touch-target-min 会被静默丢弃
            #（UIUX.md §10.5 引用了 --touch-target-min: 44px，但生成产物中缺失）。
            "value": {k: {"value": v, "type": "dimension"} for k, v in LAYOUT.items()
                      if k.endswith(("width", "height", "size", "ratio", "min"))},
            "breakpoint": {k: {"value": v, "type": "dimension"} for k, v in BREAKPOINT.items()},
            "note": {"value": Z_LAYOUT_NOTE},
        },
    }


def build_css(data):
    L = []
    a = L.append
    a("/* ============================================================")
    a(" * MedPlan Design Tokens")
    a(" * 本文件由 scripts/build_tokens.py 从 design-tokens.json 自动生成，请勿手改。")
    a(" * 修改 Token 请编辑脚本内的结构体后重新运行。")
    a(" * 图标库：%s %s (%s) — 唯一图标库，禁止 emoji / 禁止混用" % (
        ICON["library"], ICON["version"], ICON["license"]))
    a(" * ============================================================ */")
    a("")
    a(":root {")
    a("  color-scheme: light;")
    a("")
    a("  /* ---- Surface（表面层）---- */")
    for k in ["surface-canvas", "surface-app", "surface-panel", "surface-raised",
              "surface-overlay", "surface-sunken", "surface-hover", "surface-active", "surface-selected"]:
        v = data["color"]["semantic"][k]["light"]["value"]
        a("  --color-%s: %s;" % (k, v))
    a("")
    a("  /* ---- Border（边框层）---- */")
    for k in ["border-subtle", "border-default", "border-strong"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["light"]["value"]))
    a("")
    a("  /* ---- Foreground（前景层）---- */")
    for k in ["text-primary", "text-secondary", "text-tertiary", "text-disabled", "text-on-accent", "text-on-canvas"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["light"]["value"]))
    a("")
    a("  /* ---- Accent（临床强调色，Teal，非紫非粉）---- */")
    for k in ["accent-clinical", "accent-clinical-hover", "accent-clinical-active", "accent-clinical-subtle"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["light"]["value"]))
    a("")
    a("  /* ---- Status（临床安全色：必须颜色+图标+文字三重编码）---- */")
    for k in ["status-critical", "status-critical-subtle", "status-abnormal",
              "status-warning", "status-normal", "status-info"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["light"]["value"]))
    a("")
    a("  /* ---- Focus & Overlay ---- */")
    for k in ["focus-ring", "overlay-crosshair", "shadow-ambient"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["light"]["value"]))
    a("")
    a("  /* ---- 组件层颜色 ---- */")
    for k in sorted(data["color"]["component"]):
        a("  --color-%s: %s;" % (k, data["color"]["component"][k]["light"]["value"]))
    a("")
    a("  /* ---- Typography ---- */")
    for k, v in FONT_FAMILY.items():
        a("  --font-%s: %s;" % (k, v["value"]))
    a("")
    for k, v in FONT_SIZE.items():
        a("  --text-%s: %s;   /* line-height: %s; font-weight: %d; %s */"
          % (k, v["value"], v["lineHeight"], v["weight"], v["desc"]))
    a("")
    for k, v in FONT_WEIGHT.items():
        a("  --font-weight-%s: %d;" % (k, v))
    a("")
    for k, v in LETTER_SPACING.items():
        a("  --tracking-%s: %s;" % (k, v))
    a("")
    a("  /* 等宽数字：所有临床数值强制应用（P4 数字必须稳定）*/")
    a("  --number-font-feature: %s;" % data["font"]["numeric"]["fontFeature"]["value"])
    a("  --number-font-family: var(--font-mono);")
    a("  --number-text-align: %s;" % data["font"]["numeric"]["align"])
    a("")
    a("  /* ---- Spacing（4px 网格，仅允许 4/8/12/16/20/24/32/40/48）---- */")
    for k, v in SPACING.items():
        a("  --space-%s: %s;" % (k, v))
    a("")
    a("  /* ---- Radius（医疗语境克制，上限 lg=12px）---- */")
    for k, v in RADIUS.items():
        a("  --radius-%s: %s;" % (k, v))
    a("")
    a("  /* ---- Elevation（亮色：极轻投影，blur <= 12px）---- */")
    for k, v in ELEVATION_LIGHT.items():
        name = "elevation-shadow-lg" if k == "shadow-lg" else "elevation-shadow" if k == "shadow" else "elevation-%s" % k
        a("  --%s: %s;" % (name, v))
    a("")
    a("  /* ---- Z-index ---- */")
    for k, v in Z_INDEX.items():
        a("  --z-%s: %d;" % (k, v))
    a("")
    a("  /* ---- Icon（唯一图标库：%s %s）---- */" % (ICON["library"], ICON["version"]))
    for k, v in ICON["sizes"].items():
        a("  --icon-size-%s: %s;" % (k, v))
    a("  --icon-stroke-width: %d;" % ICON["strokeWidth"])
    a("  --icon-stroke-width-sm: %s;" % ICON["strokeWidthSm"])
    a("")
    a("  /* ---- Motion（功能动效，无装饰；上限 300ms）---- */")
    for k in ["instant", "fast", "base", "screen"]:
        a("  --motion-%s: %s;" % (k, MOTION[k]["value"]))
    a("  --ease-standard: %s;" % MOTION["easing"]["value"])
    a("")
    a("  /* ---- Layout ---- */")
    #显式命名映射。
    # 原实现用 k.replace("width","-width").replace("height","-height") 链式替换，
    # 会把 "toolbar-height" 变成 "toolbar--height"（双横杠）——所有 layout CSS 变量名全部畸形，
    # 且 --control-min-size 又被二次替换成 --control-min，同一后缀产出两个不一致的名字。
    #改为显式映射，保证 CSS 变量名与 LAYOUT 键名一一对应且可预测。
    for css_name, key in LAYOUT_CSS_NAME.items():
        a("  --%s: %s;" % (css_name, LAYOUT[key]))
    a("")
    a("  /* ---- Breakpoint（仅文档用，媒体查询请直接写断点值）---- */")
    for k, v in BREAKPOINT.items():
        a("  --bp-%s: %s;" % (k, v))
    a("}")
    a("")
    a('/* 暗色主题：阅片默认。两套主题各自独立设计，非互相反转（P8）*/')
    a('[data-theme="dark"] {')
    a("  color-scheme: dark;")
    a("")
    a("  /* ---- Surface ---- */")
    for k in ["surface-canvas", "surface-app", "surface-panel", "surface-raised",
              "surface-overlay", "surface-sunken", "surface-hover", "surface-active", "surface-selected"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Border ---- */")
    for k in ["border-subtle", "border-default", "border-strong"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Foreground ---- */")
    for k in ["text-primary", "text-secondary", "text-tertiary", "text-disabled", "text-on-accent", "text-on-canvas"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Accent（暗色下提明度、降饱和，防视觉振动）---- */")
    for k in ["accent-clinical", "accent-clinical-hover", "accent-clinical-active", "accent-clinical-subtle"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Status ---- */")
    for k in ["status-critical", "status-critical-subtle", "status-abnormal",
              "status-warning", "status-normal", "status-info"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Focus & Overlay（暗背景焦点环改青色，禁用蓝色）---- */")
    for k in ["focus-ring", "overlay-crosshair", "shadow-ambient"]:
        a("  --color-%s: %s;" % (k, data["color"]["semantic"][k]["dark"]["value"]))
    a("")
    a("  /* ---- 组件层颜色 ---- */")
    for k in sorted(data["color"]["component"]):
        a("  --color-%s: %s;" % (k, data["color"]["component"][k]["dark"]["value"]))
    a("")
    a("  /* ---- Elevation（暗色靠亮度递进，默认无阴影）---- */")
    for k, v in ELEVATION_DARK.items():
        name = "elevation-shadow" if k == "shadow" else "elevation-%s" % k
        a("  --%s: %s;" % (name, v))
    a("  --elevation-shadow-lg: none;")
    a("}")
    a("")
    a("/* ---------- 基础重置：数值必须稳定（P4）---------- */")
    a("*,")
    a("*::before,")
    a("*::after { box-sizing: border-box; }")
    a("")
    a("html, body {")
    a("  margin: 0;")
    a("  padding: 0;")
    a("  background: var(--color-surface-app);")
    a("  color: var(--color-text-primary);")
    a("  font-family: var(--font-ui);")
    a("  font-size: var(--text-base);")
    a("  line-height: 1.6;")
    a("  -webkit-font-smoothing: antialiased;")
    a("}")
    a("")
    a("/* 临床数值统一应用等宽数字 + 右对齐 */")
    a(".numeric,")
    a("[data-numeric],")
    a("input[type=\"number\"] {")
    a("  font-family: var(--number-font-family);")
    a("  font-variant-numeric: var(--number-font-feature);")
    a("  text-align: var(--number-text-align);")
    a("}")
    a("")
    a("/* 焦点可见：永不移除 outline。危急值弹窗默认焦点 */")
    a(":focus-visible {")
    a("  outline: 2px solid var(--color-focus-ring);")
    a("  outline-offset: 2px;")
    a("}")
    a("")
    a("/* 图标统一：继承文字色，颜色不硬编码 */")
    a("svg[class*=\"icon\"],")
    a("[class*=\"icon-\"] svg {")
    a("  stroke: currentColor;")
    a("  fill: none;")
    a("  stroke-width: var(--icon-stroke-width);")
    a("  stroke-linecap: round;")
    a("  stroke-linejoin: round;")
    a("}")
    a("")
    a("/* 动效收敛：尊重系统减弱动效偏好 */")
    a("@media (prefers-reduced-motion: reduce) {")
    a("  *,")
    a("  *::before,")
    a("  *::after {")
    a("    animation-duration: 0.01ms !important;")
    a("    animation-iteration-count: 1 !important;")
    a("    transition-duration: 0.01ms !important;")
    a("    scroll-behavior: auto !important;")
    a("  }")
    a("}")
    return "\n".join(L) + "\n"


def main():
    data = build_json()
    os.makedirs(OUT_DIR, exist_ok=True)

    json_path = os.path.join(OUT_DIR, "design-tokens.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    css_path = os.path.join(OUT_DIR, "design-tokens.css")
    with open(css_path, "w", encoding="utf-8") as f:
        f.write(build_css(data))

    print("generated: %s" % os.path.abspath(json_path))
    print("generated: %s" % os.path.abspath(css_path))


if __name__ == "__main__":
    main()