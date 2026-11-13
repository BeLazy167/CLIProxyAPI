/**
 * Ledger view: one row per account, grouped by provider, under a column header.
 *
 * Each provider group shares one column set (every window identity any of its
 * rows reports), so the same limit lines up down the group, and an account that
 * lacks a limit shows an explicit "not reported" cell instead of shifting its
 * other windows left. The group header repeats the pool summary. Claude rows
 * add three columns (Reset grant, Eligibility, Spend) with one line per reset group.
 * Up to tablet width each row becomes a card of label and value fields.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconAlertTriangle, IconRefreshCw, IconZap } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { formatInstantShort, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { MINUTE_MS } from '@/utils/time/durations';
import { formatCountdown } from '../compactDuration';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { resolveQuotaPlanLabel } from '../planLabels';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ClaudeResetGroups } from '../providers/claude/ClaudeResetGroups';
import type { ResetGrantKind } from '../providers/claude/resetGrantGroups';
import { ledgerColumns, type ProviderPool } from '../quotaPool';
import {
  formatQuotaWindowLabel,
  normalizeQuotaWindows,
  type NormalizedQuotaWindow,
  type QuotaWindowLabel,
} from '../quotaWindows';
import { QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import { remainingTone } from './quotaTone';
import { ProviderGlyph } from './ProviderGlyph';
import { QuotaWindowName } from './QuotaWindowName';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  now: number;
  /** Provider pools; they order the columns and supply each group's summary. */
  pools: readonly ProviderPool[];
  canRefresh: (entry: QuotaFileEntry) => boolean;
  resettingKey: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
  /** The account and kind the reset notice suggests, so its row can say so. */
  suggested: { key: string; kind: ResetGrantKind } | null;
}

type Column = { key: string; label: QuotaWindowLabel };

/** Skeleton cells drawn while a row with no known columns is loading. */
const LOADING_PLACEHOLDER_CELLS = 3;

function resetText(
  t: TFunction,
  window: NormalizedQuotaWindow,
  now: number
): { text: string; tip?: string; tone: 'normal' | 'muted' | 'stale' } | null {
  if (window.resetAtMs === null) {
    // A full window with nothing scheduled is a fact worth stating; a depleted
    // or unknown one without a reset instant simply wasn't reported.
    return window.remainingPercent !== null && window.remainingPercent >= 100
      ? { text: t('quota_management.ledger_no_reset'), tone: 'muted' }
      : null;
  }
  if (window.resetAtMs <= now) {
    return {
      text: t('quota_management.ledger_reset_passed'),
      tip: t('quota_management.tip_stale'),
      tone: 'stale',
    };
  }
  return {
    text: t('quota_management.ledger_resets_in', {
      time: formatCountdown(t, window.resetAtMs - now),
    }),
    tip: t('quota_management.tip_resets_at', { time: formatInstantShort(window.resetAtMs) }),
    tone: 'normal',
  };
}

const RESET_TONE_CLASS = {
  normal: styles.cellReset,
  muted: `${styles.cellReset} ${styles.cellResetMuted}`,
  stale: `${styles.cellReset} ${styles.cellResetStale}`,
} as const;

const FILL_TONE_CLASS = {
  high: styles.fillHigh,
  medium: styles.fillMedium,
  low: styles.fillLow,
} as const;

