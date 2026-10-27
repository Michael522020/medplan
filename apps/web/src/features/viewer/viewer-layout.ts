/**
 * 阅片工作台的布局计算。
 *
 * ## 硬约束：Canvas 最小占比 70%
 *
 * Token 锁定 `viewer-canvas-min-ratio: 70%`，同时锁定
 * `sidebar-left-width: 288px` + `sidebar-right-width: 320px`。
 * 二者在 1920×1080 下**数学不相容**：
 *
 * | 方案 | Canvas 尺寸 | 面积占比 |
 * |------|------------|---------|
 * | 1920 双侧栏全展开 | 1312×968 | 61.25% |
 * | 1920 左栏折叠为 64px | 1536×968 | **71.70%** |
 * | 2560 双侧栏全展开 | 1952×1328 | 70.32% |
 *
 * 因此：**1920 下左栏默认折叠为 64px 图标栏**，2560/4K 双栏全展开天然满足。
 * 这不是审美偏好，是 Token 之间的算术结果。
 *
 * ## 尺寸恒定
 *
 * Spec §10：UI 尺寸恒定，绝不随分辨率放大。侧栏宽度是固定像素值，
 * 只有 Canvas 随屏扩大。
 */

/** 布局常量（与 design-tokens 的 layout 组一致）。 */
export const LAYOUT = {
  /** 顶部状态栏高度。 */
  statusBarHeight: 40,
  /** 底部工具条高度。 */
  toolbarHeight: 40,
  /** 序列导航条高度。 */
  seriesNavHeight: 32,
  /** 左侧栏展开宽度。 */
  sidebarLeftWidth: 288,
  /** 左侧栏折叠后的图标栏宽度。 */
  sidebarLeftCollapsedWidth: 64,
  /** 右侧栏宽度。 */
  sidebarRightWidth: 320,
  /** Canvas 最小面积占比。 */
  canvasMinRatio: 0.7,
  /** 低于此宽度时强制双栏折叠。 */
  viewerMinWidth: 1440,
  /** 达到此宽度时双栏全展开即满足 70%。 */
  fullExpandWidth: 2560,
} as const;

/** 布局输入。 */
export interface ViewerLayoutInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** 用户显式折叠左栏。 */
  readonly leftCollapsed: boolean;
  /** 用户显式折叠右栏。 */
  readonly rightCollapsed: boolean;
}

/** 布局结果。 */
export interface ViewerLayout {
  readonly leftWidth: number;
  readonly rightWidth: number;
  /** Canvas 区域的宽高。 */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Canvas 面积占全屏的比例。 */
  readonly canvasRatio: number;
  /** 是否满足 70% 约束。 */
  readonly meetsCanvasRatio: boolean;
}

/**
 * 计算阅片布局。
 *
 * @param input 视口尺寸与折叠状态
 */
export function computeViewerLayout(input: ViewerLayoutInput): ViewerLayout {
  const { viewportWidth, viewportHeight } = input;

  /**
   * viewerMin（1440px）及以下强制双栏折叠。
   *
   * UIUX-P2 §0.6 的兜底规则：Canvas 宽度不得低于
   * `viewerMin 1440px - 608px = 832px`，低于该值时强制双栏折叠。
   *
   * 注意是 `<=` 而非 `<`：1440 恰好是兜底宽度的定义点。
   * 1440 下双栏折叠后 Canvas 为 1312×788（占比 79.77%）；
   * 若只折叠左栏则为 1056×788（64.21%），**低于 70% 下限**。
   */
  const forceCollapse = viewportWidth <= LAYOUT.viewerMinWidth;

  const leftCollapsed = forceCollapse || input.leftCollapsed;
  const rightCollapsed = forceCollapse || input.rightCollapsed;

  const leftWidth = leftCollapsed
    ? LAYOUT.sidebarLeftCollapsedWidth
    : LAYOUT.sidebarLeftWidth;
  const rightWidth = rightCollapsed
    ? LAYOUT.sidebarLeftCollapsedWidth
    : LAYOUT.sidebarRightWidth;

  const canvasWidth = Math.max(0, viewportWidth - leftWidth - rightWidth);
  const canvasHeight = Math.max(
    0,
    viewportHeight -
      LAYOUT.statusBarHeight -
      LAYOUT.toolbarHeight -
      LAYOUT.seriesNavHeight,
  );

  const screenArea = Math.max(1, viewportWidth * viewportHeight);
  const canvasRatio = (canvasWidth * canvasHeight) / screenArea;

  return {
    leftWidth,
    rightWidth,
    canvasWidth,
    canvasHeight,
    canvasRatio,
    meetsCanvasRatio: canvasRatio >= LAYOUT.canvasMinRatio,
  };
}

/**
 * 推导左栏的默认折叠状态。
 *
 * 1920 下默认折叠（保证 Canvas 达到 71.70%），
 * 2560 及以上默认展开（双栏全展开即满足 70.32%）。
 */
export function deriveDefaultLeftCollapsed(viewportWidth: number): boolean {
  return viewportWidth < LAYOUT.fullExpandWidth;
}

/**
 * 左栏折叠状态的持久化键。
 *
 * 医生展开过一次后要记住 —— 否则每次切回工作台再进来都要重新展开，
 * 是很实际的效率损耗。
 */
export const LEFT_COLLAPSED_STORAGE_KEY = 'medplan.viewer.leftCollapsed';

/** 读取持久化的左栏折叠状态。无记录时返回 null。 */
export function readPersistedLeftCollapsed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(LEFT_COLLAPSED_STORAGE_KEY);
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

/** 持久化左栏折叠状态。 */
export function persistLeftCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      LEFT_COLLAPSED_STORAGE_KEY,
      String(collapsed),
    );
  } catch {
    // 存储失败不影响本次会话内的状态。
  }
}
