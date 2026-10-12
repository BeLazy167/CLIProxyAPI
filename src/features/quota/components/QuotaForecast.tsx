/**
 * Projected remaining quota for one pooled window (Claude's shared 7-day limit):
 * a header with the pool total and drain rate, and a dashed sawtooth that falls
 * at the measured pace and jumps at each account's reset. Arithmetic lives in
 * quotaForecast.ts; this file only draws it.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatInstantShort } from '@/utils/quota';
import type { PoolWindow } from '../quotaPool';
import { buildPoolForecast } from '../quotaForecast';
import styles from './QuotaForecast.module.scss';

const HORIZON_HOURS = 7 * 24;
const DAY_MS = 86_400_000;
const W = 1000;
const H = 240;
const PAD = { left: 52, right: 12, top: 14, bottom: 28 };

export interface QuotaForecastProps {
  window: PoolWindow;
  now: number;
}

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function QuotaForecast({ window, now }: QuotaForecastProps) {
  const { t } = useTranslation();
  const forecast = useMemo(() => buildPoolForecast(window, now, HORIZON_HOURS), [window, now]);
  if (!forecast) return null;

  const endMs = now + HORIZON_HOURS * 3_600_000;
  const x = (ms: number) => PAD.left + ((ms - now) / (endMs - now)) * (W - PAD.left - PAD.right);
  const y = (pct: number) => PAD.top + (1 - pct / forecast.capacity) * (H - PAD.top - PAD.bottom);

  const line = forecast.points.map((p) => `${x(p.atMs).toFixed(1)},${y(p.remaining).toFixed(1)}`).join(' ');
  const area = `${x(now)},${y(0)} ${line} ${x(endMs)},${y(0)}`;
  const gridSteps = [0, 0.25, 0.5, 0.75, 1].map((f) => f * forecast.capacity);

  const midnights: number[] = [];
  for (let d = new Date(now).setHours(24, 0, 0, 0); d < endMs; d += DAY_MS) midnights.push(d);

  const lowest = forecast.points.reduce((low, p) => (p.remaining < low.remaining ? p : low));
  const nextReset = forecast.resets[0];

  return (
    <section className={styles.forecast} aria-label={t('quota_management.forecast_title')}>
      <div className={styles.head}>
        <p className={styles.total}>
          <span className={styles.value}>{Math.round(forecast.remaining)}%</span>
          <span className={styles.of}>
            {t('quota_management.forecast_of', { capacity: forecast.capacity })}
          </span>
        </p>
        <span className={styles.rate}>
          {t('quota_management.forecast_rate', { rate: forecast.drainPerHour.toFixed(1) })}
        </span>
        <span className={styles.title}>{t('quota_management.forecast_title')}</span>
      </div>

      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('quota_management.forecast_aria')}>
        {gridSteps.map((pct) => (
          <g key={pct}>
            <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(pct)} y2={y(pct)} />
            <text className={styles.axis} x={PAD.left - 8} y={y(pct) + 4} textAnchor="end">
              {Math.round(pct)}%
            </text>
          </g>
        ))}
        {midnights.map((ms) => (
          <text key={ms} className={styles.axis} x={x(ms)} y={H - 8} textAnchor="middle">
            {dayLabel(ms)}
          </text>
        ))}
        <polygon className={styles.area} points={area} />
        <polyline className={styles.line} points={line} />
        <line className={styles.now} x1={x(now)} x2={x(now)} y1={PAD.top} y2={y(0)} />
        <text className={styles.axis} x={x(now) + 6} y={PAD.top + 12}>
          {t('quota_management.forecast_now')}
        </text>
      </svg>

      <div className={styles.foot}>
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
      </div>
    </section>
  );
}
