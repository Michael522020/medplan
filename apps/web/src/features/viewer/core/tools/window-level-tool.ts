/**
 * 窗宽窗位工具。
 *
 * ## AC-04 的性能约束
 *
 * 「拖动窗宽窗位时必须在 100ms 内更新视口且不丢失 HU 值精度」。
 * Cornerstone 的 WindowLevelTool 在拖拽过程中会节流渲染，
 * 而 VOI（窗宽窗位）的数值本身是连续的 —— 精度损失来自把 VOI
 * 量化到整数再回读，因此本模块把 VOI 的读取放在 UI 层，
 * 由 UI 直接读视口属性而不是从工具状态反推。
 *
 * ## 左键与右键等价（UIUX-P2 §3.4.1）
 *
 * 右键拖拽与左键拖拽行为一致 —— 这是为惯用右手医生保留的并行路径，
 * 不是冗余。右键路径必须屏蔽浏览器右键菜单（由视口容器统一处理）。
 *
 * 注意：窗宽窗位工具与平移/缩放**不互斥**。医生常常一边调窗一边平移，
 * 把它们设为互斥会让「调完窗想看一眼隔壁」变成两次工具切换。
 */

import { WindowLevelTool } from '@cornerstonejs/tools';

import { createPairedTool, type ViewerTool } from './tool-contract';
import { toCornerstoneBindings } from './tool-bindings';

/** 窗宽窗位工具（快捷键 W）。 */
export const windowLevelTool: ViewerTool = createPairedTool(
  {
    id: 'WindowLevel',
    label: '窗宽窗位',
    category: 'system',
    shortcut: 'W',
    exclusive: false,
    bindings: [{ kind: 'primary' }, { kind: 'secondary' }],
  },
  (group) => {
    group.setToolActive(
      'WindowLevel',
      toCornerstoneBindings([{ kind: 'primary' }, { kind: 'secondary' }]),
    );
  },
  (group) => {
    group.setToolPassive('WindowLevel');
  },
);

/** 窗宽窗位工具对应的 Cornerstone 工具类，用于全局注册。 */
export const windowLevelToolClasses = [WindowLevelTool];

/** 常用预设窗。键为预设名，值为 [窗宽, 窗位]。 */
export const WINDOW_PRESETS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly level: number;
}> = [
  { key: 'soft-tissue', label: '软组织窗', width: 400, level: 40 },
  { key: 'lung', label: '肺窗', width: 1500, level: -600 },
  { key: 'bone', label: '骨窗', width: 2000, level: 400 },
  { key: 'brain', label: '脑窗', width: 80, level: 40 },
  { key: 'mediastinum', label: '纵隔窗', width: 350, level: 50 },
];

/**
 * 应用一组预设窗。
 *
 * @param apply 实际设置视口属性的回调。由 UI 层提供（视口句柄在 UI 层）。
 */
export function applyWindowPreset(
  preset: { width: number; level: number },
  apply: (width: number, level: number) => void,
): void {
  apply(preset.width, preset.level);
}
