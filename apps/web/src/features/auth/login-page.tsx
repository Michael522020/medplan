/**
 * 登录页 `/login`。
 *
 * ## 双因素（AC-01 / AC-02）
 *
 * 口令 + UKey 数字证书。**没有 UKey 就无法登录** ——
 * 等保三级 8.1.4.1 要求至少一种使用密码技术，短信验证码不合规
 * （Spec §0 已裁决）。
 *
 * ## 四种错误态（UIUX-P2 §1.3）
 *
 * 口令错误 / UKey 缺失 / 证书不匹配 / 账号锁定，各有不同文案与图标。
 * 泛化成「登录失败」会让医生不知道该换 UKey 还是找信息科。
 *
 * ## 响应时间一致（防时序侧信道）
 *
 * 口令错误与 UKey 错误的响应时间必须一致。前端**不得**在 UKey 分支上
 * 做更短的 loading —— 那本身就成了侧信道。
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AlertBanner } from '@/components/ui/alert-banner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconUsb,
} from '@/components/icons';

import { login } from '@/services/medplan-service';
import {
  classifyClockOffset,
  formatClockOffset,
  writeSession,
  type Session,
} from '@/services/session';

import { useUKeyProbe } from './ukey-detector';
import {
  LoginErrorBanner,
  mapLoginError,
  maskSerial,
  type LoginError,
} from './login-errors';

/** 组件属性。 */
export interface LoginPageProps {
  /** 登录成功回调。 */
  readonly onSuccess: (session: Session) => void;
}

/**
 * 登录页。
 */
export function LoginPage({ onSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState<number | null>(null);

  const { result: ukey } = useUKeyProbe();

  // UKey 拔出后立即清除错误提示，避免医生以为已经插好。
  useEffect(() => {
    if (ukey.state === 'absent') {
      setError((current) =>
        current?.kind === 'ukey-missing' ? null : current,
      );
    }
  }, [ukey.state]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) {
        return;
      }

      /**
       * AC-02 强制拒绝：未检测到 UKey 数字证书时**不发起请求**。
       * 这样服务端不会收到任何可区分的信号。
       */
      if (ukey.state !== 'present') {
        setError({
          kind: 'ukey-missing',
          message: '未检测到 UKey 数字证书，请插入后重试',
        });
        return;
      }

      if (!username.trim() || !password) {
        setError({
          kind: 'credentials',
          message: '请填写工号与口令',
        });
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const data = await login({
          username: username.trim(),
          password,
          /**
           * UKey 证书与 PIN 派生值由 UKey 硬件提供。
           * 真实部署时由院内 UKey 厂商的中间件填充这两个字段；
           * 当前无法读取时传空串，服务端会走「证书不匹配」分支。
           */
          ukey_cert: '',
          ukey_pin_block: '',
        });

        const session: Session = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          user: data.user,
          ukey: data.ukey ?? null,
          /**
           * 契约里 `ntpOffsetMs` 是可选字段（服务端未启用 NTP 校时时不返回）。
           * 缺省按 0 处理 —— 偏移为 0 表示「与院内标准时一致」，
           * 不会误触发时钟异常提示。
           */
          ntpOffsetMs: data.ntpOffsetMs ?? 0,
        };
        writeSession(session);
        setClockOffsetMs(session.ntpOffsetMs);
        onSuccess(session);
      } catch (caught) {
        setError(mapLoginError(caught));
      } finally {
        setSubmitting(false);
      }
    },
    [onSuccess, password, submitting, ukey.state, username],
  );

  const clockLevel = clockOffsetMs === null ? 'ok' : classifyClockOffset(clockOffsetMs);

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-card__brand" aria-hidden>
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            role="img"
            aria-label="MedPlan"
          >
            <rect
              x="6"
              y="6"
              width="36"
              height="36"
              rx="8"
              stroke="var(--color-accent-clinical)"
              strokeWidth="2.5"
            />
            <path
              d="M16 30V18l8 8 8-8v12"
              stroke="var(--color-accent-clinical)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="login-card__title">影像诊断工作站</h1>
        <p className="login-card__subtitle">
          请使用医院统一身份认证账号登录
        </p>

        {clockLevel === 'blocking' && clockOffsetMs !== null ? (
          <AlertBanner level="warning" ariaLive="assertive">
            本机时间与院内标准时相差 {formatClockOffset(clockOffsetMs)}，
            电子签名将被拒绝，请先校准系统时间。
          </AlertBanner>
        ) : null}
        {clockLevel === 'notice' && clockOffsetMs !== null ? (
          <AlertBanner level="notice">
            本机时间与院内标准时相差 {formatClockOffset(clockOffsetMs)}，
            请校准系统时间。
          </AlertBanner>
        ) : null}

        {error ? <LoginErrorBanner error={error} /> : null}

        <Field label="工号" htmlFor="login-username">
          <input
            id="login-username"
            className="input"
            type="text"
            autoComplete="username"
            maxLength={64}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
          />
        </Field>

        <Field label="口令" htmlFor="login-password">
          <div className="input-group">
            <input
              id="login-password"
              className="input input-group__control"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
            <button
              type="button"
              className="input-group__addon"
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-label={passwordVisible ? '隐藏口令' : '显示口令'}
              aria-pressed={passwordVisible}
            >
              {passwordVisible ? (
                <IconEyeOff size={16} strokeWidth={1.75} aria-hidden />
              ) : (
                <IconEye size={16} strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </div>
        </Field>

        <Field label="UKey 数字证书" htmlFor="login-ukey">
          <div
            id="login-ukey"
            className="ukey-status"
            tabIndex={0}
            aria-live="polite"
          >
            <IconUsb size={16} strokeWidth={1.75} aria-hidden />
            <span className="ukey-status__text">{ukey.message}</span>
            {ukey.serialNumber ? (
              <span className="ukey-status__serial numeric">
                {maskSerial(ukey.serialNumber)}
              </span>
            ) : null}
          </div>
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="login-card__submit"
          loading={submitting}
          disabled={ukey.state !== 'present'}
          disabledReason={
            ukey.state === 'present'
              ? undefined
              : '未检测到 UKey 数字证书，请插入后登录'
          }
          icon={IconLock}
        >
          {submitting ? '验证中' : '登录'}
        </Button>

        <p className="login-card__policy">
          <IconLock size={14} strokeWidth={1.75} aria-hidden />
          <span>
            本系统采用口令与 UKey 数字证书双因素认证，登录行为将记入操作审计。
          </span>
        </p>
      </form>
    </div>
  );
}
