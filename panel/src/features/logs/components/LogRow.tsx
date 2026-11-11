import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconCopy, IconFileText } from '@/components/ui/icons';
import { isRequestLogLine, splitLogTimestamp, splitSearchMatches } from '../model/logDisplay';
import type { LogEntry } from '../model/logSelectors';
import styles from '../LogsPage.module.scss';

interface LogRowProps {
  line: LogEntry;
  /** Current search term, highlighted inside path and message text. */
  needle: string;
  onCopyLine: (raw: string) => void;
  onFilterRequestId: (id: string) => void;
  onOpenRequestLog: (id: string) => void;
  onCopyRequestId: (id: string) => void;
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  return (
    <>
      {splitSearchMatches(text, needle).map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.hit}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

const statusToneClass = (status: number) =>
  status >= 500
    ? styles.status5xx
    : status >= 400
      ? styles.status4xx
      : status >= 300
        ? styles.status3xx
        : styles.status2xx;

/**
 * One parsed line on a shared column grid: time | level | status | method | path | latency |
 * request id | actions. Application lines without a request span the request columns.
 */
export function LogRow({
  line,
  needle,
  onCopyLine,
  onFilterRequestId,
  onOpenRequestLog,
  onCopyRequestId,
}: LogRowProps) {
  const { t } = useTranslation();
  const { time } = splitLogTimestamp(line.timestamp);
  const request = isRequestLogLine(line);
  const status = line.statusCode;
  const serverError = typeof status === 'number' && status >= 500;
  const clientError = typeof status === 'number' && status >= 400 && status < 500;
  const isError = serverError || line.level === 'error' || line.level === 'fatal';
  const isWarn = !isError && (clientError || line.level === 'warn');
  const detail = [line.source, line.ip].filter(Boolean).join(' · ') || undefined;

  const rowClass = [styles.logRow, isError ? styles.rowError : '', isWarn ? styles.rowWarn : '']
    .filter(Boolean)
    .join(' ');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onCopyLine(line.raw);
    }
  };

  let level = null;
  if (line.level === 'warn' || line.level === 'error' || line.level === 'fatal') {
    level = (
      <span
        className={`${styles.levelBadge} ${line.level === 'warn' ? styles.levelWarn : styles.levelError}`}
      >
        {line.level.toUpperCase()}
      </span>
    );
  } else if (line.level === 'debug' || line.level === 'trace') {
    level = <span className={styles.levelDim}>{line.level.toUpperCase()}</span>;
  }

  return (
    <div className={rowClass} data-log-id={line.id} tabIndex={0} onKeyDown={handleKeyDown}>
      <span className={styles.cellTime} title={line.timestamp}>
        {time}
      </span>
      <span className={styles.cellLevel}>
        {level}
        {(isError || isWarn) && (
          <span className={styles.srOnly}>
            {t(isError ? 'logs.severity_error' : 'logs.severity_warning')}
          </span>
        )}
      </span>
      {request ? (
        <>
          <span
            className={[
              styles.cellStatus,
              typeof status === 'number' ? statusToneClass(status) : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {status ?? ''}
          </span>
          <span className={styles.cellMethod}>{line.method ?? ''}</span>
          <span className={styles.cellPath} title={detail}>
            <Highlight text={line.path ?? ''} needle={needle} />
            {line.message && (
              <span className={styles.inlineMessage}>
                {' '}
                <Highlight text={line.message} needle={needle} />
              </span>
            )}
          </span>
          <span className={styles.cellLatency}>{line.latency ?? ''}</span>
        </>
      ) : (
        <span className={styles.cellMessage} title={detail}>
          <Highlight text={line.message || line.raw} needle={needle} />
        </span>
      )}
      <span className={styles.cellRequest}>
        {line.requestId && (
          <span className={styles.requestId}>
            <button
              type="button"
              className={styles.requestIdChip}
              onClick={() => onFilterRequestId(line.requestId!)}
              title={t('logs.filter_request_id', { id: line.requestId })}
              aria-label={t('logs.filter_request_id', { id: line.requestId })}
            >
              <Highlight text={line.requestId} needle={needle} />
            </button>
            <button
              type="button"
              className={styles.requestIdAction}
              onClick={() => onOpenRequestLog(line.requestId!)}
              title={t('logs.view_request', { id: line.requestId })}
              aria-label={t('logs.view_request', { id: line.requestId })}
            >
              <IconFileText size={12} />
            </button>
            <button
              type="button"
              className={styles.requestIdAction}
              onClick={() => onCopyRequestId(line.requestId!)}
              title={t('logs.copy_request_id')}
              aria-label={t('logs.copy_request_id')}
            >
              <IconCopy size={12} />
            </button>
          </span>
        )}
      </span>
      <span className={styles.cellActions}>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          className={styles.copyButton}
          title={t('logs.copy_line')}
          aria-label={t('logs.copy_line')}
          onClick={() => onCopyLine(line.raw)}
        >
          <IconCopy size={13} />
        </Button>
      </span>
    </div>
  );
}
