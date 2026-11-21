import React from 'react';

export interface IconProps {
  className?: string;
  size?: 'md' | 'sm';
}

function SvgIcon({
  children,
  className,
  size = 'md',
}: IconProps & { children: React.ReactNode }) {
  const baseClass = size === 'sm' ? 'icon icon-sm' : 'icon';
  return (
    <svg
      className={className ? `${baseClass} ${className}` : baseClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconNow(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </SvgIcon>
  );
}

export function IconMatrix(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </SvgIcon>
  );
}

export function IconQadaa(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
    </SvgIcon>
  );
}

export function IconAnalytics(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="5" y1="19" x2="19" y2="19" />
      <rect x="6" y="11" width="3" height="8" />
      <rect x="11" y="7" width="3" height="12" />
      <rect x="16" y="13" width="3" height="6" />
    </SvgIcon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </SvgIcon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="5 12.5 9.5 17 19 7.5" />
    </SvgIcon>
  );
}

export function IconCross(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </SvgIcon>
  );
}

export function IconDash(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="6" y1="12" x2="18" y2="12" />
    </SvgIcon>
  );
}

export function IconExpiredAlert(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <circle cx="12" cy="16" r="0.6" />
    </SvgIcon>
  );
}

export function IconMoreDots(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </SvgIcon>
  );
}

export function IconSun(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.9" y1="4.9" x2="7" y2="7" />
      <line x1="17" y1="17" x2="19.1" y2="19.1" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="19.1" x2="7" y2="17" />
      <line x1="17" y1="7" x2="19.1" y2="4.9" />
    </SvgIcon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </SvgIcon>
  );
}

export function IconSidebar(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </SvgIcon>
  );
}

export function IconMosque(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 20h16" />
      <path d="M6 20v-7a6 6 0 0 1 12 0v7" />
      <path d="M12 3v4" />
      <path d="M9 20v-4a3 3 0 0 1 6 0v4" />
    </SvgIcon>
  );
}

export function IconCheckAll(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="2 12.5 6.5 17 16 7.5" />
      <polyline points="10.5 17 12.5 17 22 7.5" />
    </SvgIcon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="6 9 12 15 18 9" />
    </SvgIcon>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="15 18 9 12 15 6" />
    </SvgIcon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="9 18 15 12 9 6" />
    </SvgIcon>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </SvgIcon>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </SvgIcon>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </SvgIcon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </SvgIcon>
  );
}

export function IconLogOut(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </SvgIcon>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 4v11" />
      <polyline points="7.5 11.5 12 16 16.5 11.5" />
      <path d="M4 20h16" />
    </SvgIcon>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 16V5" />
      <polyline points="7.5 9.5 12 5 16.5 9.5" />
      <path d="M4 20h16" />
    </SvgIcon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </SvgIcon>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </SvgIcon>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </SvgIcon>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </SvgIcon>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </SvgIcon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
    </SvgIcon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </SvgIcon>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </SvgIcon>
  );
}
