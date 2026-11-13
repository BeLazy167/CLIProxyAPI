import type { CSSProperties, ReactNode } from 'react';
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
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
  ariaLabel?: string;
  /** Picking a suggestion runs this instead of filling the field; the typed text stays. */
  onSelect?: (value: string) => void;
  /** Draws a suggestion; by default its value, with its label under it when they differ. */
  renderOption?: (value: string) => ReactNode;
  /** The options already match the typed text, so the field does not filter them again. */
  prefiltered?: boolean;
  /** Shown when nothing matches; without it, an empty list stays hidden. */
  emptyText?: ReactNode;
  /** Whether focus alone opens the suggestions; on by default. */
  openOnFocus?: boolean;
  /** Hides the suggestions button, for a field that shows its own icon. */
  hideTrigger?: boolean;
  /** Highlights the first suggestion while typing, so Enter picks it. */
  autoHighlight?: boolean;
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
  ariaLabel,
  onSelect,
  renderOption,
  prefiltered = false,
  emptyText,
  openOnFocus = true,
  hideTrigger = false,
  autoHighlight = false,
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
        onValueChange={(next, details) => {
          if (onSelect && details.reason === 'item-press') {
            details.cancel();
            onSelect(next);
            return;
          }
          onChange(next);
        }}
        disabled={disabled}
        openOnFocus={openOnFocus}
        autoHighlight={autoHighlight}
        filter={prefiltered ? false : undefined}
      >
        <div className={styles.field}>
          <SdkAutocompleteInput
            id={id}
            className={`input ${styles.input} ${className}`.trim()}
            placeholder={placeholder}
            aria-label={ariaLabel}
          />
          <span className={styles.adornment}>
            {rightElement}
            {!hideTrigger && (
              <AutocompleteTrigger
                className={styles.trigger}
                tabIndex={-1}
                aria-label={placeholder || label}
              >
                <IconChevronDown size={16} />
              </AutocompleteTrigger>
            )}
          </span>
        </div>
        <AutocompleteContent className={styles.content} sideOffset={4} collisionPadding={8}>
          {emptyText !== undefined && (
            <AutocompleteEmpty className={styles.empty}>{emptyText}</AutocompleteEmpty>
          )}
          <AutocompleteList className={styles.list} aria-label={ariaLabel ?? label ?? placeholder}>
            {items.map((item) => (
              <AutocompleteItem
                key={item.value}
                value={item.value}
                label={item.value}
                keywords={[item.label]}
                className={styles.item}
              >
                {renderOption ? (
                  renderOption(item.value)
                ) : (
                  <>
                    <span className={styles.itemValue}>{item.value}</span>
                    {item.label !== item.value && (
                      <span className={styles.itemLabel}>{item.label}</span>
                    )}
                  </>
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
