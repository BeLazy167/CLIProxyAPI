import type { ReactNode } from 'react';
import { Checkbox, CheckboxIndicator } from '@ui-sdk/react/checkbox';
import { IconCheck } from './icons';
import styles from './SelectionCheckbox.module.scss';

interface SelectionCheckboxProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}

export function SelectionCheckbox({
  checked,
  onChange,
  label,
  ariaLabel,
  title,
  disabled = false,
  className,
  labelClassName,
}: SelectionCheckboxProps) {
  const rootClassName = [styles.root, disabled ? styles.disabled : '', className]
    .filter(Boolean)
    .join(' ');
  const textClassName = [styles.label, labelClassName].filter(Boolean).join(' ');

  return (
    <label className={rootClassName} title={title}>
      <Checkbox
        className={styles.box}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <CheckboxIndicator className={styles.indicator}>
          <IconCheck size={12} />
        </CheckboxIndicator>
      </Checkbox>
      {label ? <div className={textClassName}>{label}</div> : null}
    </label>
  );
}
