/**
 * 资源 ID 编解码。
 *
 * ## 为什么需要这一层
 *
 * 契约对外暴露的是**带前缀的 UUID v7**：
 *   分割任务  `seg-<uuid>`   路径正则 `^seg-[0-9a-f]{8}-...-[0-9a-f]{12}$`
 *   规划方案  `plan-<uuid>`
 *   报告      `r-<uuid>`
 *
 * 而数据库主键是**裸 uuid**（`segmentation_tasks.id` 等）。
 * 前缀不是装饰，它承担安全职责：
 *
 *   1. **类型隔离**：把报告 ID 填进任务 ID 路径不会命中别的表
 *      （虽然 uuid 本身不会撞，但前缀让「填错参数」在参数校验阶段就报错，
 *      而不是变成一次无意义的数据库查询）
 *   2. **不可枚举**：uuid v7 有 122 bit 熵，无法遍历。攻击者构造不出有效
 *      taskId/planId/reportId，因此这些路径上的「存在与否」不构成
 *      患者存在性预言机（openapi.yaml §4.1 的安全前提）
 *
 * ## 边界
 *
 * 本模块只做**字符串与 uuid 的映射**，不碰数据库。
 * repository 拿到裸 uuid 后再查表。
 */

import { AppError } from '../errors/app-error.js';

export type ResourcePrefix = 'seg' | 'plan' | 'r';

/** 契约路径参数的正则（与 openapi.yaml parameters 完全一致） */
const ID_PATTERN = /^([a-z]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** 裸 uuid 正则 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 校验并解析带前缀的资源 ID。
 *
 * @param prefixed 形如 `seg-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 * @param expected 期望的前缀。传了就会校验前缀匹配 —— 前缀不匹配说明
 *                 客户端把 A 资源的 ID 填进了 B 资源的路径
 * @returns 裸 uuid（小写）
 * @throws AppError 10001 参数错误
 */
export function parseResourceId(prefixed: string, expected: ResourcePrefix): string {
  const match = ID_PATTERN.exec(prefixed);
  if (!match) {
    throw AppError.paramInvalid(`${expected} 资源标识格式不合法`);
  }
  const [, prefix, uuid] = match as unknown as [string, string, string];
  if (prefix !== expected) {
    throw AppError.paramInvalid(`${expected} 资源标识格式不合法`);
  }
  return uuid;
}

/** 裸 uuid -> 带前缀的契约 ID */
export function formatResourceId(prefix: ResourcePrefix, uuid: string): string {
  return `${prefix}-${uuid}`;
}

/** 校验裸 uuid 字符串 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * 校验 DICOM UID。
 *
 * 契约正则 `^[0-9]+(\.[0-9]+)+$`。DICOM UID 由数字与点组成，
 * 长度上限 64（openapi.yaml StudyUidPath.maxLength）。
 */
export function assertDicomUid(value: string, field = 'studyUid'): string {
  if (!/^[0-9]+(\.[0-9]+)+$/.test(value)) {
    throw AppError.paramInvalid(`${field} 不是合法的 DICOM UID`);
  }
  if (value.length > 64) {
    throw AppError.paramInvalid(`${field} 长度不得超过 64`);
  }
  return value;
}
