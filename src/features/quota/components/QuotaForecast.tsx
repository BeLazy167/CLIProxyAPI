/**
 * Pooled 7-day quota for Claude: the last day and a half as recorded by the
 * Lamplighter plugin (solid), the next 7 days as projected (dashed sawtooth that
 * jumps at each account's reset), and a drain-rate view of the same history.
 * Arithmetic lives in quotaForecast.ts; this file only fetches and draws it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/useAuthStore';
import { readLamplighterHistory } from '@/services/api/lamplighterHistory';
import { formatInstantShort, normalizeAuthIndex } from '@/utils/quota';
import type { PoolWindow } from '../quotaPool';
import {
  buildHourlyDrain,
  buildPoolForecast,
  buildPoolHistory,
  type ForecastPoint,
  type QuotaHistorySeries,
} from '../quotaForecast';
import styles from './QuotaForecast.module.scss';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HORIZON_HOURS = 7 * 24;
const PAST_HOURS = 36;
const HISTORY_REFRESH_MS = 5 * 60_000;
const W = 1000;
const H = 240;
const PAD = { left: 52, right: 12, top: 14, bottom: 28 };

type ForecastTab = 'remaining' | 'drain';

export interface QuotaForecastProps {
  window: PoolWindow;
  now: number;
}

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const hourLabel = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric' });
const toPoints = (points: ForecastPoint[], x: (ms: number) => number, y: (v: number) => number) =>
  points.map((p) => `${x(p.atMs).toFixed(1)},${y(p.remaining).toFixed(1)}`).join(' ');

/** Lamplighter history for the pool's accounts; refetched every few minutes as the clock moves. */
function usePoolHistory(now: number): QuotaHistorySeries[] | null {
  const apiBase = useAuthStore((state) => state.apiBase);
  const [series, setSeries] = useState<QuotaHistorySeries[] | null>(null);
  const bucket = Math.floor(now / HISTORY_REFRESH_MS);
  useEffect(() => {
    let cancelled = false;
    void readLamplighterHistory(apiBase, '4d').then((result) => {
      if (!cancelled) setSeries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, bucket]);
  return series;
}

export function QuotaForecast({ window, now }: QuotaForecastProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ForecastTab>('remaining');
  const series = usePoolHistory(now);

  const authIndexes = useMemo(
    () =>
      window.members
        .map((member) => normalizeAuthIndex(member.entry.file.authIndex))
        .filter((index): index is string => index !== null),
    [window]
  );
  // Pool keys are "<provider>:<window id>"; Lamplighter records the bare window id.
  const windowId = window.key.slice(window.key.indexOf(':') + 1);
  const pastFrom = now - PAST_HOURS * HOUR_MS;

  const forecast = useMemo(() => buildPoolForecast(window, now, HORIZON_HOURS), [window, now]);
  const history = useMemo(
    () => (series ? buildPoolHistory(series, authIndexes, windowId, pastFrom, now) : []),
    [series, authIndexes, windowId, pastFrom, now]
  );
  const drain = useMemo(
    () => (series ? buildHourlyDrain(series, authIndexes, windowId, pastFrom, now) : []),
    [series, authIndexes, windowId, pastFrom, now]
  );
  if (!forecast) return null;

  const startMs = tab === 'drain' || history.length > 0 ? pastFrom : now;
  const endMs = tab === 'drain' ? now : now + HORIZON_HOURS * HOUR_MS;
  const x = (ms: number) => PAD.left + ((ms - startMs) / (endMs - startMs)) * (W - PAD.left - PAD.right);

  const drainMax = Math.max(5, Math.ceil(Math.max(...drain.map((bar) => bar.drain), 0) / 5) * 5);
  const yMax = tab === 'drain' ? drainMax : forecast.capacity;
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
  const gridSteps = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const ticks: { ms: number; label: string }[] = [];
  if (tab === 'drain') {
    for (let d = Math.ceil(startMs / (6 * HOUR_MS)) * 6 * HOUR_MS; d < endMs; d += 6 * HOUR_MS)
      ticks.push({ ms: d, label: new Date(d).getHours() === 0 ? dayLabel(d) : hourLabel(d) });
  } else {
    for (let d = new Date(startMs).setHours(24, 0, 0, 0); d < endMs; d += DAY_MS) ticks.push({ ms: d, label: dayLabel(d) });
  }

  const projected = toPoints(forecast.points, x, y);
  const past = history.length > 0 ? toPoints([...history, forecast.points[0]], x, y) : '';
  const area = `${x(history[0]?.atMs ?? now)},${y(0)} ${past} ${projected} ${x(endMs)},${y(0)}`;
  const barWidth = (x(startMs + HOUR_MS) - x(startMs)) * 0.7;

  const lastDay = drain.filter((bar) => bar.atMs >= now - DAY_MS);
  const dayAverage = lastDay.length > 0 ? lastDay.reduce((sum, bar) => sum + bar.drain, 0) / lastDay.length : 0;
  const peak = drain.reduce<(typeof drain)[number] | null>((top, bar) => (!top || bar.drain > top.drain ? bar : top), null);
  const lowest = forecast.points.reduce((low, p) => (p.remaining < low.remaining ? p : low));
  const nextReset = forecast.resets[0];

  return (
    <section className={styles.forecast} aria-label={t('quota_management.forecast_title')}>
      <div className={styles.head}>
        <p className={styles.total}>
          <span className={styles.value}>{Math.round(forecast.remaining)}%</span>
          <span className={styles.of}>{t('quota_management.forecast_of', { capacity: forecast.capacity })}</span>
        </p>
        <span className={styles.rate}>
          {t('quota_management.forecast_rate', { rate: forecast.drainPerHour.toFixed(1) })}
        </span>
        <span className={styles.title}>{t('quota_management.forecast_title')}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        {(['remaining', 'drain'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={styles.tab}
            onClick={() => setTab(id)}
          >
            {t(`quota_management.forecast_tab_${id}`)}
          </button>
        ))}
        {tab === 'remaining' && (
          <span className={styles.legend}>
            {history.length > 0 && (
              <span>
                <i className={styles.dot} /> {t('quota_management.forecast_legend_remaining')}
              </span>
            )}
            <span>
              <i className={styles.dash} /> {t('quota_management.forecast_legend_projected')}
            </span>
          </span>
        )}
      </div>

      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t(`quota_management.forecast_aria_${tab}`)}>
        {gridSteps.map((v) => (
          <g key={v}>
            <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className={styles.axis} x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {Number(v.toFixed(1))}%
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick.ms} className={styles.axis} x={x(tick.ms)} y={H - 8} textAnchor="middle">
            {tick.label}
          </text>
        ))}

        {tab === 'remaining' ? (
          <>
            <polygon className={styles.area} points={area} />
            {past && <polyline className={styles.past} points={past} />}
            <polyline className={styles.line} points={projected} />
            <line className={styles.now} x1={x(now)} x2={x(now)} y1={PAD.top} y2={y(0)} />
            <text className={styles.axis} x={x(now) + 6} y={PAD.top + 12}>
              {t('quota_management.forecast_now')}
            </text>
          </>
        ) : (
          drain.map((bar) => (
            <rect
              key={bar.atMs}
              className={styles.bar}
              x={x(bar.atMs) + barWidth * 0.2}
              y={y(bar.drain)}
              width={barWidth}
              height={y(0) - y(bar.drain)}
            >
              <title>{`${formatInstantShort(bar.atMs)}: ${bar.drain.toFixed(0)}%`}</title>
            </rect>
          ))
        )}
      </svg>

      <div className={styles.foot}>
        {tab === 'remaining' ? (
          <>
            {nextReset && (
              <span>
                {t('quota_management.pool_next_reset', { percent: Math.round(nextReset.restore) })} ·{' '}
                {formatInstantShort(nextReset.atMs)}
              </span>
            )}
            <span>
              {t('quota_management.forecast_lowest', {
                percent: Math.round(lowest.remaining),
                when: formatInstantShort(lowest.atMs),
              })}
            </span>
          </>
        ) : series === null ? (
          <span>{t('quota_management.forecast_no_history')}</span>
        ) : (
          <>
            <span>{t('quota_management.forecast_drain_average', { rate: dayAverage.toFixed(1) })}</span>
            {peak && peak.drain > 0 && (
              <span>
                {t('quota_management.forecast_drain_peak', {
                  rate: peak.drain.toFixed(0),
                  when: formatInstantShort(peak.atMs),
                })}
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
