import type { ReactNode } from 'react';
import {
  SegmentedControl as SdkSegmentedControl,
  SegmentedControlItem,
} from '@ui-sdk/react/segmented-control';
import styles from './SegmentedControl.module.scss';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  className?: string;
}

interface SegmentedControlProps<T extends string> {
  /** `null` checks nothing, as when free text matches no option. */
  value: T | null;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
}

/** One choice among a few, shown as a row of buttons. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  className,
  itemClassName,
}: SegmentedControlProps<T>) {
  return (
    <SdkSegmentedControl
      className={[styles.root, className].filter(Boolean).join(' ')}
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
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          onKeyDown={(event) => {
            // Radios check on Space and arrows; Enter keeps working as it did on the old buttons.
            if (event.key !== 'Enter' || disabled) return;
            event.preventDefault();
            onChange(option.value);
          }}
          className={[styles.item, itemClassName, option.className].filter(Boolean).join(' ')}
        >
          {option.label}
        </SegmentedControlItem>
      ))}
    </SdkSegmentedControl>
  );
}
