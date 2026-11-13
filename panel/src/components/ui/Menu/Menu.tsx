import type { ReactNode } from 'react';
import {
  Menu as SdkMenu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@ui-sdk/react/menu';
import { LoadingSpinner } from '../LoadingSpinner';
import styles from './Menu.module.scss';

export type MenuEntry =
  | {
      type?: 'item';
      key: string;
      label: ReactNode;
      onSelect: () => void;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      loading?: boolean;
    }
  | { type: 'separator'; key: string };

interface MenuProps {
  /** Names the trigger and the menu. */
  label: string;
  /** Trigger content, such as an icon. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Shown on hover over the trigger; defaults to `label`. */
  triggerTitle?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
  contentClassName?: string;
  /** Action items. */
  items?: MenuEntry[];
  /** A single-choice menu instead: one checked option among `options`. */
  value?: string;
  options?: { value: string; label: ReactNode; textValue?: string; className?: string }[];
  onValueChange?: (value: string) => void;
}

export function Menu({
  label,
  trigger,
  triggerClassName,
  triggerTitle,
  disabled = false,
  align = 'end',
  contentClassName,
  items = [],
  value,
  options,
  onValueChange,
}: MenuProps) {
  return (
    <SdkMenu>
      <MenuTrigger
        className={triggerClassName}
        aria-label={label}
        title={triggerTitle ?? label}
        disabled={disabled}
      >
        {trigger}
      </MenuTrigger>
      <MenuContent
        className={[styles.content, contentClassName].filter(Boolean).join(' ')}
        aria-label={label}
        align={align}
        sideOffset={4}
        collisionPadding={8}
      >
        {options ? (
          <MenuRadioGroup value={value ?? null} onValueChange={(next) => onValueChange?.(next)}>
            {options.map((option) => (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                label={option.textValue}
                className={[styles.item, option.className].filter(Boolean).join(' ')}
              >
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        ) : (
          items.map((item) =>
            item.type === 'separator' ? (
              <MenuSeparator key={item.key} className={styles.separator} />
            ) : (
              <MenuItem
                key={item.key}
                className={styles.item}
                data-danger={item.danger || undefined}
                disabled={item.disabled || item.loading}
                onSelect={() => {
                  item.onSelect();
                }}
              >
                {item.loading ? <LoadingSpinner size={12} /> : item.icon}
                <span>{item.label}</span>
              </MenuItem>
            )
          )
        )}
      </MenuContent>
    </SdkMenu>
  );
}