function NotReported() {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('quota_management.tip_not_reported')}>
      {t('quota_management.ledger_not_reported')}
    </Tooltip>
  );
}

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
  const name = (
    <span className={styles.cellLabel}>
      <QuotaWindowName label={label} />
    </span>
  );

  if (!window) {
    return (
      <div className={`${styles.cell} ${styles.cellAbsent}`}>
        {name}
        <div className={styles.cellBody}>
          <span className={styles.cellPercent}>
            --
            <span className={styles.cellNote}>
              <NotReported />
            </span>
          </span>
          <div className={`${styles.track} ${styles.trackUnknown}`} aria-hidden="true" />
        </div>
      </div>
    );
  }

  const percent = window.remainingPercent;
  const tone = percent === null ? null : remainingTone(percent);
  const low = tone === 'low';
  const reset = resetText(t, window, now);
  return (
    <div className={styles.cell}>
      {name}
      <div className={styles.cellBody}>
        <span className={styles.cellPercent}>
          {percent === null ? (
            <>
              --
              <span className={styles.cellNote}>
                <NotReported />
              </span>
            </>
          ) : (
            <span className={low ? styles.cellPercentLow : undefined}>
              {t('quota_management.ledger_percent_left', { percent: Math.round(percent) })}
            </span>
          )}
          {low && (
            <span className={styles.lowMark}>
              <IconAlertTriangle size={12} aria-hidden="true" />
              <Tooltip
                content={t('quota_management.tip_low', {
                  percent: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
                })}
              >
                {t('quota_management.ledger_low')}
              </Tooltip>
            </span>
          )}
        </span>
        {percent === null || tone === null ? (
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
              className={`${styles.fill} ${FILL_TONE_CLASS[tone]}`}
              style={{ width: `${Math.round(percent * 100) / 100}%` }}
            />
          </div>
        )}
        {reset && (
          <div className={RESET_TONE_CLASS[reset.tone]}>
            {reset.tip ? <Tooltip content={reset.tip}>{reset.text}</Tooltip> : reset.text}
          </div>
        )}
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
  suggestedKind,
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
  suggestedKind: ResetGrantKind | null;
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
  const meta = [getTypeLabel(t, entry.type), resolveQuotaPlanLabel(entry.type, quota, t)].filter(
    Boolean
  );
  const ago = status === 'success' ? loadedAgo(t, quota?.loadedAtMs, now) : null;

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
        <span className={styles.name}>{displayName}</span>
        <span className={styles.meta}>
          <ProviderGlyph
            provider={entry.type}
            resolvedTheme={resolvedTheme}
            className={styles.metaGlyph}
          />
          <span className={styles.metaText}>
            {meta.join(' · ')}
            {ago && (
              <>
                {' · '}
                <Tooltip content={t('quota_management.tip_loaded_ago')}>{ago}</Tooltip>
              </>
            )}
          </span>
        </span>
      </div>
      {body}
      {isClaude && (
        <div className={styles.resets}>
          <span className={styles.resetsLabel}>
            {t('quota_management.ledger_reset_grants')}
            <Tooltip label={t('claude_reset.tip_spend_label')} content={t('claude_reset.tip_spend')} />
          </span>
          <div className={styles.resetLines}>
            <ClaudeResetGroups reset={claudeReset} now={now} suggestedKind={suggestedKind} />
          </div>
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
          >
            <IconZap
              size={15}
              aria-hidden="true"
              className={resetting ? styles.pulsing : undefined}
            />
            <span className={styles.actionText}>{t('codex_quota.reset_button')}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          aria-label={t('quota_management.ledger_refresh_label', { name: displayName })}
        >
          <IconRefreshCw
            size={15}
            aria-hidden="true"
            className={loading ? styles.spinning : undefined}
          />
          <span className={styles.actionText}>{t('quota_management.ledger_refresh_text')}</span>
        </button>
        <Tooltip
          label={t('quota_management.tip_actions_label')}
          content={
            showReset
              ? `${t('quota_management.tip_codex_reset')} ${t('quota_management.tip_refresh')}`
              : t('quota_management.tip_refresh')
          }
        />
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
    <span className={styles.poolSummary}>
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
  resolvedTheme,
  now,
  pools,
  canRefresh,
  resettingKey,
  onRefresh,
  onReset,
  suggested,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  // Groups follow the sorted entries: a provider appears where its first row lands, so
  // "Soonest recovery" orders the groups too, and the default sort keeps provider order.
  const groups = [...new Set(entries.map((entry) => entry.type))].map((provider) => ({
    provider,
    entries: entries.filter((entry) => entry.type === provider),
  }));

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
          'minmax(200px, 1.2fr)',
          `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`,
          hasResets ? '136px 184px 48px' : null,
          '104px',
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
            <div className={styles.columnHead}>
              <span>{t('quota_management.ledger_credential')}</span>
              {columns.length === 0 ? (
                <span />
              ) : (
                columns.map((column) => (
                  <span key={column.key} className={styles.columnLabel}>
                    <QuotaWindowName label={column.label} />
                  </span>
                ))
              )}
              {hasResets && (
                <>
                  <span>{t('quota_management.ledger_reset_grant')}</span>
                  <span>{t('quota_management.ledger_eligibility')}</span>
                  <span className={styles.columnTip}>
                    {t('quota_management.ledger_spend')}
                    <Tooltip
                      label={t('claude_reset.tip_spend_label')}
                      content={t('claude_reset.tip_spend')}
                    />
                  </span>
                </>
              )}
              <span className={styles.columnActions}>{t('quota_management.ledger_actions')}</span>
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
                    displayName={getQuotaDisplayName(entry.file)}
                    resolvedTheme={resolvedTheme}
                    now={now}
                    canRefresh={canRefresh(entry)}
                    resetting={resettingKey === key}
                    onRefresh={() => onRefresh(entry)}
                    onReset={() => onReset(entry)}
                    suggestedKind={suggested?.key === key ? suggested.kind : null}
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
