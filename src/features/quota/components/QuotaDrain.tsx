/**
 * Drain view: one shared toolbar and a forecast card per provider window that
 * has recorded history (see DRAIN_WINDOWS). Fetches Lamplighter history; the
 * cards are built in drainCard.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { IconChevronLeft } from '@/components/ui/icons';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ResolvedTheme } from '@/types';
import { readLamplighterHistory } from '@/services/api/lamplighterHistory';
import { normalizeAuthIndex } from '@/utils/quota';
import type { QuotaFileEntry } from '../logic';
import type { ProviderPool } from '../quotaPool';
import type { QuotaHistorySeries } from '../drainSeries';
import { BURN_WINDOW_HOURS, FUTURE_USAGE, type FutureUsage } from '../quotaForecast';
import { buildDrainCard, DRAIN_WINDOWS } from '../drainCard';
import { DrainCard, type DrainTab } from './DrainCard';
import styles from './QuotaDrain.module.scss';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_REFRESH_MS = 5 * 60_000;
/** The 8d range keeps 15-minute buckets, enough for rates and a current 7-day window. */
const RATE_RANGE_MS = 8 * DAY_MS;
const WIDE_RANGE_MS = 36 * DAY_MS;
const VIEW_DAYS = 14;
const VIEW_LEAD_DAYS = 3;
const MAX_FORWARD_WEEKS = 2;

const authIndexOf = (entry: QuotaFileEntry) => normalizeAuthIndex(entry.file.authIndex);
const monthDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Undefined while loading, null when the plugin is missing; refetched every few minutes. */
function useLamplighterHistory(range: '8d' | '36d' | null, now: number) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const [series, setSeries] = useState<QuotaHistorySeries[] | null | undefined>(undefined);
  const bucket = Math.floor(now / HISTORY_REFRESH_MS);
  useEffect(() => {
    if (range === null) return;
    let cancelled = false;
    void readLamplighterHistory(apiBase, range).then((result) => {
      if (!cancelled) setSeries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, range, bucket]);
  return range === null ? undefined : series;
}

export interface QuotaDrainProps {
  pools: ProviderPool[];
  now: number;
  resolvedTheme: ResolvedTheme;
  nameOf: (entry: QuotaFileEntry) => string;
}

export function QuotaDrain({ pools, now, resolvedTheme, nameOf }: QuotaDrainProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrainTab>('remaining');
  const [burnHours, setBurnHours] = useState<number>(3);
  const [usage, setUsage] = useState<FutureUsage>('average');
  const [showAccounts, setShowAccounts] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const fromMs =
    new Date(now).setHours(0, 0, 0, 0) - VIEW_LEAD_DAYS * DAY_MS + weekOffset * 7 * DAY_MS;
  const toMs = fromMs + VIEW_DAYS * DAY_MS;
  const canGoBack = fromMs - 7 * DAY_MS >= now - WIDE_RANGE_MS;

  const rateSeries = useLamplighterHistory('8d', now);
  const wideSeries = useLamplighterHistory(fromMs < now - RATE_RANGE_MS ? '36d' : null, now);
  const drawSeries = wideSeries ?? rateSeries;

  const cards = useMemo(() => {
    if (!rateSeries || !drawSeries) return [];
    return DRAIN_WINDOWS.flatMap((def) => {
      const pool = pools.find((candidate) => candidate.windows.some((w) => w.key === def.poolKey));
      const window = pool?.windows.find((w) => w.key === def.poolKey);
      if (!pool || !window) return [];
      const model = buildDrainCard({
        provider: pool.provider,
        window,
        history: def.history,
        size: def.size,
        authIndexOf,
        rateSeries,
        drawSeries,
        nowMs: now,
        fromMs,
        toMs,
        options: { usage, burnHours },
      });
      return model ? [model] : [];
    });
  }, [pools, rateSeries, drawSeries, now, fromMs, toMs, usage, burnHours]);

  const usageOptions = useMemo(
    () => FUTURE_USAGE.map((id) => ({ value: id, label: t(`quota_management.drain_usage_${id}`) })),
    [t]
  );

  if (cards.length === 0) return null;

  return (
    <section className={styles.drain} aria-label={t('quota_management.drain_title')}>
      <div className={styles.toolbar}>
        <div
          className={styles.segmented}
          role="tablist"
          aria-label={t('quota_management.drain_title')}
        >
          {(['remaining', 'drain'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={styles.segment}
              onClick={() => setTab(id)}
            >
              {t(`quota_management.drain_tab_${id}`)}
            </button>
          ))}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel} id="drain-burn-label">
            {t('quota_management.drain_burn_label')}
          </span>
          <div className={styles.segmented} role="group" aria-labelledby="drain-burn-label">
            {BURN_WINDOW_HOURS.map((hours) => (
              <button
                key={hours}
                type="button"
                aria-pressed={burnHours === hours}
                className={styles.segment}
                onClick={() => setBurnHours(hours)}
              >
                {t('quota_management.drain_hours', { hours })}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>{t('quota_management.drain_usage_label')}</span>
          <Select
            value={usage}
            options={usageOptions}
            onChange={(value) => setUsage(value as FutureUsage)}
            ariaLabel={t('quota_management.drain_usage_label')}
            size="sm"
            variant="quiet"
          />
        </div>

        <button
          type="button"
          aria-pressed={showAccounts}
          className={`${styles.segmented} ${styles.segment} ${styles.toggle}`}
          onClick={() => setShowAccounts((on) => !on)}
        >
          {t('quota_management.drain_accounts')}
        </button>

        <div className={styles.range}>
          <span className={styles.rangeLabel}>
            {t('quota_management.drain_range', { from: monthDay(fromMs), to: monthDay(toMs - 1) })}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            disabled={!canGoBack}
            aria-label={t('quota_management.drain_prev')}
            onClick={() => setWeekOffset((week) => week - 1)}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={`${styles.segmented} ${styles.segment}`}
            aria-pressed={weekOffset === 0}
            onClick={() => setWeekOffset(0)}
          >
            {t('quota_management.drain_today')}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            disabled={weekOffset >= MAX_FORWARD_WEEKS}
            aria-label={t('quota_management.drain_next')}
            onClick={() => setWeekOffset((week) => week + 1)}
          >
            <IconChevronLeft size={16} className={styles.flip} />
          </button>
        </div>
      </div>

      {cards.map((model) => (
        <DrainCard
          key={model.window.key}
          model={model}
          tab={tab}
          burnHours={burnHours}
          showAccounts={showAccounts}
          now={now}
          fromMs={fromMs}
          toMs={toMs}
          resolvedTheme={resolvedTheme}
          nameOf={nameOf}
        />
      ))}
    </section>
  );
}
