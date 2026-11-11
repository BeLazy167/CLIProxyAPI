/**
 * Ledger view: one row per account, grouped by provider, under a column header.
 *
 * Each provider group shares one column set (every window identity any of its
 * rows reports), so the same limit lines up down the group, and an account that
 * lacks a limit shows an explicit "not reported" cell instead of shifting its
 * other windows left. The group header repeats the pool summary. Claude rows
 * add a Resets column with one spend button per reset group.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconAlertTriangle, IconRefreshCw, IconZap } from '@/components/ui/icons';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { formatInstantShort, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { MINUTE_MS } from '@/utils/time/durations';
import { formatCountdown } from '../compactDuration';
import { QUOTA_TAB_ORDER } from '../constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { resolveQuotaPlanLabel } from '../planLabels';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ClaudeResetGroups } from '../providers/claude/ClaudeResetGroups';
import { ledgerColumns, type ProviderPool } from '../quotaPool';
import {
  formatQuotaWindowLabel,
  normalizeQuotaWindows,
  type NormalizedQuotaWindow,
  type QuotaWindowLabel,
} from '../quotaWindows';
import { remainingTone } from './quotaTone';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  displayNameFor: (name: string) => string;
  resolvedTheme: ResolvedTheme;
  now: number;
  /** Provider pools; they order the columns and supply each group's summary. */
  pools: readonly ProviderPool[];
  canRefresh: (entry: QuotaFileEntry) => boolean;
  resettingKey: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
}

type Column = { key: string; label: QuotaWindowLabel };

/** Skeleton cells drawn while a row with no known columns is loading. */
const LOADING_PLACEHOLDER_CELLS = 3;

function resetText(
  t: TFunction,
  window: NormalizedQuotaWindow,
  now: number
): { text: string; title?: string; tone: 'normal' | 'muted' | 'stale' } | null {
  if (window.resetAtMs === null) {
    // A full window with nothing scheduled is a fact worth stating; a depleted
    // or unknown one without a reset instant simply wasn't reported.
    return window.remainingPercent !== null && window.remainingPercent >= 100
      ? { text: t('quota_management.ledger_no_reset'), tone: 'muted' }
      : null;
  }
  if (window.resetAtMs <= now) {
    return { text: t('quota_management.ledger_reset_passed'), tone: 'stale' };
  }
  return {
    text: t('quota_management.ledger_resets_in', {
      time: formatCountdown(t, window.resetAtMs - now),
    }),
    title: formatInstantShort(window.resetAtMs),
    tone: 'normal',
  };
}

const RESET_TONE_CLASS = {
  normal: styles.cellReset,
  muted: `${styles.cellReset} ${styles.cellResetMuted}`,
  stale: `${styles.cellReset} ${styles.cellResetStale}`,
} as const;

