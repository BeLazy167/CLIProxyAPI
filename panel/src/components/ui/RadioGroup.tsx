import type { ReactNode } from 'react';
import { Radio, RadioGroup as SdkRadioGroup, RadioIndicator } from '@ui-sdk/react/radio';
import styles from './RadioGroup.module.scss';

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface RadioGroupProps<T extends string> {
  value: T | null;
  options: ReadonlyArray<RadioOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  className?: string;
  /** Class for each option's label; style the checked one with `:has([data-checked])`. */
  optionClassName?: string;
}

export function RadioGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  className,
  optionClassName,
}: RadioGroupProps<T>) {
  return (
    <SdkRadioGroup
      className={className}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onChange(option.value);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={[styles.option, optionClassName].filter(Boolean).join(' ')}
        >
          <Radio value={option.value} className={styles.radio}>
            <RadioIndicator className={styles.indicator} />
          </Radio>
          {option.label}
        </label>
      ))}
    </SdkRadioGroup>
  );
}
