import { useTranslation } from 'react-i18next';

export function LoadingSpinner({
  size = 20,
  className = '',
  label,
}: {
  size?: number;
  className?: string;
  /** 读屏文案；默认 common.loading。 */
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`loading-spinner${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, borderWidth: size / 7 }}
      role="status"
      aria-live="polite"
      aria-label={label ?? t('common.loading')}
    />
  );
}
