import type { ReactNode } from 'react';
import { Menu } from '@/components/ui/Menu';
import styles from './PluginOverflowMenu.module.scss';

export type PluginMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

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
  const triggerClass = [styles.trigger, children ? styles.triggerLabelled : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Menu
      label={label}
      trigger={children ?? <IconDots />}
      triggerClassName={triggerClass}
      disabled={disabled}
      items={items}
    />
  );
}
