import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { IconChevronDown } from '@/components/ui/icons';
import styles from '../LogsPage.module.scss';

interface ToolbarPopoverProps {
  label: string;
  icon?: ReactNode;
  /** Small count shown after the label (active filters). */
  badge?: ReactNode;
  align?: 'start' | 'end';
  /** `menu` adds arrow-key navigation between the item buttons. */
  role?: 'dialog' | 'menu';
  disabled?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}

const MENU_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * Anchored toolbar popover: the page stays visible and results update live
 * while the user picks filters or view options.
 */
export function ToolbarPopover({
  label,
  icon,
  badge,
  align = 'start',
  role = 'dialog',
  disabled = false,
  children,
}: ToolbarPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    const first = rootRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(panelId)} button:not(:disabled), #${CSS.escape(panelId)} input:not(:disabled)`
    );
    first?.focus({ preventScroll: true });
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, panelId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Nested controls (Select) and the fullscreen handler both key off defaultPrevented.
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (role !== 'menu' || !MENU_KEYS.includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className={styles.popover} ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        shape="pill"
        disabled={disabled}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon}
        {label}
        {badge}
        <IconChevronDown size={13} aria-hidden="true" />
      </Button>
      {open && (
        <div
          id={panelId}
          role={role}
          aria-label={label}
          className={[styles.popoverPanel, align === 'end' ? styles.popoverEnd : '']
            .filter(Boolean)
            .join(' ')}
          onKeyDown={handleKeyDown}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
