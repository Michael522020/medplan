import type { components } from '@medplan/contracts/generated';
import { formatResourceId } from '../../common/id/ids.js';
import type {
  SegmentationStructureRow,
  SegmentationTaskRow,
} from './segmentation-types.js';
import type { ConfirmRow } from './segmentation-confirms.repository.js';

/**
 * AI 分割结果的 DTO 映射与期相判定。
 *
 * 单独成文件：期相判定（AI-01）是**独立的业务规则**，
 * 与提交/查询的编排逻辑关注点不同，且需要被单独审阅 ——
 * 「平扫能不能做肝胆分割」这条规则值得一眼看清。
 */

/**
 * 期相资格判定（AI-01）。
 *
 * 规则：
 *   1. 序列实际期相必须与请求的目标期相**一致**
 *   2. 必须是增强期相（arterial / portal / delayed），平扫与 unknown 不合格
 *   3. 期相置信度 < 0.70 时不合格（期相识别不确定，选错期相会浪费一次 GPU 任务）
 */
export function evaluatePhaseEligibility(
  seriesPhase: string,
  confidence: number | null,
  targetPhase: string
): {
  eligible: boolean;
  reasonCode: 'PHASE_NOT_ENHANCED' | 'PHASE_LOW_CONFIDENCE' | null;
} {
  const enhanced = ['arterial', 'portal', 'delayed'];
  if (!enhanced.includes(seriesPhase)) {
    return { eligible: false, reasonCode: 'PHASE_NOT_ENHANCED' };
  }
  if (confidence !== null && confidence < 0.7) {
    return { eligible: false, reasonCode: 'PHASE_LOW_CONFIDENCE' };
  }
  if (seriesPhase !== targetPhase) {
    return { eligible: false, reasonCode: 'PHASE_NOT_ENHANCED' };
  }
  return { eligible: true, reasonCode: null };
}

/** DB 行 -> 契约结构项 */
export function toStructure(
  row: SegmentationStructureRow
): components['schemas']['SegmentationStructure'] {
  return {
    structureName: row.structure_name as components['schemas']['StructureName'],
    structureLabelZh: (row.structure_label_zh ??
      row.structure_name) as components['schemas']['StructureLabelZh'],
    volumeMl: Number(row.volume_ml),
    sopInstanceUid: row.seg_sop_uid,
    confirmed: row.confirmed,
  };
}

/** 确认进度 */
export function buildConfirmProgress(
  structures: SegmentationStructureRow[],
  confirms: ConfirmRow[]
): components['schemas']['ConfirmProgress'] {
  const total = structures.length;
  const confirmed = confirms.length;
  return {
    total,
    confirmed,
    // total 为 0 时不算「全部确认」—— 没有可确认项时不应放行
    allConfirmed: total > 0 && confirmed >= total,
  };
}

/** 提交任务响应映射 */
export function toSubmitResponse(
  task: SegmentationTaskRow,
  replay: boolean
): components['schemas']['CreateSegmentationTaskResponse'] {
  return {
    code: 0,
    message: '',
    data: {
      taskId: formatResourceId('seg', task.id),
      studyUid: task.study_uid,
      seriesUid: task.series_uid,
      model: task.model_name as components['schemas']['SegmentationModel'],
      modelVersion: task.model_version,
      weightsVersion: task.weights_version,
      status: task.status as components['schemas']['SegmentationTaskStatus'],
      fast: task.fast_flag,
      degraded: task.degraded,
      targetPhase: (task.phase_checked ?? 'portal') as 'arterial' | 'portal' | 'delayed',
      estimatedWaitSeconds: 210,
      idempotentReplay: replay,
      submittedBy: task.submitted_by,
      submittedAt: task.created_at.toISOString(),
    },
  };
}

/** 任务状态响应映射 */
export function toTaskResponse(
  task: SegmentationTaskRow,
  structures: SegmentationStructureRow[],
  confirms: ConfirmRow[]
): components['schemas']['SegmentationTaskResponse'] {
  return {
    code: 0,
    message: '',
    data: {
      taskId: formatResourceId('seg', task.id),
      studyUid: task.study_uid,
      seriesUid: task.series_uid,
      model: task.model_name as components['schemas']['SegmentationModel'],
      modelVersion: task.model_version,
      weightsVersion: task.weights_version,
      status: task.status as components['schemas']['SegmentationTaskStatus'],
      fast: task.fast_flag,
      degraded: task.degraded,
      progressPercent: task.progress_percent,
      phaseValidation: {
        seriesPhase: (task.phase_checked ?? 'unknown') as components['schemas']['SeriesPhase'],
        eligible: task.phase_eligible ?? false,
        reasonCode: task.phase_eligible === false ? 'PHASE_NOT_ENHANCED' : null,
      },
      structures: structures.map((row) => toStructure(row)),
      confirmProgress: buildConfirmProgress(structures, confirms),
      error: task.error_code
        ? {
            code: task.error_code,
            failedAtStep: (task.error_step ??
              'inference') as components['schemas']['SegmentationTaskError']['failedAtStep'],
            message: task.error_detail ?? '推理失败',
          }
        : null,
      disclaimer: '本结果为 AI 辅助标记，不构成诊断结论，须经执业医师确认',
      submittedBy: task.submitted_by,
      submittedAt: task.created_at.toISOString(),
      startedAt: task.started_at ? task.started_at.toISOString() : null,
      finishedAt: task.finished_at ? task.finished_at.toISOString() : null,
    },
  };
}
