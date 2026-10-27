import { Injectable } from '@nestjs/common';
import type { components } from '@medplan/contracts/generated';
import { AppError } from '../../common/errors/app-error.js';
import type { Session } from '../../common/auth/session.js';
import {
  canReadPlainText,
  toAccessContext,
} from '../../common/access/access-context.js';
import { StudiesRepository, type StudyListRow } from './studies.repository.js';
import { SeriesRepository, type SeriesRow } from './series.repository.js';

/**
 * 检查列表与序列的��务逻辑。
 */
@Injectable()
export class StudiesService {
  constructor(
    private readonly repository: StudiesRepository,
    private readonly seriesRepository: SeriesRepository
  ) {}

  /**
   * GET /api/v1/studies
   *
   * 检查列表（按数据权限过滤）。
   *
   * 过滤在 SQL 层完成（见 repository）。当指定 `patientId` 而该患者
   * 不可见时，返回 **10004** —— 与「患者不存在」完全相同的响应。
   */
  async listStudies(
    session: Session,
    filters: {
      patientId?: string;
      accessionNo?: string;
      modality?: string;
      studyDateFrom?: string;
      studyDateTo?: string;
      status?: string;
      visitType?: string;
      sort: string;
      order: 'asc' | 'desc';
      page: number;
      limit: number;
    },
    deidentify: boolean
  ): Promise<components['schemas']['StudyListResponse']> {
    const access = toAccessContext(session);

    // 指定患者但不可见 -> 10004（与患者不存在不可区分）
    if (filters.patientId) {
      const visible = await this.repository.probePatientScope(filters.patientId, access);
      if (!visible) {
        // 不可见与不存在都走这一条分支，响应体完全相同
        throw AppError.inaccessible();
      }
    }

    // 明文姓名仅质控/病案角色可用，且该路径强制写审计（由审计钩子覆盖）
    const usePlainName = deidentify === false && canReadPlainText(session);

    const { rows, total } = await this.repository.listStudies(filters, access, usePlainName);

    return {
      code: 0,
      message: '',
      data: {
        items: rows.map((row) => toStudyListItem(row)),
        total,
        page: filters.page,
        limit: filters.limit,
        hasMore: filters.page * filters.limit < total,
      },
    };
  }

  /**
   * GET /api/v1/studies/{studyUid}/series
   *
   * 序列列表（按期相自动分组）。
   *
   * ## 不可区分性
   *
   * 「检查不存在」与「检查存在但无权限」都表现为：可见性谓词过滤后 0 行。
   * 两种情况返回**同一个 10004**，响应体字节数相同。
   *
   * 时序方面：repository 内部先执行一次**仅按 study_uid 主键索引**的探测查询
   * （恒定索引路径，与权限无关），再执行带可见性谓词的作用域查询。
   * 两条路径的数据库调用次数与索引路径相同，因此响应时间分布一致
   * （架构方案 12.3 C-3：p99 差异 < 20%）。
   */
  async listSeries(
    session: Session,
    studyUid: string
  ): Promise<components['schemas']['SeriesGroupedResponse']> {
    const access = toAccessContext(session);

    // 恒定索引路径的探测查询。无论检查是否存在都会执行
    await this.repository.probeStudy(studyUid);

    const result = await this.seriesRepository.findStudyWithSeries(studyUid, access);
    if (!result) {
      // 不存在 与 无权限 -> 同一个 10004
      throw AppError.inaccessible();
    }

    const { header, series } = result;
    return {
      code: 0,
      message: '',
      data: {
        studyUid: header.study_uid,
        accessionNo: header.accession_no,
        modality: header.modality as components['schemas']['Modality'],
        studyDescription: header.study_description ?? undefined,
        totalSeries: series.length,
        totalInstances: header.total_instances,
        phaseGroups: groupByPhase(series),
      },
    };
  }
}

/**
 * 按期相分组。
 *
 * DCM-02：平扫 / 动脉期 / 门脉期 / 延迟期 / 期相待确认。
 *
 * 分组顺序固定为契约枚举顺序（plain -> arterial -> portal -> delayed -> unknown），
 * 前端按数组顺序渲染，不需要再排序。
 */
function groupByPhase(
  series: SeriesRow[]
): components['schemas']['PhaseGroup'][] {
  const phaseOrder = ['plain', 'arterial', 'portal', 'delayed', 'unknown'] as const;
  const buckets = new Map<string, SeriesRow[]>();
  for (const item of series) {
    const key = phaseOrder.includes(item.phase as (typeof phaseOrder)[number])
      ? item.phase
      : 'unknown';
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  return phaseOrder
    .filter((phase) => buckets.has(phase))
    .map((phase) => {
      const items = buckets.get(phase) ?? [];
      return {
        phase,
        phaseLabel: phaseLabel(phase),
        // 组置信度取组内最小值：只要有一期识别不确定，整组就不能默认选中
        confidence: Math.min(
          ...items.map((item) => item.phase_confidence ?? 0)
        ),
        series: items.map((item) => toSeriesItem(item)),
      };
    });
}

/** 期相中文标签（契约 PhaseLabel 枚举） */
function phaseLabel(phase: string): components['schemas']['PhaseLabel'] {
  switch (phase) {
    case 'plain':
      return '平扫';
    case 'arterial':
      return '动脉期';
    case 'portal':
      return '门脉期';
    case 'delayed':
      return '延迟期';
    default:
      return '期相待确认';
  }
}

/** DB 行 -> 契约序列项 */
function toSeriesItem(row: SeriesRow): components['schemas']['SeriesItem'] {
  return {
    seriesUid: row.series_uid,
    seriesNumber: row.series_number,
    description: row.series_description ?? undefined,
    instanceCount: row.instance_count,
    sliceThicknessMm: row.slice_thickness_mm ?? 0,
    rows: row.rows ?? 0,
    columns: row.columns ?? 0,
    pixelSpacingMm: row.pixel_spacing_mm ?? undefined,
    transferSyntaxUid: row.transfer_syntax_uid ?? '',
    windowCenter: row.window_center ?? undefined,
    windowWidth: row.window_width ?? undefined,
    isDefaultWindow: false,
  };
}

/** DB 行 -> 契约检查列表项 */
function toStudyListItem(row: StudyListRow): components['schemas']['StudyListItem'] {
  return {
    studyUid: row.study_uid,
    accessionNo: row.accession_no,
    modality: row.modality as components['schemas']['Modality'],
    bodyPart: row.body_part as components['schemas']['StudyListItem']['bodyPart'],
    studyDescription: row.study_description ?? undefined,
    studyDate: row.study_date.toISOString(),
    status: row.status as components['schemas']['StudyStatus'],
    seriesCount: row.series_count,
    patient: {
      patientId: row.empi_id,
      nameMasked: row.patient_name,
      gender: row.gender as components['schemas']['PatientBrief']['gender'],
      birthDate: row.birth_date.toISOString().slice(0, 10),
      ageYears: row.age_years,
      idCardMasked: row.id_card_masked ?? '',
    },
    visit: {
      visitId: row.visit_id,
      visitNo: row.visit_no,
      visitType: row.visit_type as components['schemas']['VisitType'],
      dept: row.dept,
      wardDept: row.ward_dept,
      bedNo: row.bed_no,
    },
    reportId: row.report_id ?? null,
    readStatus: row.read_status as components['schemas']['StudyListItem']['readStatus'],
    readAt: row.read_at ? row.read_at.toISOString() : null,
    isEmergency: row.visit_type === 'emergency',
    queueWaitSeconds: row.queue_wait_seconds,
    hasSignedReport: row.has_signed_report,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
