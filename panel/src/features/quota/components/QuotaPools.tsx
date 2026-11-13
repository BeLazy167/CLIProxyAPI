/**
 * Provider pool summaries: one compact card per provider, leading with its most
 * constrained like-for-like window ("409% of 500%") drawn as a segmented bar of
 * account contributions. Other windows of the same provider sit behind a
 * disclosure. All arithmetic lives in quotaPool.ts; this file only renders it.
 */

import { Fragment, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ResolvedTheme } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
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
import { ProviderGlyph } from './ProviderGlyph';
import { QuotaSection } from './QuotaSection';
import { QuotaWindowName } from './QuotaWindowName';
import { QuotaSegmentBar, type QuotaSegment } from './QuotaSegmentBar';
import styles from './QuotaPools.module.scss';

export interface QuotaPoolsProps {
  pools: ProviderPool[];
  now: number;
  resolvedTheme: ResolvedTheme;
  /** Shown under the tiles: the reset suggestion. */
  notice?: ReactNode;
}

const UNKNOWN_STATUS_ORDER: Exclude<PoolMemberStatus, 'reported' | 'absent'>[] = [
  'loading',
  'error',
  'idle',
  'unreported',
];

function memberSegment(t: TFunction, member: PoolMember): QuotaSegment {
  const name = getQuotaDisplayName(member.entry.file);
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

/** "4 of 5 reporting · 1 loading · 2 without this limit": empty when fully reported. */
function coverageParts(t: TFunction, window: PoolWindow): ReactNode[] {
  const parts: ReactNode[] = [];
  if (window.unknownCount > 0) {
    parts.push(
      t('quota_management.pool_reporting', {
        reported: window.reportedCount,
        total: window.members.length,
      })
    );
    UNKNOWN_STATUS_ORDER.forEach((status) => {
      const count = window.members.filter((member) => member.status === status).length;
      if (count > 0) parts.push(statusPart(t, status, count));
    });
  }
  if (window.absentCount > 0) {
    parts.push(t('quota_management.pool_absent', { count: window.absentCount }));
  }
  return parts;
}

/** "1 without a figure" gets its tip: loaded, yet no percent, which is not 0%. */
function statusPart(t: TFunction, status: string, count: number): ReactNode {
  const text = t(`quota_management.pool_status_${status}`, { count });
  return status === 'unreported' ? (
    <Tooltip content={t('quota_management.tip_unreported', { count })}>{text}</Tooltip>
  ) : (
    text
  );
}

function joinParts(parts: ReactNode[]): ReactNode {
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && ' · '}
      {part}
    </Fragment>
  ));
}

/** The pool's reset facts as label and value pairs, each figure with its tip. */
function PoolFacts({
  window,
  now,
  provider,
  coverage,
}: {
  window: PoolWindow | null;
  now: number;
  provider: string;
  coverage: ReactNode[];
}) {
  const { t, i18n } = useTranslation();
  const next = window?.nextReset ?? null;
  const nextDisplay = next ? buildResetDisplay(null, next.atMs, now, i18n.resolvedLanguage) : null;
  const restore = next ? Math.round(next.restorePercent) : 0;
  const showAll =
    window?.allResetAtMs != null &&
    next !== null &&
    window.allResetAtMs - next.atMs > RESET_GROUP_TOLERANCE_MS;
  const isFull =
    window !== null &&
    window.reportedCount > 0 &&
    window.members.every(
      (member) => member.status !== 'reported' || (member.remainingPercent as number) >= 100
    );
  const status: ReactNode[] = [...coverage];
  if (!next && isFull) status.unshift(t('quota_management.pool_full'));

  return (
    <>
      {(next || showAll || status.length > 0) && (
        <dl className={styles.facts}>
          {next && nextDisplay && (
            <>
              <dt>{t('quota_management.pool_next_reset_label')}</dt>
              <dd>
                <Tooltip
                  content={t('quota_management.tip_pool_next_reset', {
                    count: next.accountCount,
                    percent: restore,
                  })}
                >
                  {t('quota_management.pool_next_reset_gain', { percent: restore })}
                </Tooltip>
                {nextDisplay.relative && ` ${nextDisplay.relative}`}
                <span className={styles.resetAbsolute}>{nextDisplay.absolute}</span>
              </dd>
            </>
          )}
          {showAll && (
            <>
              <dt>{t('quota_management.pool_all_reset_label')}</dt>
              <dd>
                <Tooltip content={t('quota_management.tip_pool_all_reset', { provider })}>
                  {t('quota_management.pool_all_reset_by', {
                    time: formatInstantShort(window.allResetAtMs as number),
                  })}
                </Tooltip>
              </dd>
            </>
          )}
          {status.length > 0 && (
            <>
              <dt>{t('quota_management.pool_status_label')}</dt>
              <dd>{joinParts(status)}</dd>
            </>
          )}
        </dl>
      )}
      {window !== null && window.staleCount > 0 && (
        <p className={styles.resetStale}>
          <Tooltip content={t('quota_management.tip_stale')}>
            {t('quota_management.pool_stale', { count: window.staleCount })}
          </Tooltip>
        </p>
      )}
    </>
  );
}

