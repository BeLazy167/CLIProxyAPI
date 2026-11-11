import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet';
type ButtonSize = 'md' | 'sm' | 'xs';
type ButtonShape = 'default' | 'pill';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `pill` 为页头/工具栏使用的药丸形（Quota 页语汇）。 */
  shape?: ButtonShape;
  /** 仅图标：等宽方形内边距；调用方必须传 aria-label。 */
  iconOnly?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, PropsWithChildren<ButtonProps>>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    shape = 'default',
    iconOnly = false,
    fullWidth = false,
    loading = false,
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  const hasChildren = children !== null && children !== undefined && children !== false;
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    shape === 'pill' ? 'btn-pill' : '',
    iconOnly ? 'btn-icon' : '',
    fullWidth ? 'btn-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="loading-spinner" aria-hidden="true" />}
      {hasChildren && <span>{children}</span>}
    </button>
  );
});
