import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { SearchField } from '@/components/ui/SearchField/SearchField';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { IconDownload, IconEye, IconRefreshCw } from '@/components/ui/icons';
import type { ErrorLogFile } from '@/services/api/logs';
import { formatFileSize, formatUnixTimestamp } from '@/utils/format';
import {
  extractRequestIdFromFileName,
  filterErrorLogFiles,
  sortErrorLogFilesNewestFirst,
  summarizeErrorLogFiles,
} from '../model/errorLogLedger';
import styles from './ErrorLogLedger.module.scss';

interface ErrorLogLedgerProps {
  files: ErrorLogFile[];
  loading: boolean;
  error: string;
  requestLogEnabled: boolean;
  disconnected: boolean;
  /** Name of the file whose download is in flight (per-row busy state). */
  downloadingName: string | null;
  onRefresh: () => void;
  onReconnect: () => void;
  onOpen: (file: ErrorLogFile) => void;
  onDownload: (file: ErrorLogFile) => void;
}

/** Request error log files as a newest-first ledger with one explanatory state at a time. */
export function ErrorLogLedger({
  files,
  loading,
  error,
  requestLogEnabled,
  disconnected,
  downloadingName,
  onRefresh,
  onReconnect,
  onOpen,
  onDownload,
}: ErrorLogLedgerProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const sorted = useMemo(() => sortErrorLogFilesNewestFirst(files), [files]);
  const visible = useMemo(() => filterErrorLogFiles(sorted, query), [sorted, query]);
  const summary = summarizeErrorLogFiles(files);

  let body;
  if (disconnected) {
    body = (
      <EmptyState
        title={t('logs.not_connected_title')}
        description={t('logs.not_connected_desc')}
        action={
          <Button variant="secondary" size="sm" shape="pill" onClick={onReconnect}>
            {t('common.login')}
          </Button>
        }
      />
    );
  } else if (loading && files.length === 0) {
    body = (
      <div className={styles.skeletons} aria-busy="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} height={18} />
        ))}
      </div>
    );
  } else if (error) {
    body = <ErrorBanner message={error} onRetry={onRefresh} retrying={loading} />;
  } else if (files.length === 0) {
    body = (
      <EmptyState
        title={t('logs.error_logs_empty')}
        description={t(
          requestLogEnabled ? 'logs.error_logs_request_log_enabled' : 'logs.error_logs_description'
        )}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        title={t('logs.error_logs_search_empty')}
        action={
          <Button variant="secondary" size="sm" shape="pill" onClick={() => setQuery('')}>
            {t('common.clear_search')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className={styles.table}>
        <div className={styles.head} aria-hidden="true">
          <span>{t('logs.error_logs_modified')}</span>
          <span>{t('logs.error_logs_col_request')}</span>
          <span className={styles.size}>{t('logs.error_logs_size')}</span>
          <span>{t('logs.error_logs_col_file')}</span>
          <span />
        </div>
        <ul className={styles.rows}>
          {visible.map((file) => {
            const requestId = extractRequestIdFromFileName(file.name);
            const busy = downloadingName === file.name;
            return (
              <li key={file.name} className={styles.row}>
                <span className={styles.modified}>
                  {file.modified ? formatUnixTimestamp(file.modified, i18n.language) : '—'}
                </span>
                <span className={styles.requestId}>{requestId ?? '—'}</span>
                <span className={styles.size}>
                  {typeof file.size === 'number' ? formatFileSize(file.size) : '—'}
                </span>
                <span className={styles.file} title={file.name}>
                  {file.name}
                </span>
                <span className={styles.actions}>
                  <Button variant="ghost" size="xs" shape="pill" onClick={() => onOpen(file)}>
                    <IconEye size={13} aria-hidden="true" />
                    {t('logs.error_logs_open')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    shape="pill"
                    loading={busy}
                    onClick={() => onDownload(file)}
                  >
                    {!busy && <IconDownload size={13} aria-hidden="true" />}
                    {t('logs.error_logs_download')}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.ledger}>
      <div className={styles.toolbar}>
        <p className={styles.meta}>
          <span>{t('logs.error_logs_count', { count: summary.count })}</span>
          {summary.count > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>{formatFileSize(summary.totalSize)}</span>
            </>
          )}
          {summary.newest && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>
                {t('logs.error_logs_newest', {
                  time: formatUnixTimestamp(summary.newest, i18n.language),
                })}
              </span>
            </>
          )}
        </p>
        <div className={styles.controls}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('logs.error_logs_search_placeholder')}
            ariaLabel={t('logs.error_logs_search_placeholder')}
            disabled={disconnected || files.length === 0}
          />
          <Button
            variant="secondary"
            size="sm"
            shape="pill"
            onClick={onRefresh}
            loading={loading && files.length > 0}
            disabled={disconnected}
          >
            {!(loading && files.length > 0) && <IconRefreshCw size={14} aria-hidden="true" />}
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
}
