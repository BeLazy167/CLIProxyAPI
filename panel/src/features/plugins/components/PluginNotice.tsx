import type { PropsWithChildren, ReactNode } from 'react';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import styles from './PluginNotice.module.scss';

interface PluginNoticeProps {
  tone?: 'warning' | 'info';
  /** Right-aligned action (Dismiss, Details, ...). */
  action?: ReactNode;
  className?: string;
}

/** Persistent, non-error notice (role=status). Load failures use ErrorBanner instead. */
export function PluginNotice({
  tone = 'warning',
  action,
  className,
  children,
}: PropsWithChildren<PluginNoticeProps>) {
  const Icon = tone === 'info' ? IconInfo : IconAlertTriangle;
  return (
    <div
      className={[styles.notice, tone === 'info' ? styles.info : styles.warning, className]
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      <Icon size={16} className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>{children}</div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