/** "of 300%", with the sum spelled out when more than one account adds to it. */
function PoolCapacity({ window, provider }: { window: PoolWindow; provider: string }) {
  const { t } = useTranslation();
  const text = t('quota_management.pool_of_capacity', { capacity: window.capacity });
  if (window.reportedCount < 2) return <span className={styles.capacity}>{text}</span>;
  const parts = window.members
    .filter((member) => member.status === 'reported')
    .map((member) => formatRemainingPercent(member.remainingPercent))
    .join(' + ');
  return (
    <span className={styles.capacity}>
      <Tooltip
        content={t('quota_management.tip_pool_of', {
          provider,
          count: window.reportedCount,
          capacity: window.capacity,
          parts,
        })}
      >
        {text}
      </Tooltip>
    </span>
  );
}

/** The per-account meter; a tap on it explains the segments when there is more than one. */
function PoolMeter({ label, segments }: { label: string; segments: QuotaSegment[] }) {
  const { t } = useTranslation();
  const bar = <QuotaSegmentBar label={label} segments={segments} />;
  return segments.length > 1 ? (
    <Tooltip block content={t('quota_management.tip_pool_segments')}>
      {bar}
    </Tooltip>
  ) : (
    bar
  );
}

function PoolCard({
  pool,
  now,
  resolvedTheme,
}: {
  pool: ProviderPool;
  now: number;
  resolvedTheme: ResolvedTheme;
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

  // Before any window is known, still draw one dashed segment per account so the
  // card states how many accounts are pending instead of showing an empty pool.
  const pendingSegments: QuotaSegment[] = primary
    ? []
    : pool.credentials.map(({ entry, status }) =>
        memberSegment(t, {
          entry,
          status: status === 'success' ? 'unreported' : status,
          remainingPercent: null,
          resetAtMs: null,
        })
      );
  const pendingParts: ReactNode[] = primary
    ? []
    : [
        ...(['loading', 'error', 'idle'] as const)
          .filter((status) => pool.statusCounts[status] > 0)
          .map((status) => statusPart(t, status, pool.statusCounts[status])),
        // Loaded, but nothing that can be pooled was reported.
        ...(pool.statusCounts.success > 0
          ? [statusPart(t, 'unreported', pool.statusCounts.success)]
          : []),
      ];

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
          <div className={styles.windowLabel}>
            <QuotaWindowName label={primary.label} />
          </div>
          <p className={styles.total}>
            <span className={styles.totalValue}>
              {formatRemainingPercent(primary.totalRemaining)}
            </span>
            <PoolCapacity window={primary} provider={providerLabel} />
          </p>
          <PoolMeter
            label={t('quota_management.pool_segments_label', { label: primaryLabel })}
            segments={primary.members.map((member) => memberSegment(t, member))}
          />
          <PoolFacts
            window={primary}
            now={now}
            provider={providerLabel}
            coverage={coverageParts(t, primary)}
          />
        </>
      ) : (
        <>
          <p className={styles.total}>
            <span className={`${styles.totalValue} ${styles.totalUnknown}`}>--</span>
            <span className={styles.capacity}>
              {t('quota_management.pool_of_capacity', { capacity: pool.credentialCount * 100 })}
            </span>
          </p>
          <PoolMeter label={t('quota_management.pool_no_data')} segments={pendingSegments} />
          <PoolFacts window={null} now={now} provider={providerLabel} coverage={pendingParts} />
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
                    <span className={styles.moreLabel}>
                      <QuotaWindowName label={window.label} />
                    </span>
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
                      <PoolMeter
                        label={t('quota_management.pool_segments_label', { label })}
                        segments={window.members.map((member) => memberSegment(t, member))}
                      />
                      <PoolFacts
                        window={window}
                        now={now}
                        provider={providerLabel}
                        coverage={coverageParts(t, window)}
                      />
                    </>
                  )}
                  {!expanded && window.staleCount > 0 && (
                    <p className={styles.resetStale}>
                      <Tooltip content={t('quota_management.tip_stale')}>
                        {t('quota_management.pool_stale', { count: window.staleCount })}
                      </Tooltip>
                    </p>
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

export function QuotaPools({ pools, now, resolvedTheme, notice }: QuotaPoolsProps) {
  const { t } = useTranslation();
  if (pools.length === 0) return null;
  return (
    <QuotaSection
      id="quota-pools-heading"
      title={t('quota_management.pools_label')}
      note={t('quota_management.pools_note')}
    >
      <div className={styles.pools}>
        {pools.map((pool) => (
          <PoolCard key={pool.provider} pool={pool} now={now} resolvedTheme={resolvedTheme} />
        ))}
      </div>
      {notice}
    </QuotaSection>
  );
}
