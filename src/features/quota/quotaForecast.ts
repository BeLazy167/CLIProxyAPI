/**
 * Pool forecast: where a provider's summed window is heading.
 *
 * Each reporting member drains at its own average rate since its window opened
 * (used % / hours elapsed) and refills to 100% at each reset, every `periodHours`.
 * Only figures the panel already has are used; nothing is invented for members
 * that are not reporting.
 *
 * Pure and React-free; `nowMs` is passed in.
 */

import type { PoolWindow } from './quotaPool';

const HOUR_MS = 3_600_000;

export interface ForecastPoint {
  atMs: number;
  remaining: number;
}

export interface PoolForecast {
  capacity: number;
  remaining: number;
  /** Summed drain of all reporting members, percentage points per hour. */
  drainPerHour: number;
  points: ForecastPoint[];
  /** Instants where at least one member refills, with the points restored. */
  resets: { atMs: number; restore: number }[];
}

interface Lane {
  remaining: number;
  ratePerHour: number;
  nextResetMs: number | null;
}

/** Average drain since the window opened. Under an hour of data is too noisy to project. */
export function burnRatePerHour(
  remaining: number,
  resetAtMs: number | null,
  periodHours: number,
  nowMs: number
): number {
  if (resetAtMs === null || resetAtMs <= nowMs) return 0;
  const elapsedHours = periodHours - (resetAtMs - nowMs) / HOUR_MS;
  if (elapsedHours < 1) return 0;
  return Math.max(0, 100 - remaining) / elapsedHours;
}

/** One Lamplighter history series: `[unix seconds, remaining %, 1 when read passively off live traffic]`. */
export interface QuotaHistorySeries {
  auth_index: string;
  window: string;
  points: [number, number, number][];
}

export interface DrainBar {
  atMs: number;
  drain: number;
}

/**
 * Active polls of `window` for each account, oldest first. Passive readings come
 * off live traffic and wobble by a point (97, 98, 97), which would read as fake
 * drain, so they are used only when an account has no active poll at all.
 */
function samplesByAccount(series: readonly QuotaHistorySeries[], authIndexes: readonly string[], window: string) {
  return authIndexes.map((authIndex) => {
    const points = series
      .filter((s) => s.auth_index === authIndex && s.window === window)
      .flatMap((s) => s.points);
    const active = points.filter((p) => p[2] === 0);
    return (active.length > 0 ? active : points)
      .map(([t, remaining]) => ({ atMs: t * 1000, remaining }))
      .sort((a, b) => a.atMs - b.atMs);
  });
}

/** Pool total over time: each account's latest sample summed, from the first step where every account has one. */
export function buildPoolHistory(
  series: readonly QuotaHistorySeries[],
  authIndexes: readonly string[],
  window: string,
  fromMs: number,
  toMs: number,
  stepMs = 15 * 60_000
): ForecastPoint[] {
  const accounts = samplesByAccount(series, authIndexes, window);
  const cursors = accounts.map(() => -1);
  const points: ForecastPoint[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    let total = 0;
    let complete = true;
    accounts.forEach((samples, i) => {
      while (cursors[i] + 1 < samples.length && samples[cursors[i] + 1].atMs <= t) cursors[i] += 1;
      if (cursors[i] < 0) complete = false;
      else total += samples[cursors[i]].remaining;
    });
    if (complete) points.push({ atMs: t, remaining: total });
  }
  return points;
}

/** Percentage points used per hour across the accounts. Rises (resets) are not use, so they are skipped. */
export function buildHourlyDrain(
  series: readonly QuotaHistorySeries[],
  authIndexes: readonly string[],
  window: string,
  fromMs: number,
  toMs: number
): DrainBar[] {
  const startHour = Math.floor(fromMs / HOUR_MS) * HOUR_MS;
  const bars: DrainBar[] = [];
  for (let t = startHour; t < toMs; t += HOUR_MS) bars.push({ atMs: t, drain: 0 });
  for (const samples of samplesByAccount(series, authIndexes, window)) {
    for (let i = 1; i < samples.length; i += 1) {
      const drop = samples[i - 1].remaining - samples[i].remaining;
      const bar = bars[Math.floor((samples[i].atMs - startHour) / HOUR_MS)];
      if (drop > 0 && bar) bar.drain += drop;
    }
  }
  return bars;
}

export function buildPoolForecast(
  window: PoolWindow,
  nowMs: number,
  horizonHours: number,
  stepHours = 1
): PoolForecast | null {
  const period = window.periodHours;
  const reported = window.members.filter((member) => member.status === 'reported');
  if (!period || reported.length === 0) return null;

  // ponytail: each account keeps its own pace; routing that shifts load off an
  // empty account (Quota Pacer) is not modeled, so empty accounts just flatline.
  const lanes: Lane[] = reported.map((member) => {
    const remaining = member.remainingPercent as number;
    return {
      remaining,
      ratePerHour: burnRatePerHour(remaining, member.resetAtMs, period, nowMs),
      nextResetMs: member.resetAtMs !== null && member.resetAtMs > nowMs ? member.resetAtMs : null,
    };
  });

  const sum = () => lanes.reduce((total, lane) => total + lane.remaining, 0);
  const points: ForecastPoint[] = [{ atMs: nowMs, remaining: sum() }];
  const resets = new Map<number, number>();
  const endMs = nowMs + horizonHours * HOUR_MS;

  for (let t = nowMs; t < endMs; ) {
    const stepEnd = Math.min(t + stepHours * HOUR_MS, endMs);
    // Stop the step at the next reset so the jump lands on its real instant.
    const nextReset = Math.min(
      ...lanes.map((lane) => (lane.nextResetMs !== null && lane.nextResetMs <= stepEnd ? lane.nextResetMs : Infinity))
    );
    const until = Number.isFinite(nextReset) ? nextReset : stepEnd;
    const hours = (until - t) / HOUR_MS;
    for (const lane of lanes) lane.remaining = Math.max(0, lane.remaining - lane.ratePerHour * hours);
    t = until;

    if (Number.isFinite(nextReset)) {
      points.push({ atMs: t, remaining: sum() });
      for (const lane of lanes) {
        if (lane.nextResetMs !== t) continue;
        resets.set(t, (resets.get(t) ?? 0) + (100 - lane.remaining));
        lane.remaining = 100;
        lane.nextResetMs = t + period * HOUR_MS;
      }
    }
    points.push({ atMs: t, remaining: sum() });
  }

  return {
    capacity: window.capacity,
    remaining: points[0].remaining,
    drainPerHour: lanes.reduce((total, lane) => total + lane.ratePerHour, 0),
    points,
    resets: [...resets].map(([atMs, restore]) => ({ atMs, restore })),
  };
}
