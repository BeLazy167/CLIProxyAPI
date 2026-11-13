import type { KeyboardEventHandler, ReactNode } from 'react';
import { Listbox as SdkListbox, ListboxItem } from '@ui-sdk/react/listbox';

export interface ListboxOption {
  value: string;
  content: ReactNode;
  /** The text typing finds, when the content is not plain text. */
  label?: string;
  disabled?: boolean;
  className?: string;
}

export interface ListboxChange {
  value: string;
  selected: boolean;
}

interface ListboxProps {
  options: ReadonlyArray<ListboxOption>;
  /** The selected values among `options`. */
  value: readonly string[];
  /** Every option whose state changed in one gesture: a press, Space, a Shift range or Ctrl+A. */
  onChange: (changes: ListboxChange[]) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

/** An always-visible list where each option toggles on its own, like a checklist. */
export function Listbox({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  id,
  onKeyDown,
}: ListboxProps) {
  return (
    <SdkListbox
      multiple
      activation="manual"
      id={id}
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      value={[...value]}
      onValueChange={(next) => {
        const selected = new Set(Array.isArray(next) ? next : []);
        const changes = options
          .filter((option) => value.includes(option.value) !== selected.has(option.value))
          .map((option) => ({ value: option.value, selected: selected.has(option.value) }));
        if (changes.length > 0) onChange(changes);
      }}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <ListboxItem
          key={option.value}
          value={option.value}
          label={option.label}
          disabled={option.disabled}
          className={option.className}
        >
          {option.content}
        </ListboxItem>
      ))}
    </SdkListbox>
  );
}
