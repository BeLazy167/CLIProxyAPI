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

interface ListboxProps {
  options: ReadonlyArray<ListboxOption>;
  /** The selected values among `options`. */
  value: readonly string[];
  /** One option was pressed, or chosen with Space or Enter. */
  onToggle: (value: string, selected: boolean) => void;
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
  onToggle,
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
        for (const option of options) {
          const was = value.includes(option.value);
          if (was !== selected.has(option.value)) onToggle(option.value, !was);
        }
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
