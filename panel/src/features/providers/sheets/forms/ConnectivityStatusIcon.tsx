import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconCheckCircle2, IconLoader2 } from '@/components/ui/icons';
import type { ConnectivityState } from './useConnectivityTest';
import styles from './sharedForm.module.scss';

export function ConnectivityStatusIcon({ state }: { state: ConnectivityState }) {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  const className =
    state === 'loading'
      ? styles.statusIconLoading
      : state === 'success'
        ? styles.statusIconSuccess
        : styles.statusIconError;
  const label =
    state === 'loading'
      ? t('providersPage.connectivity.stateLoading')
      : state === 'success'
        ? t('providersPage.connectivity.stateSuccess')
        : t('providersPage.connectivity.stateError');
  return (
    <span className={`${styles.statusIcon} ${className}`} role="img" aria-label={label}>
      {state === 'loading' ? (
        <IconLoader2 size={14} />
      ) : state === 'success' ? (
        <IconCheckCircle2 size={14} />
      ) : (
        <IconAlertTriangle size={14} />
      )}
    </span>
  );
}
