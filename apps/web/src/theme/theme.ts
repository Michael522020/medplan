/**
 * 主题管理。
 *
 * 两条专业硬约束（前端不得"修正"）：
 *
 * 1. **阅片 Canvas 恒暗**。灰阶影像在白底上会丧失诊断对比 —— 这是
 *    AAPM TG-18 的诊断阅片站环境照度要求（2–10 lx）推导出的专业约束，
 *    不是审美偏好。亮色主题下 --color-surface-canvas 仍是 #1A1A1A。
 *
 * 2. **Canvas 上的角标文字用 --color-text-on-canvas**，不能用
 *    --color-text-primary —— 后者在亮色主题下是深色，叠在恒暗的 Canvas 上
 *    会看不见。text-on-canvas 双主题恒为浅色。
 *
 * 主题切换：<html data-theme="light|dark">。
 * 首次进入默认暗色 —— 放射诊断场景使用时长压倒性占优，
 * 且"误用暗色"的风险不对称（明亮环境下只是对比度低，
 * 暗环境下的白底是眩光 + 灰阶感知干扰）。
 */

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'medplan.theme';
const DEFAULT_THEME: ThemeName = 'dark';

/** 阻塞式内联脚本需在首屏渲染前执行，避免主题闪烁 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t='${DEFAULT_THEME}';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');}})();`;

function readStoredTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // 隐私模式或存储被禁用时，回落到默认值
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存储失败不影响本次会话的主题生效
  }
}

export function getCurrentTheme(): ThemeName {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

export function toggleTheme(): ThemeName {
  const next: ThemeName = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/**
 * 服务端也存了一份 user.preference.theme（用户偏好需跨设备同步）。
 * 优先级：服务端 > 本地存储 > 默认暗色。
 */
export function syncThemeFromServer(serverTheme: string | null | undefined): ThemeName {
  if (serverTheme === 'light' || serverTheme === 'dark') {
    applyTheme(serverTheme);
    return serverTheme;
  }
  return readStoredTheme();
}
