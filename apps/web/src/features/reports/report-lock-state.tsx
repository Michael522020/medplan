/**
 * 报告锁定状态的呈现逻辑。
 *
 * ## 锁定状态是两维的，不是一维的（契约 ReportLockState）
 *
 * `state`/`editable` 回答「**能不能改**」，
 * `signatureValid` 回答「**签名还成不成立**」。二者组合出三种必须
 * 分别处理的情形：
 *
 * | state | editable | signatureValid | 表现 |
 * |-------|----------|----------------|------|
 * | SIGNED | false | true | 正常已签名态：中性锁定色 + 锁图标 |
 * | SIGNED | false | **false** | **签名已失效**：危急色 + 三角警告 + 「原签名已失效」 |
 * | ARCHIVED | false | true | 归档态：需医务部门审批 |
 *
 * 混淆「正常已签名」与「签名已失效」是危险错误 —— 医生会以为自己的
 * 签名还有效，而它已经失效了（AC-14）。
 *
 * ## 前端不得自行推导可编辑性
 *
 * 契约明确：判断「当前能否编辑」**必须用 `lockState.editable`**，
 * 不要用本地的 `signed_at` 或 `status` 推导。
 * 本模块只做**呈现**，不做**判定**。
 */

import type { components } from '@medplan/contracts';

import {
  IconAlertTriangle,
  IconArchive,
  IconLock,
  IconSignature,
  type Icon,
} from '@/components/icons';

/** 契约里的锁定状态。 */
export type ReportLockState = components['schemas']['ReportLockState'];

/** 锁定遮罩的呈现类型。 */
export type LockPresentation =
  /** 可编辑（草稿或审核中）。不显示遮罩。 */
  | 'editable'
  /** 正常已签名锁定。 */
  | 'signed-locked'
  /** 签名已失效（正文在签名后被改过）。 */
  | 'signature-invalid'
  /** 已归档，修改需医务部门审批。 */
  | 'archived';

/** 呈现类型对应的图标。 */
const LOCK_ICON: Record<LockPresentation, Icon> = {
  editable: IconLock,
  'signed-locked': IconLock,
  'signature-invalid': IconAlertTriangle,
  archived: IconArchive,
};

/**
 * 根据服务端锁定状态推导呈现类型。
 *
 * @param lockState 服务端下发的锁定状态（权威）
 */
export function presentLockState(lockState: ReportLockState): LockPresentation {
  if (lockState.editable) {
    return 'editable';
  }
  if (lockState.state === 'ARCHIVED') {
    return 'archived';
  }
  if (!lockState.signatureValid) {
    return 'signature-invalid';
  }
  return 'signed-locked';
}

/** 呈现类型对应的 CSS 类。 */
const LOCK_CLASS: Record<LockPresentation, string> = {
  editable: 'lock-overlay--editable',
  'signed-locked': 'lock-overlay--signed',
  'signature-invalid': 'lock-overlay--invalid',
  'archived': 'lock-overlay--archived',
};

/** 呈现类型对应的标题。 */
const LOCK_TITLE: Record<LockPresentation, string> = {
  editable: '',
  'signed-locked': '已签名锁定，不可修改',
  'signature-invalid': '原签名已失效',
  archived: '报告已归档',
};

/**
 * 锁定遮罩的文案。
 *
 * @param presentation 呈现类型
 * @param lockState 服务端锁定状态
 */
export function describeLock(
  presentation: LockPresentation,
  lockState: ReportLockState,
): string {
  switch (presentation) {
    case 'signed-locked': {
      const at = lockState.lockedAt
        ? new Date(lockState.lockedAt).toLocaleString('zh-CN')
        : '未知时间';
      return `报告已于 ${at} 完成签名，正文与规划方案一并锁定。如需修改，请走报告更正流程。`;
    }
    case 'signature-invalid':
      return '报告正文在签名后发生变更，原签名已按流程自动失效。当前签名状态为无效，请重新签名或联系信息科核查变更痕迹。';
    case 'archived':
      return '报告已归档，修改需医务部门审批凭证。请联系医务部门申请审批。';
    case 'editable':
      return '';
  }
}

/** 锁定遮罩组件的属性。 */
export interface LockOverlayProps {
  readonly lockState: ReportLockState;
  /** 重新签名的回调。签名失效态才提供。 */
  readonly onResign?: () => void;
  /** 查看变更痕迹的回调。 */
  readonly onViewRevision?: () => void;
}

/**
 * 锁定遮罩。
 *
 * 签名失效态用 `role="alert"` + `aria-live="assertive"` 播报 ——
 * 这是安全事件，不能只靠视觉。
 */
export function LockOverlay({
  lockState,
  onResign,
  onViewRevision,
}: LockOverlayProps) {
  const presentation = presentLockState(lockState);
  if (presentation === 'editable') {
    return null;
  }

  const IconComponent = LOCK_ICON[presentation];
  const isInvalid = presentation === 'signature-invalid';

  return (
    <div
      className={`lock-overlay ${LOCK_CLASS[presentation]}`}
      role="alert"
      aria-live="assertive"
    >
      <IconComponent size={24} strokeWidth={2} aria-hidden />
      <p className="lock-overlay__title">{LOCK_TITLE[presentation]}</p>
      <p className="lock-overlay__description">
        {describeLock(presentation, lockState)}
      </p>
      <div className="lock-overlay__actions">
        {isInvalid && onResign ? (
          <button
            type="button"
            className="lock-overlay__action"
            onClick={onResign}
          >
            <IconSignature size={16} strokeWidth={2} aria-hidden />
            重新签名
          </button>
        ) : null}
        {onViewRevision ? (
          <button
            type="button"
            className="lock-overlay__action"
            onClick={onViewRevision}
          >
            变更痕迹
          </button>
        ) : null}
      </div>
    </div>
  );
}
