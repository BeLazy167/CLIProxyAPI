import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** 渲染在标签正下方的小字行（如赞助跳转链接）。 */
  labelExtra?: ReactNode;
  /** 渲染在标签上方的占位行（用于与同排带 labelExtra 的字段保持输入框对齐）。 */
  topExtra?: ReactNode;
  hint?: ReactNode;
  error?: string;
  rightElement?: ReactNode;
}

export function Input({
  label,
  labelExtra,
  topExtra,
  hint,
  error,
  rightElement,
  className = '',
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  // 调用方自带的 describedby 与 hint/error id 合并，而不是互相覆盖
  const describedBy = [ariaDescribedBy, errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="form-group">
      {topExtra}
      {label && <label htmlFor={inputId}>{label}</label>}
      {labelExtra}
      <div className="input-wrap">
        <input
          {...rest}
          id={inputId}
          className={`input ${className}`.trim()}
          aria-invalid={Boolean(error) || ariaInvalid}
          aria-describedby={describedBy}
        />
        {rightElement && <div className="input-right">{rightElement}</div>}
      </div>
      {hint && (
        <div id={hintId} className="hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="error-box" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
