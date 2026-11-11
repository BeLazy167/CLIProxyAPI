import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconX } from '../icons';
import styles from './SearchField.module.scss';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 必填：无可见 label 时的读屏名称。 */
  ariaLabel: string;
  clearLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Escape 清空（默认开启）。 */
  clearOnEscape?: boolean;
}

/**
 * 工具栏搜索框（Quota 页语汇）：36px、透明边、前置放大镜、后置清除。
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    value,
    onChange,
    placeholder,
    ariaLabel,
    clearLabel,
    className,
    disabled = false,
    clearOnEscape = true,
  },
  ref
) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const clearText = clearLabel ?? t('common.clear_search');

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (clearOnEscape && event.key === 'Escape' && value) {
      event.preventDefault();
      onChange('');
    }
  };

  return (
    <div className={[styles.search, className].filter(Boolean).join(' ')}>
      <IconSearch size={16} className={styles.icon} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      {value && !disabled && (
        <button
          type="button"
          className={styles.clear}
          aria-label={clearText}
          title={clearText}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
