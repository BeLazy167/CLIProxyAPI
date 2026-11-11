import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import type { OAuthConfigLoadError } from '@/features/authFiles/constants';
import styles from './OAuthConfigPanels.module.scss';

const PREVIEW_MODELS = 3;

export type OAuthExcludedCardProps = {
  disableControls: boolean;
  excludedError: OAuthConfigLoadError;
  excluded: Record<string, string[]>;
  onRetry: () => void | Promise<void>;
  onAdd: () => void;
  onEdit: (provider: string) => void;
  onDelete: (provider: string) => void;
};

export function OAuthExcludedCard(props: OAuthExcludedCardProps) {
  const { t } = useTranslation();
  const { disableControls, excludedError, excluded, onRetry, onAdd, onEdit, onDelete } = props;

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <h3 className={styles.panelTitle}>{t('oauth_excluded.title')}</h3>
        <div className={styles.panelExtra}>
          <Button size="sm" onClick={onAdd} disabled={disableControls || excludedError !== null}>
            {t('auth_files.add_excluded_button')}
          </Button>
        </div>
      </header>
      <div className={styles.panelBody}>
        {excludedError === 'unsupported' ? (
          <EmptyState
            title={t('oauth_excluded.upgrade_required_title')}
            description={t('oauth_excluded.upgrade_required_desc')}
          />
        ) : excludedError === 'load' ? (
          <ErrorBanner message={t('notification.refresh_failed')} onRetry={() => void onRetry()} />
        ) : excludedError === 'loading' ? (
          <div className={styles.list} aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} height={48} rounded={10} />
            ))}
          </div>
        ) : Object.keys(excluded).length === 0 ? (
          <EmptyState title={t('oauth_excluded.list_empty_all')} />
        ) : (
          <div className={styles.list}>
            {Object.entries(excluded).map(([provider, models]) => {
              const preview = (models ?? []).slice(0, PREVIEW_MODELS);
              const more = (models?.length ?? 0) - preview.length;
              return (
                <div key={provider} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <div className={styles.itemProvider}>{provider}</div>
                    <div className={styles.itemCount}>
                      {models?.length
                        ? t('oauth_excluded.model_count', { count: models.length })
                        : t('oauth_excluded.no_models')}
                    </div>
                    {preview.length > 0 && (
                      <div className={styles.itemPreview} title={(models ?? []).join(', ')}>
                        {preview.join(', ')}
                        {more > 0 && ` · ${t('auth_files.more_count', { count: more })}`}
                      </div>
                    )}
                  </div>
                  <div className={styles.itemActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onEdit(provider)}
                      aria-label={`${t('common.edit')}: ${provider}`}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="danger-quiet"
                      size="sm"
                      onClick={() => onDelete(provider)}
                      aria-label={`${t('oauth_excluded.delete')}: ${provider}`}
                    >
                      {t('oauth_excluded.delete')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