function WindowCell({
  window,
  label,
  now,
}: {
  window: NormalizedQuotaWindow | null;
  label: QuotaWindowLabel;
  now: number;
}) {
  const { t } = useTranslation();
  const text = formatQuotaWindowLabel(t, label);

  if (!window) {
    return (
      <div className={`${styles.cell} ${styles.cellAbsent}`}>
        <span className={styles.cellLabel}>{text}</span>
        <span className={styles.cellPercent}>--</span>
        <div className={`${styles.track} ${styles.trackUnknown}`} aria-hidden="true" />
        <div className={styles.cellReset}>{t('quota_management.ledger_not_reported')}</div>
      </div>
    );
  }

  const percent = window.remainingPercent;
  const low = percent !== null && remainingTone(percent) === 'low';
  const reset = resetText(t, window, now);
  return (
    <div className={styles.cell}>
      <span className={styles.cellLabel}>{text}</span>
      <span className={low ? `${styles.cellPercent} ${styles.cellPercentLow}` : styles.cellPercent}>
        {percent === null
          ? '--'
          : t('quota_management.ledger_percent_left', { percent: Math.round(percent) })}
        {low && (
          <span className={styles.lowMark}>
            <IconAlertTriangle size={13} aria-hidden="true" />
            {t('quota_management.ledger_low')}
          </span>
        )}
      </span>
      {percent === null ? (
        <div className={`${styles.track} ${styles.trackUnknown}`} aria-hidden="true" />
      ) : (
        <div
          className={styles.track}
          role="meter"
          aria-label={t('quota_management.window_remaining_label', {
            label: text,
            percent: Math.round(percent),
          })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div
            className={low ? `${styles.fill} ${styles.fillLow}` : styles.fill}
            style={{ width: `${Math.round(percent * 100) / 100}%` }}
          />
        </div>
      )}
      <div className={RESET_TONE_CLASS[reset?.tone ?? 'normal']} title={reset?.title}>
        {reset?.text ?? (percent === null ? t('quota_management.member_status_unreported') : '')}
      </div>
    </div>
  );
}

function loadedAgo(t: TFunction, loadedAtMs: number | undefined, now: number): string | null {
  if (loadedAtMs === undefined) return null;
  const elapsed = now - loadedAtMs;
  return elapsed < MINUTE_MS
    ? t('quota_management.ledger_loaded_now')
    : t('quota_management.ledger_loaded_ago', { time: formatCountdown(t, elapsed) });
}

function LedgerRow({
  entry,
  quota,
  columns,
  displayName,
  resolvedTheme,
  now,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  columns: Column[];
  displayName: string;
  resolvedTheme: ResolvedTheme;
  now: number;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const isClaude = entry.type === 'claude';
  const own = normalizeQuotaWindows(entry.type, quota);
  const claudeReset = useClaudeResetGrants(
    entry.file,
    isClaude ? (quota as ClaudeQuotaState | undefined) : undefined,
    !canRefresh || loading || resetting,
    onRefresh
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  const meta = [
    getTypeLabel(t, entry.type),
    resolveQuotaPlanLabel(entry.type, quota, t),
    status === 'success' ? loadedAgo(t, quota?.loadedAtMs, now) : null,
  ].filter(Boolean);

  let body;
  if (status === 'success' && own.length > 0) {
    body = columns.map((column) => (
      <WindowCell
        key={column.key}
        label={column.label}
        window={own.find((window) => window.key === column.key) ?? null}
        now={now}
      />
    ));
  } else if (status === 'success') {
    body = <p className={styles.rowMessage}>{t('quota_management.ledger_no_windows')}</p>;
  } else if (loading) {
    body = (
      <div className={styles.skeletonCells} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {Array.from({ length: columns.length || LOADING_PLACEHOLDER_CELLS }, (_, index) => (
          <div key={index} className={styles.cell} aria-hidden="true">
            <span className={styles.skeletonLabel} />
            <span className={`${styles.track} ${styles.skeletonTrack}`} />
          </div>
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <p className={`${styles.rowMessage} ${styles.rowError}`} role="alert">
        {t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })}
      </p>
    );
  } else {
    body = <p className={styles.rowMessage}>{t('quota_management.ledger_not_loaded')}</p>;
  }

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={displayName}>
          {displayName}
        </span>
        <span className={styles.meta}>
          <ProviderGlyph
            provider={entry.type}
            resolvedTheme={resolvedTheme}
            className={styles.metaGlyph}
          />
          <span className={styles.metaText}>{meta.join(' · ')}</span>
        </span>
      </div>
      {body}
      {isClaude && (
        <div className={styles.resets}>
          <ClaudeResetGroups reset={claudeReset} now={now} />
        </div>
      )}
      <div className={styles.action}>
        {showReset && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            aria-label={t('codex_quota.reset_button')}
            title={t('codex_quota.reset_button')}
          >
            <IconZap
              size={15}
              aria-hidden="true"
              className={resetting ? styles.pulsing : undefined}
            />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          aria-label={t('quota_management.ledger_refresh_label', { name: displayName })}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw
            size={15}
            aria-hidden="true"
            className={loading ? styles.spinning : undefined}
          />
        </button>
      </div>
    </li>
  );
}

/** Weekday and time, e.g. "Tue 9:00 AM": a weekly reset is always within the week. */
function formatWeekdayTime(ms: number, locale: string | undefined): string {
  return new Date(ms).toLocaleString(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PoolSummary({ pool }: { pool: ProviderPool | undefined }) {
  const { t, i18n } = useTranslation();
  const primary = pool?.windows.find((window) => window.key === pool.primaryKey);
  if (!primary || primary.totalRemaining === null) return null;
  const next = primary.nextReset;
  return (
    <span className={styles.poolSummary} title={formatQuotaWindowLabel(t, primary.label)}>
      <span className={styles.poolTotal}>
        <strong>{`${Math.round(primary.totalRemaining)}%`}</strong>{' '}
        {t('quota_management.ledger_pool', { capacity: primary.capacity })}
      </span>
      {next && (
        <span className={styles.poolNext}>
          {`${t('quota_management.pool_next_reset', {
            percent: Math.round(next.restorePercent),
          })} · ${formatWeekdayTime(next.atMs, i18n.resolvedLanguage)}`}
        </span>
      )}
    </span>
  );
}

export function QuotaLedger({
  entries,
  quotaFor,
  displayNameFor,
  resolvedTheme,
  now,
  pools,
  canRefresh,
  resettingKey,
  onRefresh,
  onReset,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  const groups = QUOTA_TAB_ORDER.map((provider) => ({
    provider,
    entries: entries.filter((entry) => entry.type === provider),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className={styles.ledger} aria-label={t('quota_management.ledger_label')} role="region">
      {groups.map((group) => {
        const pool = pools.find((candidate) => candidate.provider === group.provider);
        const columns = ledgerColumns(
          group.provider,
          group.entries,
          quotaFor,
          pool?.windows.map((window) => window.key)
        );
        const hasResets = group.provider === 'claude';
        const template = [
          'minmax(150px, 1.15fr)',
          `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`,
          hasResets ? 'minmax(200px, 1fr)' : null,
          'auto',
        ]
          .filter(Boolean)
          .join(' ');
        const headingId = `quota-ledger-${group.provider}`;
        return (
          <section
            key={group.provider}
            className={styles.group}
            aria-labelledby={headingId}
            style={
              {
                '--ledger-template': template,
                '--ledger-span': Math.max(columns.length, 1),
              } as CSSProperties
            }
          >
            <header className={styles.groupHead}>
              <h3 className={styles.groupTitle} id={headingId}>
                <ProviderGlyph provider={group.provider} resolvedTheme={resolvedTheme} />
                <span>{getTypeLabel(t, group.provider)}</span>
                <span className={styles.groupCount}>{group.entries.length}</span>
              </h3>
              <PoolSummary pool={pool} />
            </header>
            <div className={styles.columnHead} aria-hidden="true">
              <span>{t('quota_management.ledger_credential')}</span>
              {columns.length === 0 ? (
                <span />
              ) : (
                columns.map((column) => (
                  <span key={column.key} className={styles.columnLabel}>
                    {formatQuotaWindowLabel(t, column.label)}
                  </span>
                ))
              )}
              {hasResets && <span>{t('quota_management.ledger_resets')}</span>}
              <span />
            </div>
            <ul className={styles.rows}>
              {group.entries.map((entry) => {
                const key = getQuotaCacheKey(entry.file);
                return (
                  <LedgerRow
                    key={`${entry.type}:${key}`}
                    entry={entry}
                    quota={quotaFor(entry)}
                    columns={columns}
                    displayName={displayNameFor(getQuotaDisplayName(entry.file))}
                    resolvedTheme={resolvedTheme}
                    now={now}
                    canRefresh={canRefresh(entry)}
                    resetting={resettingKey === key}
                    onRefresh={() => onRefresh(entry)}
                    onReset={() => onReset(entry)}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
