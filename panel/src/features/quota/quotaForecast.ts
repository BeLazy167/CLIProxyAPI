/**
 * Where a provider's pooled window is heading.
 *
 * Each account projects on its own: it drains at its rate, holds at 0 once
 * empty, and refills to its cap at its own reset, every `periodHours` after.
 * The pool is the sum of those projections, never a separate formula.
 * Accounts without recorded history get no projection and no guessed rate.
 *
 * Pure and React-free; `nowMs` is passed in.
 */

import {
  currentSegment,
  recentBurnRate,
  RISE_NOISE,
  segmentAverageRate,
  windowAverageRate,
  type BurnRate,
  type Reading,
} from './drainSeries';

const HOUR_MS = 3_600_000;
const CAP = 100;
/** Float error on `value / perHour` can leave a hair above 0 at the reset; that is empty. */
const EMPTY_EPSILON = 1e-9;

export const BURN_WINDOW_HOURS = [1, 3, 6] as const;
export type BurnWindowHours = (typeof BURN_WINDOW_HOURS)[number];
export const FUTURE_USAGE = ['same', 'refill', 'average'] as const;
/**
 * `same`: the burn window's rate carries on. `refill`: the average since the
 * last refill does. `average`: the average since the window opened does.
 */
export type FutureUsage = (typeof FUTURE_USAGE)[number];

export interface ForecastOptions {
  usage: FutureUsage;
  burnHours: number;
}

/** Points are a polyline; a refill is two points at the same instant. */
export interface ForecastPoint {
  atMs: number;
  remaining: number;
}

export interface Refill {
  atMs: number;
  /** Percentage points returned at that instant. */
  restore: number;
}

