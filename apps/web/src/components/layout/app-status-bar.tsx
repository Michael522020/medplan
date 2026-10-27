/**
 * 应用底部状态栏（40px）。
 *
 * 展示 PACS 连接状态、当前用户与版本号。
 * PACS 连接状态用图标 + 文字 + 颜色三重编码 —— 「连不上」必须是
 * 明确的文字，不能只靠一个灰色圆点。
 */

import { IconPlugConnected, IconPlugConnectedX, IconServer, IconUser } from '@/components/icons';

/** PACS 连接状态。 */
export type PacsConnectionState = 'connected' | 'disconnected' | 'unknown';

/** 组件属性。 */
export interface AppStatusBarProps {
  pacsState: PacsConnectionState;
  /** PACS 地址。断开时显示，便于判断是院内网络还是 PACS 故障。 */
  pacsAddress?: string;
  /** 当前用户。 */
  userLabel?: string;
  /** 版本号。 */
  version?: string;
  children?: React.ReactNode;
}

const PACS_TEXT: Record<PacsConnectionState, string> = {
  connected: 'PACS 已连接',
  disconnected: 'PACS 连接失败',
  unknown: 'PACS 连接状态未知',
};

/**
 * 底部状态栏。
 */
export function AppStatusBar({
  pacsState,
  pacsAddress,
  userLabel,
  version,
  children,
}: AppStatusBarProps) {
  const disconnected = pacsState !== 'connected';

  return (
    <footer className="app-status-bar">
      <span
        className={[
          'app-status-bar__pacs',
          disconnected ? 'app-status-bar__pacs--offline' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {disconnected ? (
          <IconPlugConnectedX size={14} strokeWidth={2} aria-hidden />
        ) : (
          <IconPlugConnected size={14} strokeWidth={2} aria-hidden />
        )}
        <span>{PACS_TEXT[pacsState]}</span>
        {pacsAddress ? (
          <span className="app-status-bar__address numeric">
            {pacsAddress}
          </span>
        ) : null}
      </span>

      <span className="app-status-bar__spacer" />

      {children}

      {userLabel ? (
        <span className="app-status-bar__item">
          <IconUser size={14} strokeWidth={1.75} aria-hidden />
          <span>{userLabel}</span>
        </span>
      ) : null}
      {version ? (
        <span className="app-status-bar__item numeric">
          <IconServer size={14} strokeWidth={1.75} aria-hidden />
          <span>{version}</span>
        </span>
      ) : null}
    </footer>
  );
}
