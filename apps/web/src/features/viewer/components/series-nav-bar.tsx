/**
 * 序列导航条（32px）。
 *
 * 位于 Canvas 区内、Canvas 下方。展示当前层号与总层数，并提供
 * 电影回放与跳转。
 *
 * ## 层号必须精确
 *
 * UIUX-P2 §3.3 明确：超大层数（>9999）时层号**必须**显示精确的
 * `12478/12480`，不允许缩写成「1.2万」—— 医生要按层号定位，
 * 缩写会让跳转失去意义。tabular-nums 保证数字不跳动。
 */

import { useCallback, useState } from 'react';

import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
} from '@/components/icons';

/** 组件属性。 */
export interface SeriesNavBarProps {
  readonly currentIndex: number;
  readonly total: number;
  readonly cinePlaying: boolean;
  readonly onStep: (delta: number) => void;
  readonly onJump: (index: number) => void;
  readonly onToggleCine: () => void;
  readonly onToggleFullscreen?: () => void;
}

/**
 * 序列导航条。
 */
export function SeriesNavBar({
  currentIndex,
  total,
  cinePlaying,
  onStep,
  onJump,
  onToggleCine,
}: SeriesNavBarProps) {
  const [jumpValue, setJumpValue] = useState('');

  const onJumpSubmit = useCallback(() => {
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    onJump(Math.min(Math.max(parsed - 1, 0), Math.max(total - 1, 0)));
    setJumpValue('');
  }, [jumpValue, onJump, total]);

  return (
    <div className="series-nav">
      <button
        type="button"
        className="series-nav__step"
        onClick={() => onStep(-1)}
        disabled={currentIndex <= 0}
        aria-label="上一层"
      >
        <IconChevronLeft size={16} strokeWidth={2} aria-hidden />
      </button>

      <span className="series-nav__position numeric">
        {currentIndex + 1}/{total}
      </span>

      <button
        type="button"
        className="series-nav__step"
        onClick={() => onStep(1)}
        disabled={currentIndex >= total - 1}
        aria-label="下一层"
      >
        <IconChevronRight size={16} strokeWidth={2} aria-hidden />
      </button>

      <button
        type="button"
        className={[
          'series-nav__cine',
          cinePlaying ? 'series-nav__cine--playing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onToggleCine}
        aria-pressed={cinePlaying}
        aria-keyshortcuts="Space"
        title={cinePlaying ? '暂停回放（Space）' : '电影回放（Space）'}
      >
        {cinePlaying ? (
          <IconPlayerPause size={16} strokeWidth={2} aria-hidden />
        ) : (
          <IconPlayerPlayFilled size={16} strokeWidth={2} aria-hidden />
        )}
        <span className="series-nav__cine-label">
          {cinePlaying ? '暂停' : '回放'}
        </span>
      </button>

      <form
        className="series-nav__jump"
        onSubmit={(event) => {
          event.preventDefault();
          onJumpSubmit();
        }}
      >
        <label className="sr-only" htmlFor="series-jump">
          跳转到指定层
        </label>
        <input
          id="series-jump"
          className="input input--compact numeric"
          type="number"
          inputMode="numeric"
          min={1}
          max={total}
          placeholder="跳转"
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value)}
        />
      </form>
    </div>
  );
}

/** 回放播放图标（供外部复用）。 */
export { IconPlayerPlay };
