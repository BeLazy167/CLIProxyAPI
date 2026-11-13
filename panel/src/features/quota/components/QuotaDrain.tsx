/**
 * Drain view: one shared toolbar and a forecast card per provider window that
 * has recorded history (see DRAIN_WINDOWS). Fetches Lamplighter history; the
 * cards are built in drainCard.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Tooltip } from '@/components/ui/Tooltip';
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
import { QuotaSection } from './QuotaSection';
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
    <QuotaSection
      id="quota-drain-heading"
      title={t('quota_management.drain_title')}
      note={t('quota_management.drain_note')}
    >
      <Tabs className={styles.tabsRoot} value={tab} onChange={(next) => setTab(next as DrainTab)}>
        <div className={styles.toolbar}>
          <div className={styles.group}>
            <TabList className={styles.segmented} aria-label={t('quota_management.drain_title')}>
              {(['remaining', 'drain'] as const).map((id) => (
                <Tab key={id} value={id} className={styles.segment}>
                  {t(`quota_management.drain_tab_${id}`)}
                </Tab>
              ))}
            </TabList>
            <Tooltip
              label={t('quota_management.tip_drain_mode_label')}
              content={t('quota_management.tip_drain_mode')}
            />
          </div>

          <div className={styles.group}>
            <span className={styles.groupLabel} id="drain-burn-label">
              <Tooltip content={t('quota_management.tip_burn_rate')}>
                {t('quota_management.drain_burn_label')}
              </Tooltip>
            </span>
            <SegmentedControl
              className={styles.segmented}
              itemClassName={styles.segment}
              ariaLabelledBy="drain-burn-label"
              value={String(burnHours)}
              onChange={(hours) => setBurnHours(Number(hours))}
              options={BURN_WINDOW_HOURS.map((hours) => ({
                value: String(hours),
                label: t('quota_management.drain_hours', { hours }),
              }))}
            />
          </div>

          <div className={styles.group}>
            <span className={styles.groupLabel}>
              <Tooltip content={t('quota_management.tip_future_usage')}>
                {t('quota_management.drain_usage_label')}
              </Tooltip>
            </span>
            <Select
              value={usage}
              options={usageOptions}
              onChange={(value) => setUsage(value as FutureUsage)}
              ariaLabel={t('quota_management.drain_usage_label')}
              size="sm"
            />
          </div>

          <div className={styles.group}>
            <ToggleSwitch
              checked={showAccounts}
              onChange={setShowAccounts}
              label={t('quota_management.drain_accounts')}
            />
            <Tooltip
              label={t('quota_management.tip_drain_accounts_label')}
              content={t('quota_management.tip_drain_accounts')}
            />
          </div>

          <div className={styles.range}>
            <span className={styles.rangeLabel}>
              {t('quota_management.drain_range', {
                from: monthDay(fromMs),
                to: monthDay(toMs - 1),
              })}
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
            <Toggle
              className={styles.today}
              pressed={weekOffset === 0}
              onPressedChange={() => setWeekOffset(0)}
            >
              {t('quota_management.drain_today')}
            </Toggle>
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

        <TabPanel value={tab} className={styles.cards}>
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
        </TabPanel>
      </Tabs>
    </QuotaSection>
  );
}
