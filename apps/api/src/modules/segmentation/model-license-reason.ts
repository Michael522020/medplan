import type { ModelLicenseEntry } from './model-license-whitelist.js';

/**
 * 模型许可拒绝原因文案。
 *
 * 面向医师的可读说明。措辞按契约示例：
 *   `rejectionReason: '该task 为非商业许可，不提供商业使用授权'`
 *
 * 不同许可类型给不同原因，便于医师/管理员判断是「彻底不能用」
 * 还是「需要走采购流程申请商业许可」。
 */
export function rejectionReason(entry: ModelLicenseEntry | undefined): string {
  if (!entry) {
    return '该 task 不在许可白名单内，无法确认商业使用授权';
  }
  if (entry.license === 'CC BY-NC 4.0') {
    return '该task 为非商业许可，不提供商业使用授权';
  }
  return '该 task 未提供可用的商业许可授权';
}
