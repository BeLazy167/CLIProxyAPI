import type { ReactNode } from 'react';
import { Popover } from '@/components/ui/Popover';
import { IconChevronDown } from '@/components/ui/icons';
import styles from '../LogsPage.module.scss';

interface ToolbarPopoverProps {
  label: string;
  icon?: ReactNode;
  /** Small count shown after the label (active filters). */
  badge?: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * Anchored toolbar popover: the page stays visible and results update live
 * while the user picks filters or view options.
 */
export function ToolbarPopover({
  label,
  icon,
  badge,
  align = 'start',
  disabled = false,
  children,
}: ToolbarPopoverProps) {
  return (
    <Popover
      label={label}
      align={align}
      disabled={disabled}
      triggerClassName="btn btn-secondary btn-sm btn-pill"
      className={styles.popoverPanel}
      trigger={
        <>
          {icon}
          {label}
          {badge}
          <IconChevronDown size={13} aria-hidden="true" />
        </>
      }
    >
      {children}
    </Popover>
  );
}
