/**
 * One provider's drain card: pool figure, four stats, and a chart of the pool
 * as recorded (solid) and projected (dashed), with refill step-ups, the empty
 * point, optional per-account lines, and a hover readout. The arithmetic lives
 * in drainCard.ts and quotaForecast.ts; this file only draws it.
 */

import { useId, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaFileEntry } from '../logic';
import { formatCountdown } from '../compactDuration';
import { formatQuotaWindowLabel } from '../quotaWindows';
import { hourlyDrain } from '../drainSeries';
import { valueAt, type ForecastPoint } from '../quotaForecast';
import { steadyReadings, type DrainCardModel } from '../drainCard';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './QuotaDrain.module.scss';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const W = 1000;
const PAD = { left: 52, right: 14, top: 26, bottom: 28 };
const ACCOUNT_MIX = [100, 62, 38, 22];
const RUN_JOIN_MS = 30 * 60_000;
const LABEL_SLOTS = 40;

export type DrainTab = 'remaining' | 'drain';

export interface DrainCardProps {
  model: DrainCardModel;
  tab: DrainTab;
  burnHours: number;
  showAccounts: boolean;
  now: number;
  fromMs: number;
  toMs: number;
  resolvedTheme: ResolvedTheme;
  nameOf: (entry: QuotaFileEntry) => string;
}

const weekdayTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const weekdayDay = (ms: number) => {
  const date = new Date(ms);
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.getDate()}`;
};
const monthDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const percent = (value: number) => `${Math.round(value)}%`;
const polyline = (points: ForecastPoint[], x: (ms: number) => number, y: (v: number) => number) =>
  points.map((p) => `${x(p.atMs).toFixed(1)},${y(p.remaining).toFixed(1)}`).join(' ');

/** Projected drain as a step line: each pool segment's slope, in points per hour. */
function projectedDrain(points: readonly ForecastPoint[]): ForecastPoint[] {
  const steps: ForecastPoint[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [a, b] = [points[i], points[i + 1]];
    if (b.atMs <= a.atMs) continue;
    const rate = Math.max(0, (a.remaining - b.remaining) / ((b.atMs - a.atMs) / HOUR_MS));
    steps.push({ atMs: a.atMs, remaining: rate }, { atMs: b.atMs, remaining: rate });
  }
  return steps;
}

/** Refill labels closer than `minGapMs` would overlap: fold each into the one before it. */
function mergeLabels<T extends { atMs: number; restore: number; value: number }>(
  labels: T[],
  minGapMs: number
): T[] {
  const merged: T[] = [];
  for (const label of [...labels].sort((a, b) => a.atMs - b.atMs)) {
    const last = merged[merged.length - 1];
    if (last && label.atMs - last.atMs < minGapMs) {
      merged[merged.length - 1] = {
        ...label,
        restore: last.restore + label.restore,
        value: Math.max(last.value, label.value),
      };
    } else merged.push(label);
  }
  return merged;
}

/** Step value at `atMs` on a drain step line or a recorded series; null outside it. */
function stepAt(points: readonly ForecastPoint[], atMs: number): number | null {
  let value: number | null = null;
  for (const p of points) {
    if (p.atMs > atMs) break;
    value = p.remaining;
  }
  return value;
}

export function DrainCard({
  model,
  tab,
  burnHours,
  showAccounts,
  now,
  fromMs,
  toMs,
  resolvedTheme,
  nameOf,
}: DrainCardProps) {
  const { t } = useTranslation();
  const clipId = useId();
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const { pool, recorded, accounts } = model;
  const compact = model.size === 'compact';
  const H = compact ? 170 : 290;

  const colors = TYPE_COLORS[model.provider] ?? TYPE_COLORS.unknown;
  const accent = (resolvedTheme === 'dark' && colors.dark ? colors.dark : colors.light).text;

  const x = (ms: number) =>
    PAD.left + ((ms - fromMs) / (toMs - fromMs)) * (W - PAD.left - PAD.right);
  const inView = (ms: number) => ms >= fromMs && ms <= toMs;

  const pastBars =
    tab === 'drain'
      ? hourlyDrain(
          accounts.map((a) => steadyReadings(a.readings)),
          fromMs,
          Math.min(now, toMs)
        )
      : [];
  const futureDrain = projectedDrain(pool.points);
  const accountDrain = accounts.map((a) => ({
    past: hourlyDrain([steadyReadings(a.readings)], fromMs, Math.min(now, toMs)).map((bar) => ({
      atMs: bar.atMs + HOUR_MS / 2,
      remaining: bar.drain,
    })),
    future: projectedDrain(a.projection.points),
  }));
  const drainMax = Math.max(
    5,
    ...pastBars.map((bar) => bar.drain),
    ...futureDrain.filter((p) => inView(p.atMs)).map((p) => p.remaining)
  );
  const yMax = tab === 'drain' ? Math.ceil(drainMax / 5) * 5 : model.capacity;
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
  const unit = tab === 'drain' ? '%/h' : '%';

  const ticks: number[] = [];
  for (let d = new Date(fromMs).setHours(24, 0, 0, 0); d < toMs; d += DAY_MS) ticks.push(d);

  const projected = pool.points;
  // The latest run joins the projection when it reaches now; older runs end at a recording gap.
  const runs = recorded.runs.map((run, i) =>
    i === recorded.runs.length - 1 && now - run[run.length - 1].atMs <= RUN_JOIN_MS
      ? [...run, projected[0]]
      : run
  );
  const recordedAt = (atMs: number) => {
    const run = runs.find((r) => r[0].atMs <= atMs && atMs <= r[r.length - 1].atMs);
    return run ? stepAt(run, atMs) : null;
  };
  const refillLabels = mergeLabels(
    [
      ...recorded.refills.map((r) => ({ ...r, value: recordedAt(r.atMs) ?? 0 })),
      ...pool.refills.map((r) => ({ ...r, value: valueAt(pool.points, r.atMs, 'after') })),
    ].filter((r) => inView(r.atMs) && r.restore >= 0.5),
    (toMs - fromMs) / LABEL_SLOTS
  );
  const areaOf = (points: ForecastPoint[]) =>
    `${x(points[0].atMs)},${y(0)} ${polyline(points, x, y)} ${x(points[points.length - 1].atMs)},${y(0)}`;
  const emptyAt =
    pool.emptyAtMs !== null && pool.emptyAtMs > now && inView(pool.emptyAtMs)
      ? pool.emptyAtMs
      : null;

  const hover = (() => {
    if (hoverMs === null) return null;
    const isPast = hoverMs <= now;
    let value: number | null;
    if (tab === 'remaining') {
      value = isPast ? recordedAt(hoverMs) : valueAt(pool.points, hoverMs, 'after');
    } else {
      value = isPast
        ? (pastBars.find((bar) => hoverMs >= bar.atMs && hoverMs < bar.atMs + HOUR_MS)?.drain ??
          null)
        : stepAt(futureDrain, hoverMs);
    }
    if (value === null) return null;
    const kind = t(isPast ? 'quota_management.drain_recorded' : 'quota_management.drain_projected');
    const text =
      tab === 'remaining'
        ? t('quota_management.drain_hover_remaining', {
            when: weekdayTime(hoverMs),
            percent: Math.round(value),
            kind,
          })
        : t('quota_management.drain_hover_drain', {
            when: weekdayTime(hoverMs),
            rate: value.toFixed(1),
            kind,
          });
    return { atMs: hoverMs, value, text };
  })();

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * W;
    if (vx < PAD.left || vx > W - PAD.right) return setHoverMs(null);
    setHoverMs(fromMs + ((vx - PAD.left) / (W - PAD.left - PAD.right)) * (toMs - fromMs));
  };

  const horizonEnd = pool.points[pool.points.length - 1].atMs;
  const notBy = t('quota_management.drain_not_by', { when: monthDay(horizonEnd - 1) });
  const nextReset = pool.refills.find((r) => r.restore >= 0.5);
  const title = compact
    ? `${getTypeLabel(t, model.provider)} · ${formatQuotaWindowLabel(t, model.window.label)}`
    : getTypeLabel(t, model.provider);

  const stats = [
    {
      label: t('quota_management.drain_stat_pool_empty'),
      value:
        pool.emptyAtMs === null
          ? notBy
          : pool.emptyAtMs <= now
            ? t('quota_management.drain_now')
            : weekdayTime(pool.emptyAtMs),
    },
    {
      label: t('quota_management.drain_stat_first_empty'),
      value: model.firstEmpty
        ? t('quota_management.drain_first_empty', {
            name: nameOf(model.firstEmpty.account.entry),
            duration: formatCountdown(t, model.firstEmpty.atMs - now),
          })
        : notBy,
      note:
        model.emptyNowCount > 0
          ? t('quota_management.drain_empty_now', { count: model.emptyNowCount })
          : null,
    },
    {
      label: t('quota_management.drain_stat_next_reset'),
      value: nextReset
        ? t('quota_management.drain_next_reset', {
            percent: Math.round(nextReset.restore),
            when: weekdayTime(nextReset.atMs),
          })
        : t('quota_management.drain_none'),
    },
    {
      label: t('quota_management.drain_stat_burn', { hours: burnHours }),
      value: t(
        model.burn.estimated
          ? 'quota_management.drain_rate_estimated'
          : 'quota_management.drain_rate',
        {
          rate: model.burn.perHour.toFixed(1),
        }
      ),
    },
  ];

  return (
    <section
      className={compact ? `${styles.card} ${styles.compact}` : styles.card}
      style={{ '--drain-accent': accent } as CSSProperties}
      aria-label={title}
    >
      <header className={styles.cardHead}>
        <div className={styles.identity}>
          <p className={styles.name}>
            <ProviderGlyph provider={model.provider} resolvedTheme={resolvedTheme} />
            <span>{title}</span>
            <span className={styles.count}>
              {t('quota_management.drain_accounts_count', { count: model.window.reportedCount })}
            </span>
          </p>
          <p className={styles.total}>
            <span className={styles.value}>{percent(model.liveRemaining)}</span>
            <span className={styles.of}>
              {t('quota_management.drain_of', { capacity: model.capacity })}
            </span>
          </p>
          {model.unrecordedCount > 0 && (
            <p className={styles.note}>
              {t('quota_management.drain_unrecorded', { count: model.unrecordedCount })}
            </p>
          )}
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.stat}>
              <dt>{stat.label}</dt>
              <dd>
                {stat.value}
                {stat.note && <span className={styles.statNote}>{stat.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div className={styles.plot}>
        {hover && <div className={styles.readout}>{hover.text}</div>}
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t(`quota_management.drain_aria_${tab}`, { name: title })}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverMs(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={PAD.left}
                y={0}
                width={W - PAD.left - PAD.right}
                height={H - PAD.bottom + 1}
              />
            </clipPath>
            <linearGradient id={`${clipId}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className={styles.fillTop} />
              <stop offset="100%" className={styles.fillBottom} />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                className={styles.grid}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(f * yMax)}
                y2={y(f * yMax)}
              />
              <text className={styles.axis} x={PAD.left - 8} y={y(f * yMax) + 4} textAnchor="end">
                {Number((f * yMax).toFixed(1))}
                {unit}
              </text>
            </g>
          ))}
          {ticks.map((ms) => (
            <g key={ms}>
              <line className={styles.dayLine} x1={x(ms)} x2={x(ms)} y1={PAD.top} y2={y(0)} />
              {!compact || new Date(ms).getDay() % 2 === 0 ? (
                <text className={styles.axis} x={x(ms + DAY_MS / 2)} y={H - 8} textAnchor="middle">
                  {weekdayDay(ms)}
                </text>
              ) : null}
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {tab === 'remaining' ? (
              <>
                {[...runs, projected].map((points, i) => (
                  <polygon key={i} fill={`url(#${clipId}-fill)`} points={areaOf(points)} />
                ))}
                {showAccounts &&
                  accounts.map((a, i) => (
                    <g
                      key={i}
                      style={
                        {
                          '--account-mix': `${ACCOUNT_MIX[i % ACCOUNT_MIX.length]}%`,
                        } as CSSProperties
                      }
                    >
                      {a.recorded.map((run, r) => (
                        <polyline
                          key={r}
                          className={styles.accountPast}
                          points={polyline(run, x, y)}
                        />
                      ))}
                      <polyline
                        className={styles.accountProjected}
                        points={polyline(a.projection.points, x, y)}
                      />
                    </g>
                  ))}
                {runs.map((run, i) => (
                  <polyline key={i} className={styles.past} points={polyline(run, x, y)} />
                ))}
                <polyline className={styles.projected} points={polyline(projected, x, y)} />
                {refillLabels.map((r) => (
                  <text
                    key={`${r.atMs}-${r.restore}`}
                    className={styles.refill}
                    x={x(r.atMs)}
                    y={y(r.value) - 7}
                    textAnchor="middle"
                  >
                    +{Math.round(r.restore)}%
                  </text>
                ))}
                {emptyAt !== null && (
                  <g>
                    <circle className={styles.emptyDot} cx={x(emptyAt)} cy={y(0)} r={5} />
                    <text
                      className={styles.emptyLabel}
                      x={x(emptyAt)}
                      y={y(0) - 12}
                      textAnchor="middle"
                    >
                      {t('quota_management.drain_empty_at', { when: weekdayTime(emptyAt) })}
                    </text>
                  </g>
                )}
              </>
            ) : (
              <>
                {pastBars.map((bar) => (
                  <rect
                    key={bar.atMs}
                    className={styles.bar}
                    x={x(bar.atMs) + 1}
                    y={y(bar.drain)}
                    width={Math.max(1, x(bar.atMs + HOUR_MS) - x(bar.atMs) - 2)}
                    height={y(0) - y(bar.drain)}
                  />
                ))}
                {showAccounts &&
                  accountDrain.map((a, i) => (
                    <g
                      key={i}
                      style={
                        {
                          '--account-mix': `${ACCOUNT_MIX[i % ACCOUNT_MIX.length]}%`,
                        } as CSSProperties
                      }
                    >
                      <polyline className={styles.accountPast} points={polyline(a.past, x, y)} />
                      <polyline
                        className={styles.accountProjected}
                        points={polyline(a.future, x, y)}
                      />
                    </g>
                  ))}
                <polyline className={styles.projected} points={polyline(futureDrain, x, y)} />
              </>
            )}
          </g>

          {inView(now) && (
            <g>
              <line className={styles.now} x1={x(now)} x2={x(now)} y1={PAD.top - 6} y2={y(0)} />
              <text className={styles.axis} x={x(now)} y={PAD.top - 12} textAnchor="middle">
                {t('quota_management.drain_now')}
              </text>
              {tab === 'remaining' && (
                <circle
                  className={styles.nowDot}
                  cx={x(now)}
                  cy={y(projected[0].remaining)}
                  r={4}
                />
              )}
            </g>
          )}
          {hover && (
            <g>
              <line
                className={styles.hoverLine}
                x1={x(hover.atMs)}
                x2={x(hover.atMs)}
                y1={PAD.top}
                y2={y(0)}
              />
              <circle className={styles.nowDot} cx={x(hover.atMs)} cy={y(hover.value)} r={4} />
            </g>
          )}
        </svg>
      </div>

      <footer className={styles.legend}>
        <span className={styles.legendTitle}>{t('quota_management.drain_legend_pool')}</span>
        <span>
          <i className={styles.solid} /> {t('quota_management.drain_legend_recorded')}
        </span>
        <span>
          <i className={styles.dash} /> {t('quota_management.drain_legend_projected')}
        </span>
        {showAccounts &&
          accounts.map((a, i) => (
            <span
              key={i}
              style={
                { '--account-mix': `${ACCOUNT_MIX[i % ACCOUNT_MIX.length]}%` } as CSSProperties
              }
            >
              <i className={styles.accountSwatch} /> {nameOf(a.entry)}
            </span>
          ))}
      </footer>
    </section>
  );
}
