import type { CSSProperties, ReactNode } from 'react';
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput as SdkAutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from '@ui-sdk/react/autocomplete';
import { IconChevronDown } from './icons';
import styles from './AutocompleteInput.module.scss';

interface AutocompleteInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label?: string }[];
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
  id?: string;
  rightElement?: ReactNode;
}

/** Free text with suggestions: whatever is typed stays, through blur and Escape. */
export function AutocompleteInput({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hint,
  error,
  className = '',
  wrapperClassName = '',
  wrapperStyle,
  id,
  rightElement,
}: AutocompleteInputProps) {
  const items = options.map((opt) =>
    typeof opt === 'string'
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label || opt.value }
  );

  return (
    <div className={`form-group ${wrapperClassName}`} style={wrapperStyle}>
      {label && <label htmlFor={id}>{label}</label>}
      <Autocomplete
        value={value}
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
        openOnFocus
      >
        <div className={styles.field}>
          <SdkAutocompleteInput
            id={id}
            className={`input ${styles.input} ${className}`.trim()}
            placeholder={placeholder}
          />
          <span className={styles.adornment}>
            {rightElement}
            <AutocompleteTrigger
              className={styles.trigger}
              tabIndex={-1}
              aria-label={placeholder || label}
            >
              <IconChevronDown size={16} />
            </AutocompleteTrigger>
          </span>
        </div>
        <AutocompleteContent className={styles.content} sideOffset={4} collisionPadding={8}>
          <AutocompleteList className={styles.list}>
            {items.map((item) => (
              <AutocompleteItem
                key={item.value}
                value={item.value}
                label={item.value}
                keywords={[item.label]}
                className={styles.item}
              >
                <span className={styles.itemValue}>{item.value}</span>
                {item.label !== item.value && (
                  <span className={styles.itemLabel}>{item.label}</span>
                )}
              </AutocompleteItem>
            ))}
          </AutocompleteList>
        </AutocompleteContent>
      </Autocomplete>
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
