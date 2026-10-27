/**
 * AI 分割任务的行类型。
 *
 * 单独成文件：repository、service、mapper 三者都用得到这些类型，
 * 放在 repository 文件里会让上层反向依赖 repository 的类型定义。
 */
export interface SegmentationTaskRow {
  id: string;
  study_uid: string;
  series_uid: string;
  model_name: string;
  model_version: string;
  weights_version: string | null;
  fast_flag: boolean;
  degraded: boolean;
  status: string;
  progress_percent: number;
  phase_checked: string | null;
  phase_eligible: boolean | null;
  error_code: number | null;
  error_step: string | null;
  error_detail: string | null;
  submitted_by: string;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

export interface SegmentationStructureRow {
  structure_name: string;
  structure_label_zh: string | null;
  volume_ml: string;
  seg_sop_uid: string | null;
  /** 该结构的确认状态（取最新一条确认记录） */
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  confirm_action: string | null;
}
