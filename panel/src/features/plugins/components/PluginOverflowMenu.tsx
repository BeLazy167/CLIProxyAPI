import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from './PluginOverflowMenu.module.scss';

// Local copy of the Auth Files OverflowMenu (features do not import each other).

export type PluginMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

function useDismissable(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose, open, ref]);
}

function IconDots({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export type PluginOverflowMenuProps = {
  items: PluginMenuItem[];
  /** Accessible name of the trigger, e.g. "More actions for Usage Exporter". */
  label: string;
  disabled?: boolean;
  /** Custom trigger content (defaults to the three-dot glyph). */
  children?: ReactNode;
  className?: string;
};

export function PluginOverflowMenu({
  items,
  label,
  disabled = false,
  children,
  className,
}: PluginOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useDismissable(rootRef, open, () => setOpen(false));

  const triggerClass = [
    styles.trigger,
    children ? styles.triggerLabelled : '',
    open ? styles.triggerOpen : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? <IconDots />}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={styles.menu}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
              disabled={item.disabled || item.loading}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.loading && <LoadingSpinner size={12} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
