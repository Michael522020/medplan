/**
 * 图标统一出口。
 *
 * 规则（项目锁定，违反即退回重做）：
 * - 只用 @tabler/icons-react 3.49.0，禁止 emoji，禁止混用第二套库
 * - **导出名带 Icon 前缀**（IconAlertTriangle / IconAlertTriangleFilled）。
 *   库里没有不带前缀的别名 —— 写错会直接编译失败，这是好事。
 * - Tabler 的 filled 变体是**同名独立构件**（IconStar / IconStarFilled），
 *   不是 -filled 后缀
 * - 尺寸规范：16px 行内 / 20px 按钮内 / 24px 独立图标
 * - 颜色继承 currentColor，由 CSS 控制
 *
 * 为什么集中在一个文件：
 * 组件里直接 import 会让逐个 import 变成决策点，容易混进第二套库
 * 或写成 emoji。这里做单一出口 + 具名导出，组件只从这里取。
 *
 * 名称校验：
 *   本文件的每个导出名均对照 @tabler/icons-react@3.49.0 的 ESM 入口
 *   中 6304 个 `Icon<X>` 真实导出名逐一核验，无凭印象书写的名字。
 *   由 scripts/lint_icons.js 持续守护。
 */

export type { Icon, IconProps } from '@tabler/icons-react';

export {
  // 导航与布局
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
  IconLayoutGrid,
  IconLayoutRows,
  IconList,
  IconTable,
  IconHome,

  // 阅片工具（工具栏「未激活/已激活」两态用同名双构件）
  IconZoomIn,
  IconZoomOut,
  IconPointer,
  IconPointerFilled,
  IconHandGrab,
  IconCrosshair,
  IconRuler,
  IconAngle,
  IconSquare,
  IconStack2,
  IconStack2Filled,
  IconBox,
  IconSun,
  IconMoon,
  IconFocusCentered,
  IconMaximize,
  IconMinimize,
  IconCrop,
  IconVector,
  IconVectorTriangle,
  IconAdjustments,
  IconLink,
  IconRotate2,
  IconPencil,
  IconLetterT,

  // 报告与签名
  IconFileDescription,
  IconFileDescriptionFilled,
  IconEdit,
  IconEditFilled,
  IconWritingSign,
  IconSignature,
  IconLock,
  IconLockOpen,
  IconLockAccess,
  IconShieldCheck,
  IconShieldCheckFilled,
  IconCertificate,
  IconFileCertificate,
  IconArchive,
  IconArchiveFilled,
  IconArchiveOff,
  IconSend,
  IconDeviceFloppy,
  IconCopy,
  IconTrash,
  IconTimelineEvent,
  IconReportMedical,
  IconNotebook,
  IconDeviceSpeaker,
  IconKeyboard,

  // 临床状态（三重编码：颜色 + 图标 + 文字）
  IconAlertTriangle,
  IconAlertTriangleFilled,
  IconAlertCircle,
  IconAlertOctagon,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleX,
  IconCircleDashed,
  IconInfoCircle,
  IconHelpCircle,
  IconChecks,
  IconChecklist,
  IconClipboardCheck,
  IconClipboardText,
  IconEye,
  IconEyeOff,
  IconEyeExclamation,
  IconSquareCheck,
  IconSquareX,
  IconRosetteDiscountCheck,

  // 医学与科室
  IconStethoscope,
  IconBuildingHospital,
  IconFirstAidKit,
  IconHeartbeat,
  IconScan,
  IconChartHistogram,
  IconChartDots,
  IconHierarchy2,
  IconTopologyStar,
  IconSitemap,
  IconMapPin,

  // AI 与任务
  IconBrain,
  IconCpu,
  IconClock,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerPause,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRepeat,
  IconLoader2,
  IconProgress,

  // 系统
  IconSettings,
  IconLogout,
  IconUser,
  IconUsers,
  IconSearch,
  IconFilter,
  IconCalendar,
  IconChevronRight,
  IconChevronLeft,
  IconChevronDown,
  IconChevronsLeft,
  IconChevronsRight,
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconBell,
  IconFlag,
  IconInbox,
  IconServer,
  IconPlugConnected,
  IconPlugConnectedX,
  IconFileOff,
  IconUsb,
  IconPlus,
  IconX,
  IconCheck,
  IconDots,
  IconDotsVertical,
  IconRefresh,
  IconExternalLink,
  IconDatabase,
  IconActivity,
  IconSunMoon,
  IconDeviceDesktop,
  IconWifi,
  IconWifiOff,
  IconRoute,
  IconTarget,
  IconAxisX,
  IconAxisY,
} from '@tabler/icons-react';
