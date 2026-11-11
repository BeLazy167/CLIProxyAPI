import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { IconAlertTriangle, IconRefreshCw } from './icons';

export interface ErrorBannerProps {
  /** 错误正文；为空时不渲染。 */
  message?: ReactNode;
  /** 提供则显示「重试」。 */
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  /** `warning` 用于降级/部分失败（琥珀），默认 `danger`。 */
  tone?: 'danger' | 'warning';
  className?: string;
}

/**
 * 页面级加载失败横幅：role=alert，长文案可换行，右侧可带重试。
 * 规则：加载失败用横幅；动作结果用 toast。
 */
export function ErrorBanner({
  message,
  onRetry,
  retryLabel,
  retrying = false,
  tone = 'danger',
  className,
}: ErrorBannerProps) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div
      className={['error-banner', tone === 'warning' ? 'error-banner-warning' : '', className]
        .filter(Boolean)
        .join(' ')}
      role="alert"
    >
      <IconAlertTriangle size={16} className="error-banner-icon" aria-hidden="true" />
      <div className="error-banner-message">{message}</div>
      {onRetry && (
        <Button
          variant="secondary"
          size="xs"
          shape="pill"
          onClick={onRetry}
          loading={retrying}
          className="error-banner-retry"
        >
          {!retrying && <IconRefreshCw size={13} aria-hidden="true" />}
          {retryLabel ?? t('common.retry')}
        </Button>
      )}
    </div>
  );
}
