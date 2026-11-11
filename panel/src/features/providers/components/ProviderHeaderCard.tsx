import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { IconLoader2, IconPlus, IconRefreshCw } from '@/components/ui/icons';
import styles from './ProviderHeaderCard.module.scss';

interface ProviderHeaderCardProps {
  title?: string;
  totalActive: number;
  totalResources: number;
  /** 需要关注的条目数(已禁用或近期有失败) */
  totalAttention?: number;
  updatedAtLabel: string;
  isFetching?: boolean;
  isNewDisabled?: boolean;
  showNewAction?: boolean;
  showSummary?: boolean;
  newLabel?: string;
  variant?: 'quickStart';
  onRefresh: () => void;
  onNew: () => void;
}

export function ProviderHeaderCard({
  title,
  totalActive,
  totalResources,
  totalAttention = 0,
  updatedAtLabel,
  isFetching = false,
  isNewDisabled = false,
  showNewAction = true,
  showSummary = true,
  newLabel,
  variant,
  onRefresh,
  onNew,
}: ProviderHeaderCardProps) {
  const { t } = useTranslation();

  // Quick Start 保持 Phase 2 的稳定 h1 与卡片结构,不走 PageHeader。
  if (variant === 'quickStart') {
    return (
      <section className={`${styles.card} ${styles.quickStartCard}`}>
        <div className={styles.row}>
          <div className={styles.titleArea}>
            <h1 className={styles.title}>{title ?? t('providersPage.header.title')}</h1>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnOutline}`}
              onClick={onRefresh}
              disabled={isFetching}
              aria-label={
                isFetching ? t('providersPage.actions.syncing') : t('providersPage.actions.refresh')
              }
            >
              <span className={`${styles.btnIcon} ${isFetching ? styles.spin : ''}`.trim()}>
                {isFetching ? <IconLoader2 size={16} /> : <IconRefreshCw size={16} />}
              </span>
              <span>
                {isFetching
                  ? t('providersPage.actions.syncing')
                  : t('providersPage.actions.refresh')}
              </span>
            </button>
            {showNewAction ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onNew}
                disabled={isNewDisabled}
              >
                <IconPlus size={16} />
                <span>{newLabel ?? t('providersPage.actions.new')}</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const meta: PageHeaderMetaSegment[] = showSummary
    ? [
        {
          key: 'entries',
          text: t('providersPage.header.entries', { count: totalResources }),
        },
        {
          key: 'active',
          text: t('providersPage.header.active', { count: totalActive }),
          tone: totalResources > 0 && totalActive === 0 ? 'warning' : 'ok',
        },
        {
          key: 'attention',
          text: t('providersPage.header.attention', { count: totalAttention }),
          tone: totalAttention > 0 ? 'attention' : 'quiet',
        },
      ]
    : [];

  return (
    <PageHeader
      title={title ?? t('providersPage.header.title')}
      meta={meta}
      actions={
        <>
          <Button
            variant="secondary"
            shape="pill"
            size="sm"
            onClick={onRefresh}
            disabled={isFetching}
            loading={isFetching}
            title={t('providersPage.header.updatedAt', { time: updatedAtLabel })}
            aria-label={
              isFetching ? t('providersPage.actions.syncing') : t('providersPage.actions.refresh')
            }
          >
            {!isFetching ? <IconRefreshCw size={14} aria-hidden="true" /> : null}
            {isFetching ? t('providersPage.actions.syncing') : t('providersPage.actions.refresh')}
          </Button>
          {showNewAction ? (
            <Button
              variant="primary"
              shape="pill"
              size="sm"
              onClick={onNew}
              disabled={isNewDisabled}
            >
              <IconPlus size={14} aria-hidden="true" />
              {newLabel ?? t('providersPage.actions.new')}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
