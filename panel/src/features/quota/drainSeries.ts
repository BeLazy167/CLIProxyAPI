/**
 * Recorded quota readings for one account and one window, and how fast it drains.
 *
 * A series splits into segments at every refill (a natural reset or a claimed
 * one): the remaining figure only falls inside a segment, so a rate never spans
 * a jump. The recent rate is a Theil-Sen slope (median of pair slopes), which
 * shrugs off the one-point wobble of passive readings and single outliers.
 *
 * Pure and React-free; `nowMs` is passed in.
 */

const HOUR_MS = 3_600_000;
/** Passive readings wobble by a point; a larger rise is a refill. */
export const RISE_NOISE = 2;
const MIN_RECENT_READINGS = 3;

/** One Lamplighter history series: `[unix seconds, remaining %, 1 when read passively off live traffic]`. */
export interface QuotaHistorySeries {
  auth_index: string;
  window: string;
  points: [number, number, number][];
}

export interface Reading {
  atMs: number;
  remaining: number;
  passive: boolean;
}

export type RateBasis =
  /** Theil-Sen slope over the burn window. */
  | 'recent'
  /** Too few readings in the burn window: average over the current segment. */
  | 'segment'
  /** Used share over hours since the window opened. */
  | 'window';

export interface BurnRate {
  /** Percentage points used per hour, never negative. */
  perHour: number;
  basis: RateBasis;
}

export interface DrainBar {
  atMs: number;
  drain: number;
}

/** One account's readings of `window`, oldest first; an active poll wins over a passive read at the same instant. */
export function readingsOf(
  series: readonly QuotaHistorySeries[],
  authIndex: string,
  window: string
): Reading[] {
  const byInstant = new Map<number, Reading>();
  for (const s of series) {
    if (s.auth_index !== authIndex || s.window !== window) continue;
    for (const [t, remaining, passive] of s.points) {
      const reading = { atMs: t * 1000, remaining, passive: passive === 1 };
      const held = byInstant.get(reading.atMs);
      if (!held || (held.passive && !reading.passive)) byInstant.set(reading.atMs, reading);
    }
  }
  return [...byInstant.values()].sort((a, b) => a.atMs - b.atMs);
}

export function splitSegments(readings: readonly Reading[]): Reading[][] {
  const segments: Reading[][] = [];
  readings.forEach((reading, i) => {
    if (i === 0 || reading.remaining - readings[i - 1].remaining > RISE_NOISE) segments.push([]);
    segments[segments.length - 1].push(reading);
  });
  return segments;
}

/**
 * Readings of the window that is open at `nowMs`: none after now, none from
 * before the live window opened (history may not have seen that refill yet),
 * and only the last segment.
 */
export function currentSegment(
  readings: readonly Reading[],
  windowOpenMs: number | null,
  nowMs: number
): Reading[] {
  const open = readings.filter(
    (reading) => reading.atMs <= nowMs && (windowOpenMs === null || reading.atMs >= windowOpenMs)
  );
  const segments = splitSegments(open);
  return segments[segments.length - 1] ?? [];
}

/** Median slope over every pair of readings, in points per hour. Null without two distinct instants. */
export function theilSenPerHour(readings: readonly Reading[]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < readings.length; i += 1) {
    for (let j = i + 1; j < readings.length; j += 1) {
      const hours = (readings[j].atMs - readings[i].atMs) / HOUR_MS;
      if (hours > 0) slopes.push((readings[j].remaining - readings[i].remaining) / hours);
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  return slopes.length % 2 === 1 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

/**
 * Drain over the last `windowHours` of the current segment, falling back to the
 * segment average when the window holds too few readings. Readings after the
 * account first hit 0 say nothing about its pace, so they are dropped first.
 */
export function recentBurnRate(
  segment: readonly Reading[],
  nowMs: number,
  windowHours: number
): BurnRate | null {
  const draining = drainingPart(segment, nowMs);
  const fromMs = nowMs - windowHours * HOUR_MS;
  const recent = draining.filter((reading) => reading.atMs >= fromMs);
  const span = recent.length > 0 ? recent[recent.length - 1].atMs - recent[0].atMs : 0;
  if (recent.length >= MIN_RECENT_READINGS && span >= (windowHours * HOUR_MS) / 2) {
    const slope = theilSenPerHour(recent) as number;
    return { perHour: Math.max(0, -slope), basis: 'recent' };
  }
  return segmentAverageRate(segment, nowMs);
}

/** Readings up to now, cut after the first 0: once empty, an account says nothing about its pace. */
function drainingPart(segment: readonly Reading[], nowMs: number): Reading[] {
  const past = segment.filter((reading) => reading.atMs <= nowMs);
  const firstEmpty = past.findIndex((reading) => reading.remaining <= 0);
  return firstEmpty === -1 ? past : past.slice(0, firstEmpty + 1);
}

/** Average drain from the segment's first reading to its last before the account emptied. */
export function segmentAverageRate(segment: readonly Reading[], nowMs: number): BurnRate | null {
  const draining = drainingPart(segment, nowMs);
  const first = draining[0];
  const last = draining[draining.length - 1];
  if (!first || last.atMs <= first.atMs) return null;
  const hours = (last.atMs - first.atMs) / HOUR_MS;
  return { perHour: Math.max(0, (first.remaining - last.remaining) / hours), basis: 'segment' };
}

/** Average drain since the window opened. Under an hour of data is too noisy, so it reads as no drain. */
export function windowAverageRate(
  remaining: number,
  resetAtMs: number | null,
  periodHours: number | null,
  nowMs: number
): BurnRate | null {
  if (resetAtMs === null || !periodHours || resetAtMs <= nowMs) return null;
  const elapsedHours = periodHours - (resetAtMs - nowMs) / HOUR_MS;
  const perHour = elapsedHours < 1 ? 0 : Math.max(0, 100 - remaining) / elapsedHours;
  return { perHour, basis: 'window' };
}

/** Percentage points used per clock hour across accounts. Rises are refills or wobble, not use. */
export function hourlyDrain(
  accounts: readonly (readonly Reading[])[],
  fromMs: number,
  toMs: number
): DrainBar[] {
  const startHour = Math.floor(fromMs / HOUR_MS) * HOUR_MS;
  const bars: DrainBar[] = [];
  for (let t = startHour; t < toMs; t += HOUR_MS) bars.push({ atMs: t, drain: 0 });
  for (const readings of accounts) {
    for (let i = 1; i < readings.length; i += 1) {
      const drop = readings[i - 1].remaining - readings[i].remaining;
      const bar = bars[Math.floor((readings[i].atMs - startHour) / HOUR_MS)];
      if (drop > 0 && bar) bar.drain += drop;
    }
  }
  return bars;
}
