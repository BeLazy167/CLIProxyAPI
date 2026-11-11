/**
 * Provider pool summaries: one compact card per provider, leading with its most
 * constrained like-for-like window ("409% of 500%") drawn as a segmented bar of
 * account contributions. Other windows of the same provider sit behind a
 * disclosure. All arithmetic lives in quotaPool.ts; this file only renders it.
 */

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay, formatInstantShort } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import {
  RESET_GROUP_TOLERANCE_MS,
  type PoolMember,
  type PoolMemberStatus,
  type PoolWindow,
  type ProviderPool,
} from '../quotaPool';
import { formatQuotaWindowLabel, formatRemainingPercent } from '../quotaWindows';
import type { QuotaFileEntry } from '../logic';
import { ProviderGlyph } from './ProviderGlyph';
import { QuotaSegmentBar, type QuotaSegment } from './QuotaSegmentBar';
import styles from './QuotaPools.module.scss';

export interface QuotaPoolsProps {
  pools: ProviderPool[];
  now: number;
  resolvedTheme: ResolvedTheme;
  displayNameFor: (name: string) => string;
}

type NameFor = (entry: QuotaFileEntry) => string;

const UNKNOWN_STATUS_ORDER: Exclude<PoolMemberStatus, 'reported' | 'absent'>[] = [
  'loading',
  'error',
  'idle',
  'unreported',
];

function memberSegment(t: TFunction, member: PoolMember, nameFor: NameFor): QuotaSegment {
  const name = nameFor(member.entry);
  return {
    id: `${member.entry.type}:${member.entry.file.name}:${String(member.entry.file.authIndex ?? '')}`,
    percent: member.status === 'reported' ? member.remainingPercent : null,
    title:
      member.status === 'reported'
        ? t('quota_management.member_remaining', {
            name,
            percent: Math.round(member.remainingPercent as number),
          })
        : `${name}: ${t(`quota_management.member_status_${member.status}`)}`,
  };
}

/** "4 of 5 reporting · 1 loading · 2 without this limit" — empty when fully reported. */
function coverageParts(t: TFunction, window: PoolWindow): string[] {
  const parts: string[] = [];
  if (window.unknownCount > 0) {
    parts.push(
      t('quota_management.pool_reporting', {
        reported: window.reportedCount,
        total: window.members.length,
      })
    );
    UNKNOWN_STATUS_ORDER.forEach((status) => {
      const count = window.members.filter((member) => member.status === status).length;
      if (count > 0) parts.push(t(`quota_management.pool_status_${status}`, { count }));
    });
  }
  if (window.absentCount > 0) {
    parts.push(t('quota_management.pool_absent', { count: window.absentCount }));
  }
  return parts;
}

function PoolReset({ window, now }: { window: PoolWindow; now: number }) {
  const { t, i18n } = useTranslation();
  const next = window.nextReset;
  const nextDisplay = next ? buildResetDisplay(null, next.atMs, now, i18n.resolvedLanguage) : null;
  const restore = next ? Math.round(next.restorePercent) : 0;
  const showAll =
    window.allResetAtMs !== null &&
    next !== null &&
    window.allResetAtMs - next.atMs > RESET_GROUP_TOLERANCE_MS;
  const isFull =
    window.reportedCount > 0 &&
    window.members.every(
      (member) => member.status !== 'reported' || (member.remainingPercent as number) >= 100
    );

  return (
    <div className={styles.reset}>
      {next && nextDisplay ? (
        <p
          className={styles.resetLine}
          title={t('quota_management.pool_next_reset_hint', {
            count: next.accountCount,
            percent: restore,
          })}
        >
          <span className={styles.resetLead}>
            {t('quota_management.pool_next_reset', { percent: restore })}
          </span>
          {nextDisplay.relative && (
            <span className={styles.resetRelative}>{nextDisplay.relative}</span>
          )}
          <span className={styles.resetAbsolute}>{nextDisplay.absolute}</span>
        </p>
      ) : isFull ? (
        <p className={styles.resetLine}>{t('quota_management.pool_full')}</p>
      ) : null}
      {showAll && (
        <p className={styles.resetMuted}>
          {t('quota_management.pool_all_reset', {
            time: formatInstantShort(window.allResetAtMs as number),
          })}
        </p>
      )}
      {window.staleCount > 0 && (
        <p className={styles.resetStale}>
          {t('quota_management.pool_stale', { count: window.staleCount })}
        </p>
      )}
    </div>
  );
}

