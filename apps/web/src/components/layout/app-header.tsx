/**
 * 应用顶部状态栏（40px）。
 *
 * ## 尺寸恒定
 *
 * 高度固定 40px（--statusbar-height），不随分辨率变化。
 * 医生已形成肌肉记忆，工具栏在 4K 下放大一倍会让所有快捷键位置全错。
 *
 * ## 患者标识
 *
 * 顶部栏承载患者标识 —— 这是防「写错患者」的最后一道防线。
 * 在报告页尤其关键：UIUX-P2 §6.1 明确「患者标识与阅片页完全一致」。
 */

import type { ReactNode } from 'react';

import {
  IconBell,
  IconChevronDown,
  IconMoon,
  IconSearch,
  IconSun,
  IconUser,
} from '@/components/icons';

/** 顶部栏属性。 */
export interface AppHeaderProps {
  /** 面包屑各段。 */
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
  /** 患者标识（脱敏姓名 + 性别年龄）。 */
  patientLabel?: string;
  /** 危急值计数。有危急值时铃铛显示角标。 */
  criticalCount?: number;
  /** 当前主题。 */
  theme: 'light' | 'dark';
  /** 切换主题。 */
  onToggleTheme: () => void;
  /** 当前用户名。 */
  userName?: string;
  /** 用户菜单内容。 */
  userMenu?: ReactNode;
  /** 搜索框内容（阅片页与工作台不同）。 */
  searchSlot?: ReactNode;
  /** 额外内容。 */
  children?: ReactNode;
}

/**
 * 顶部状态栏。
 */
export function AppHeader({
  breadcrumbs = [],
  patientLabel,
  criticalCount = 0,
  theme,
  onToggleTheme,
  userName,
  userMenu,
  searchSlot,
  children,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__product">MedPlan</span>
      </div>

      {breadcrumbs.length > 0 ? (
        <nav className="app-header__breadcrumbs" aria-label="面包屑">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="app-header__crumb">
              {index > 0 ? (
                <IconChevronDown
                  size={12}
                  strokeWidth={2}
                  aria-hidden
                  className="app-header__crumb-separator"
                />
              ) : null}
              {crumb.href ? (
                <a href={crumb.href}>{crumb.label}</a>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {searchSlot ? (
        <div className="app-header__search">{searchSlot}</div>
      ) : (
        <div className="app-header__search">
          <span className="app-header__search-placeholder">
            <IconSearch size={14} strokeWidth={2} aria-hidden />
            <span>搜索患者或检查号</span>
          </span>
        </div>
      )}

      {patientLabel ? (
        <span className="app-header__patient numeric">{patientLabel}</span>
      ) : null}

      <div className="app-header__actions">
        {children}
        <button
          type="button"
          className="app-header__icon-button"
          aria-label={
            criticalCount > 0
              ? `危急值提醒，${criticalCount} 项待处理`
              : '提醒'
          }
        >
          <IconBell size={18} strokeWidth={1.75} aria-hidden />
          {criticalCount > 0 ? (
            <span className="app-header__badge numeric">{criticalCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="app-header__icon-button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
        >
          {theme === 'dark' ? (
            <IconSun size={18} strokeWidth={1.75} aria-hidden />
          ) : (
            <IconMoon size={18} strokeWidth={1.75} aria-hidden />
          )}
        </button>
        {userName ? (
          <button type="button" className="app-header__user">
            <IconUser size={16} strokeWidth={1.75} aria-hidden />
            <span className="app-header__user-name">{userName}</span>
            <IconChevronDown size={12} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
        {userMenu}
      </div>
    </header>
  );
}
