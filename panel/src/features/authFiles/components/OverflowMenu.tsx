import { Menu } from '@/components/ui/Menu';
import styles from './OverflowMenu.module.scss';

export type OverflowMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

/** Three-dot glyph; the shared icon set has no "more" icon. */
export function IconDots({ size = 15 }: { size?: number }) {
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

export type OverflowMenuProps = {
  items: OverflowMenuItem[];
  /** Accessible name of the trigger, e.g. "More actions for claude-a@…". */
  label: string;
  disabled?: boolean;
  /** `bordered` matches secondary buttons; `quiet` is a bare icon for dense rows. */
  appearance?: 'bordered' | 'quiet';
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * "..." trigger with a text-labelled menu. Items run on click and close the menu;
 * the caller owns confirmation and loading state.
 */
export function OverflowMenu({
  items,
  label,
  disabled = false,
  appearance = 'bordered',
  align = 'right',
  size = 'sm',
  className,
}: OverflowMenuProps) {
  const triggerClass = [
    styles.trigger,
    appearance === 'quiet' ? styles.triggerQuiet : '',
    size === 'md' ? styles.triggerMd : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Menu
      label={label}
      trigger={<IconDots />}
      triggerClassName={triggerClass}
      disabled={disabled}
      align={align === 'left' ? 'start' : 'end'}
      items={items}
    />
  );
}