function PoolCard({
  pool,
  now,
  resolvedTheme,
  nameFor,
}: {
  pool: ProviderPool;
  now: number;
  resolvedTheme: ResolvedTheme;
  nameFor: NameFor;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const moreId = useId();
  const providerLabel = getTypeLabel(t, pool.provider);
  const primary = pool.windows.find((window) => window.key === pool.primaryKey) ?? null;
  const secondary = pool.windows.filter((window) => window.key !== pool.primaryKey);
  const visibleSecondary = expanded ? secondary : secondary.slice(0, 1);

  const primaryLabel = primary ? formatQuotaWindowLabel(t, primary.label) : null;
  const coverage = primary ? coverageParts(t, primary) : [];

  // Before any window is known, still draw one dashed segment per account so the
  // card states how many accounts are pending instead of showing an empty pool.
  const pendingSegments: QuotaSegment[] = primary
    ? []
    : pool.credentials.map(({ entry, status }) =>
        memberSegment(
          t,
          {
            entry,
            status: status === 'success' ? 'unreported' : status,
            remainingPercent: null,
            resetAtMs: null,
          },
          nameFor
        )
      );
  const pendingParts = primary
    ? []
    : (['loading', 'error', 'idle'] as const)
        .filter((status) => pool.statusCounts[status] > 0)
        .map((status) =>
          t(`quota_management.pool_status_${status}`, { count: pool.statusCounts[status] })
        )
        .concat(
          // Loaded, but nothing that can be pooled was reported.
          pool.statusCounts.success > 0
            ? [t('quota_management.pool_status_unreported', { count: pool.statusCounts.success })]
            : []
        );

  return (
    <article className={styles.card} aria-labelledby={headingId}>
      <header className={styles.head}>
        <ProviderGlyph provider={pool.provider} resolvedTheme={resolvedTheme} />
        <h3 id={headingId} className={styles.provider}>
          {providerLabel}
        </h3>
        <span className={styles.count}>
          {t('quota_management.pool_credentials', { count: pool.credentialCount })}
        </span>
      </header>

      {primary ? (
        <>
          <div className={styles.windowLabel}>{primaryLabel}</div>
          <p className={styles.total} title={t('quota_management.pool_total_hint')}>
            <span className={styles.totalValue}>
              {formatRemainingPercent(primary.totalRemaining)}
            </span>
            <span className={styles.capacity}>
              {t('quota_management.pool_of_capacity', { capacity: primary.capacity })}
            </span>
          </p>
          <QuotaSegmentBar
            label={t('quota_management.pool_segments_label', { label: primaryLabel })}
            segments={primary.members.map((member) => memberSegment(t, member, nameFor))}
          />
          {coverage.length > 0 && <p className={styles.coverage}>{coverage.join(' · ')}</p>}
          <PoolReset window={primary} now={now} />
        </>
      ) : (
        <>
          <p className={styles.total}>
            <span className={`${styles.totalValue} ${styles.totalUnknown}`}>--</span>
            <span className={styles.capacity}>
              {t('quota_management.pool_of_capacity', { capacity: pool.credentialCount * 100 })}
            </span>
          </p>
          <QuotaSegmentBar label={t('quota_management.pool_no_data')} segments={pendingSegments} />
          <p className={styles.coverage}>{pendingParts.join(' · ')}</p>
        </>
      )}

      {secondary.length > 0 && (
        <div className={styles.more}>
          <ul id={moreId} className={styles.moreList}>
            {visibleSecondary.map((window) => {
              const label = formatQuotaWindowLabel(t, window.label);
              return (
                <li key={window.key} className={styles.moreItem}>
                  <div className={styles.moreHead}>
                    <span className={styles.moreLabel}>{label}</span>
                    <span className={styles.moreValue}>
                      {formatRemainingPercent(window.totalRemaining)}
                      {window.reportedCount > 0 && (
                        <span className={styles.moreCapacity}>
                          {' '}
                          {t('quota_management.pool_of_capacity', { capacity: window.capacity })}
                        </span>
                      )}
                    </span>
                  </div>
                  {expanded && (
                    <>
                      <QuotaSegmentBar
                        size="sm"
                        label={t('quota_management.pool_segments_label', { label })}
                        segments={window.members.map((member) => memberSegment(t, member, nameFor))}
                      />
                      {coverageParts(t, window).length > 0 && (
                        <p className={styles.coverage}>{coverageParts(t, window).join(' · ')}</p>
                      )}
                      <PoolReset window={window} now={now} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={moreId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('quota_management.pool_hide_windows')
              : t('quota_management.pool_show_windows')}
            <span className={styles.srOnly}>
              {` · ${t('quota_management.pool_windows_toggle_label', { provider: providerLabel })}`}
            </span>
          </button>
        </div>
      )}
    </article>
  );
}

export function QuotaPools({ pools, now, resolvedTheme, displayNameFor }: QuotaPoolsProps) {
  const { t } = useTranslation();
  if (pools.length === 0) return null;
  const nameFor: NameFor = (entry) => displayNameFor(getQuotaDisplayName(entry.file));
  return (
    <section className={styles.pools} aria-label={t('quota_management.pools_label')}>
      {pools.map((pool) => (
        <PoolCard
          key={pool.provider}
          pool={pool}
          now={now}
          resolvedTheme={resolvedTheme}
          nameFor={nameFor}
        />
      ))}
    </section>
  );
}