export interface LiveWindow {
  remaining: number;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface AccountProjection {
  points: ForecastPoint[];
  refills: Refill[];
  /** First instant at 0; the start when already empty. Null when it never empties. */
  emptyAtMs: number | null;
}

export interface PoolProjection extends AccountProjection {
  /** Summed rate of the accounts that still have quota now. */
  drainPerHour: number;
}

/**
 * The rate an account projects with; null when it has no recorded history.
 *
 * Every reading, passive ones included, can mark a refill, so segments are cut
 * from all of them. Drain inside the segment comes from active polls only:
 * passive reads wobble by a point, which reads as fake drain.
 */
export function accountRate(
  live: LiveWindow,
  readings: readonly Reading[],
  nowMs: number,
  options: ForecastOptions
): BurnRate | null {
  if (readings.length === 0) return null;
  if (options.usage === 'average') {
    return windowAverageRate(live.remaining, live.resetAtMs, live.periodHours, nowMs);
  }
  const windowOpenMs =
    live.resetAtMs !== null && live.periodHours && live.resetAtMs > nowMs
      ? live.resetAtMs - live.periodHours * HOUR_MS
      : null;
  const segment = currentSegment(readings, windowOpenMs, nowMs).filter(
    (reading) => !reading.passive
  );
  return options.usage === 'refill'
    ? segmentAverageRate(segment, nowMs)
    : recentBurnRate(segment, nowMs, options.burnHours);
}

export function projectAccount(
  start: LiveWindow & { perHour: number },
  fromMs: number,
  toMs: number
): AccountProjection {
  const { perHour, periodHours } = start;
  let value = Math.min(CAP, Math.max(0, start.remaining));
  let resetMs = start.resetAtMs !== null && start.resetAtMs > fromMs ? start.resetAtMs : null;
  let emptyAtMs = value === 0 ? fromMs : null;
  const points: ForecastPoint[] = [{ atMs: fromMs, remaining: value }];
  const refills: Refill[] = [];

  for (let t = fromMs; t < toMs;) {
    const until = Math.min(resetMs ?? Infinity, toMs);
    const used = (perHour * (until - t)) / HOUR_MS;
    if (value > 0 && used >= value - EMPTY_EPSILON) {
      const hitMs = Math.min(until, t + (value / perHour) * HOUR_MS);
      if (hitMs < until) points.push({ atMs: hitMs, remaining: 0 });
      emptyAtMs ??= hitMs;
      value = 0;
    } else if (value > 0) {
      value -= used;
    }
    t = until;
    points.push({ atMs: t, remaining: value });
    if (t === resetMs) {
      refills.push({ atMs: t, restore: CAP - value });
      value = CAP;
      points.push({ atMs: t, remaining: value });
      resetMs = periodHours ? t + periodHours * HOUR_MS : null;
    }
  }
  return { points, refills, emptyAtMs };
}

/** Value on a projection polyline; `side` picks before or after a jump at `atMs`. */
export function valueAt(
  points: readonly ForecastPoint[],
  atMs: number,
  side: 'before' | 'after'
): number {
  if (atMs <= points[0].atMs) return points[0].remaining;
  const last = points[points.length - 1];
  if (atMs >= last.atMs) {
    if (side === 'after' || atMs > last.atMs) return last.remaining;
  }
  const index =
    side === 'before'
      ? points.findIndex((p) => p.atMs >= atMs)
      : points.length - 1 - [...points].reverse().findIndex((p) => p.atMs <= atMs);
  const p = points[index];
  if (p.atMs === atMs) return p.remaining;
  const [a, b] = side === 'before' ? [points[index - 1], p] : [p, points[index + 1]];
  return a.remaining + ((b.remaining - a.remaining) * (atMs - a.atMs)) / (b.atMs - a.atMs);
}

export function sumProjections(
  accounts: readonly { projection: AccountProjection; perHour: number }[]
): PoolProjection {
  const projections = accounts.map((account) => account.projection);
  const instants = [
    ...new Set(projections.flatMap((p) => p.points.map((point) => point.atMs))),
  ].sort((a, b) => a - b);
  const sum = (atMs: number, side: 'before' | 'after') =>
    projections.reduce((total, p) => total + valueAt(p.points, atMs, side), 0);

  const points: ForecastPoint[] = [];
  let emptyAtMs: number | null = null;
  for (const atMs of instants) {
    const before = sum(atMs, 'before');
    const after = sum(atMs, 'after');
    points.push({ atMs, remaining: before });
    if (after !== before) points.push({ atMs, remaining: after });
    if (emptyAtMs === null && Math.min(before, after) <= EMPTY_EPSILON) emptyAtMs = atMs;
  }

  const restoreAt = new Map<number, number>();
  projections.forEach((p) =>
    p.refills.forEach((refill) =>
      restoreAt.set(refill.atMs, (restoreAt.get(refill.atMs) ?? 0) + refill.restore)
    )
  );

  return {
    points,
    refills: [...restoreAt].sort(([a], [b]) => a - b).map(([atMs, restore]) => ({ atMs, restore })),
    emptyAtMs,
    drainPerHour: accounts.reduce(
      (total, account) =>
        total + (account.projection.points[0].remaining > 0 ? account.perHour : 0),
      0
    ),
  };
}

/** A reading older than this no longer stands for the account: the recording has a gap. */
const MAX_READING_AGE_MS = 3 * HOUR_MS;

/**
 * Recorded pool total: each account's latest reading summed at every step where
 * every account has a recent one. A gap in any account's recording ends a run.
 * A rise past the wobble at a step is a refill, labelled with the points it returned.
 */
export function poolHistory(
  accounts: readonly (readonly Reading[])[],
  fromMs: number,
  toMs: number,
  stepMs: number
): { runs: ForecastPoint[][]; refills: Refill[] } {
  const cursors = accounts.map(() => -1);
  const runs: ForecastPoint[][] = [];
  const refills: Refill[] = [];
  let run: ForecastPoint[] | null = null;
  for (let t = fromMs; t <= toMs; t += stepMs) {
    let total = 0;
    let complete = true;
    let restore = 0;
    accounts.forEach((readings, i) => {
      const before = cursors[i] >= 0 ? readings[cursors[i]].remaining : null;
      while (cursors[i] + 1 < readings.length && readings[cursors[i] + 1].atMs <= t)
        cursors[i] += 1;
      const latest = readings[cursors[i]];
      if (!latest || t - latest.atMs > MAX_READING_AGE_MS) {
        complete = false;
        return;
      }
      total += latest.remaining;
      if (before !== null && latest.remaining - before > RISE_NOISE)
        restore += latest.remaining - before;
    });
    if (!complete) {
      run = null;
      continue;
    }
    if (restore > 0 && runs.length > 0) refills.push({ atMs: t, restore });
    if (!run) runs.push((run = []));
    run.push({ atMs: t, remaining: total });
  }
  return { runs, refills };
}
