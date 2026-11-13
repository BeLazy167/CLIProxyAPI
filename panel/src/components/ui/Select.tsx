import type { AriaAttributes } from 'react';
import {
  Select as SdkSelect,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from '@ui-sdk/react/select';
import { IconCheck, IconChevronDown } from './icons';
import styles from './Select.module.scss';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: AriaAttributes['aria-invalid'];
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  variant?: 'default' | 'quiet';
  id?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  className,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaInvalid,
  fullWidth = true,
  size = 'md',
  variant = 'default',
  id,
}: SelectProps) {
  const known = options.some((option) => option.value === value);
  const triggerClass = [
    styles.trigger,
    size === 'sm' ? styles.triggerSm : '',
    variant === 'quiet' ? styles.triggerQuiet : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={[styles.wrap, fullWidth ? styles.wrapFullWidth : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <SdkSelect<string>
        items={options as SelectOption[]}
        value={known ? value : null}
        onValueChange={(next) => {
          if (typeof next === 'string') onChange(next);
        }}
        placeholder={placeholder}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={triggerClass}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
        >
          <SelectValue className={styles.triggerText} />
          <span className={styles.triggerIcon} aria-hidden="true">
            <IconChevronDown size={14} />
          </span>
        </SelectTrigger>
        <SelectContent
          className={styles.dropdown}
          sideOffset={6}
          collisionPadding={8}
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className={styles.option}>
              {option.label}
              <SelectItemIndicator className={styles.check}>
                <IconCheck size={14} />
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectContent>
      </SdkSelect>
    </div>
  );
}
