import { forwardRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconChevronLeft } from '@/components/ui/icons';
import styles from './SecondaryScreenShell.module.scss';

export type SecondaryScreenShellProps = {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  backAriaLabel?: string;
  rightAction?: ReactNode;
  isLoading?: boolean;
  loadingLabel?: ReactNode;
  className?: string;
  contentClassName?: string;
  topBarClassName?: string;
  children?: ReactNode;
};

export const SecondaryScreenShell = forwardRef<HTMLDivElement, SecondaryScreenShellProps>(
  function SecondaryScreenShell(
    {
      title,
      onBack,
      backLabel,
      backAriaLabel,
      rightAction,
      isLoading = false,
      loadingLabel,
      className = '',
      contentClassName = '',
      topBarClassName = '',
      children,
    },
    ref
  ) {
    const { t } = useTranslation();
    const resolvedBackLabel = backLabel ?? t('common.back');
    const resolvedLoadingLabel = loadingLabel ?? t('common.loading');
    const containerClassName = [styles.container, className].filter(Boolean).join(' ');
    const contentClasses = [styles.content, contentClassName].filter(Boolean).join(' ');
    const titleTooltip = typeof title === 'string' ? title : undefined;
    const resolvedBackAriaLabel = backAriaLabel ?? resolvedBackLabel;

    return (
      <div className={containerClassName} ref={ref}>
        <div className={[styles.topBar, topBarClassName].filter(Boolean).join(' ')}>
          {onBack ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className={styles.backButton}
              aria-label={resolvedBackAriaLabel}
            >
              <span className={styles.backIcon}>
                <IconChevronLeft size={18} />
              </span>
              <span className={styles.backText}>{resolvedBackLabel}</span>
            </Button>
          ) : (
            <div />
          )}
          <div className={styles.topBarTitle} title={titleTooltip}>
            {title}
          </div>
          <div className={styles.rightSlot}>{rightAction}</div>
        </div>

        {isLoading ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={16} />
            <span>{resolvedLoadingLabel}</span>
          </div>
        ) : (
          <div className={contentClasses}>{children}</div>
        )}
      </div>
    );
  }
);
