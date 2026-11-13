import type { ReactNode } from 'react';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import styles from './ToggleSwitch.module.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  labelPosition = 'right',
}: ToggleSwitchProps) {
  const className = [
    styles.root,
    labelPosition === 'left' ? styles.labelLeft : '',
    disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={className}>
      <Switch
        className={styles.track}
        checked={checked}
        onCheckedChange={(next) => onChange(next)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <SwitchThumb className={styles.thumb} />
      </Switch>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
