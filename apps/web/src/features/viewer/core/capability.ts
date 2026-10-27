/**
 * 渲染能力探测。
 *
 * ## AC-06 的两条硬要求
 *
 * 1. WebGL 不可用时**降级到 2D 模式**（不是白屏、不是报错页）。
 * 2. WebGL 不可用时**隐藏三维入口**（体绘制 / 3D 视口按钮必须 disabled，
 *    且 tooltip 要说明原因 —— 静默禁用会让医生以为是系统故障）。
 *
 * ## 为什么不用 Cornerstone 的 detectRenderingCapabilities
 *
 * `@cornerstonejs/core` 导出了 `detectRenderingCapabilities()`，它会探测
 * 纹理格式支持并把结果写进 localStorage 缓存。这是渲染器初始化时该做的事，
 * 但不适合放在 UI 层：UI 需要的是**「三维能不能开」这一个布尔判断**，
 * 而探测函数会顺带创建一个 WebGL 上下文并在无 WebGL 时返回一组全 false 的
 * 格式能力，语义上比我们需要的信息更宽。
 *
 * 因此本模块做一次最小、独立的探测：能否创建 WebGL2 / WebGL 上下文。
 * 真实的能力探测仍由 Cornerstone 初始化时自己完成。
 */

/** 渲染后端能力。 */
export interface RenderingCapability {
  /** 是否可用 WebGL（1 或 2）。false 时必须降级 2D 并隐藏三维入口。 */
  readonly webglAvailable: boolean;
  /** 是否可用 WebGL2。 */
  readonly webgl2Available: boolean;
  /**
   * 降级原因。`webglAvailable` 为 true 时为 null；
   * 为 false 时是可直接展示给医生的中文说明（不暴露浏览器 API 细节）。
   */
  readonly degradedReason: string | null;
}

/** 不可用时的统一文案。临床软件里「浏览器不支持」要说清影响范围。 */
const DEGRADED_REASON =
  '当前浏览器未启用 WebGL 加速，已降级为 2D 单视图模式。三维重建、MPR 多视图与体绘制功能不可用，请使用院内标准浏览器（Chrome 113+ / Edge 113+）。';

/**
 * 探测 WebGL 可用性。
 *
 * 探测本身会短暂创建一个上下文并立即释放 —— 这是浏览器唯一能准确回答
 * 「这个环境能不能跑 WebGL」的方式，读取 `navigator.userAgent` 或
 * 检查特性开关都不可靠（虚拟机、远程桌面、策略禁用的环境都会骗过它们）。
 */
export function detectRenderingCapability(): RenderingCapability {
  if (typeof document === 'undefined') {
    return {
      webglAvailable: false,
      webgl2Available: false,
      degradedReason: DEGRADED_REASON,
    };
  }

  let webgl2Available = false;
  let webglAvailable = false;

  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      webgl2Available = true;
      webglAvailable = true;
    } else {
      const gl =
        canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      webglAvailable = Boolean(gl);
    }
  } catch {
    webglAvailable = false;
    webgl2Available = false;
  }

  if (!webglAvailable) {
    return {
      webglAvailable: false,
      webgl2Available: false,
      degradedReason: DEGRADED_REASON,
    };
  }

  return {
    webglAvailable: true,
    webgl2Available,
    degradedReason: null,
  };
}

/**
 * 三维入口是否应当隐藏。
 *
 * 抽取成独立函数是为了让「隐藏三维入口」这条 AC-06 要求在代码里只有一处实现，
 * 避免某个面板漏改。UI 层所有三维相关按钮都必须经过它判断。
 */
export function shouldHide3dEntry(capability: RenderingCapability): boolean {
  return !capability.webglAvailable;
}
