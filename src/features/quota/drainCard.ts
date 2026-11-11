/**
 * One drain card: a provider's pooled window joined with its recorded history.
 *
 * The live quota state gives each account's figure and reset instant; the
 * Lamplighter history gives its pace. Accounts with no recorded readings are
 * left out of every projected figure and counted instead.
 *
 * Pure and React-free; `nowMs` is passed in.
 */

import type { QuotaFileEntry } from './logic';
import type { PoolWindow } from './quotaPool';
import type { QuotaProviderType } from './providers/types';
import { readingsOf, type BurnRate, type QuotaHistorySeries, type Reading } from './drainSeries';
import {
  accountRate,
  poolHistory,
  projectAccount,
  sumProjections,
  type AccountProjection,
  type ForecastOptions,
  type ForecastPoint,
  type PoolProjection,
  type Refill,
} from './quotaForecast';

const HISTORY_STEP_MS = 15 * 60_000;
/** Stats look at least this far ahead, even when the drawn range ends sooner. */
const MIN_HORIZON_MS = 7 * 24 * 3_600_000;

/** Pool windows that have a drain card, and the window id Lamplighter records them under. */
export const DRAIN_WINDOWS: readonly {
  poolKey: string;
  history: string;
  size: 'full' | 'compact';
}[] = [
  { poolKey: 'claude:seven-day', history: 'seven-day', size: 'full' },
  { poolKey: 'claude:seven-day-fable', history: 'seven-day-fable', size: 'compact' },
  { poolKey: 'codex:codex_quota.secondary_window', history: 'seven-day', size: 'full' },
  { poolKey: 'xai:weekly', history: 'seven-day', size: 'full' },
];

export interface DrainAccount {
  entry: QuotaFileEntry;
  remaining: number;
  /** Every reading in the drawn range: passive reads fill the gaps between active polls. */
  readings: Reading[];
  /** The account's recorded line, split at recording gaps. */
  recorded: ForecastPoint[][];
  rate: BurnRate;
  /** The burn window's own rate, for the "burn, last N h" figure. */
  recent: BurnRate | null;
  projection: AccountProjection;
}

export interface DrainCardModel {
  provider: QuotaProviderType;
  window: PoolWindow;
  size: 'full' | 'compact';
  accounts: DrainAccount[];
  /** Reported accounts with no recorded readings: not projected. */
  unrecordedCount: number;
  liveRemaining: number;
  capacity: number;
  pool: PoolProjection;
  recorded: { runs: ForecastPoint[][]; refills: Refill[] };
  /** Summed recent rate of accounts that still have quota; `estimated` when any fell back to a segment average. */
  burn: { perHour: number; estimated: boolean };
  firstEmpty: { account: DrainAccount; atMs: number } | null;
  emptyNowCount: number;
}

/** Active polls when there are any: passive reads wobble by a point, which reads as fake drain. */
export function steadyReadings(readings: readonly Reading[]): Reading[] {
  const active = readings.filter((reading) => !reading.passive);
  return active.length > 0 ? active : [...readings];
}

export function buildDrainCard(input: {
  provider: QuotaProviderType;
  window: PoolWindow;
  history: string;
  size: 'full' | 'compact';
  authIndexOf: (entry: QuotaFileEntry) => string | null;
  /** Recent history for rates; covers at least the current window. */
  rateSeries: readonly QuotaHistorySeries[];
  /** History for the drawn range; may be coarser and longer. */
  drawSeries: readonly QuotaHistorySeries[];
  nowMs: number;
  fromMs: number;
  toMs: number;
  options: ForecastOptions;
}): DrainCardModel | null {
  const { window, nowMs, options } = input;
  const reported = window.members.filter((member) => member.status === 'reported');
  const accounts: DrainAccount[] = [];
  let unrecordedCount = 0;
  const horizonMs = Math.max(input.toMs, nowMs + MIN_HORIZON_MS);

  const historyFrom = Math.ceil(input.fromMs / HISTORY_STEP_MS) * HISTORY_STEP_MS;
  const historyTo = Math.min(nowMs, input.toMs);
  const recordedOf = (readings: readonly (readonly Reading[])[]) =>
    poolHistory(readings, historyFrom, historyTo, HISTORY_STEP_MS);

  for (const member of reported) {
    const authIndex = input.authIndexOf(member.entry);
    const rateReadings = authIndex
      ? steadyReadings(readingsOf(input.rateSeries, authIndex, input.history))
      : [];
    const live = {
      remaining: member.remainingPercent as number,
      resetAtMs: member.resetAtMs,
      periodHours: window.periodHours,
    };
    const rate = accountRate(live, rateReadings, nowMs, options);
    if (!authIndex || !rate) {
      unrecordedCount += 1;
      continue;
    }
    const readings = readingsOf(input.drawSeries, authIndex, input.history);
    accounts.push({
      entry: member.entry,
      remaining: live.remaining,
      readings,
      recorded: recordedOf([readings]).runs,
      rate,
      recent: accountRate(live, rateReadings, nowMs, { ...options, usage: 'same' }),
      projection: projectAccount({ ...live, perHour: rate.perHour }, nowMs, horizonMs),
    });
  }
  if (accounts.length === 0) return null;

  const pool = sumProjections(
    accounts.map((a) => ({ projection: a.projection, perHour: a.rate.perHour }))
  );
  const draining = accounts.filter((a) => a.remaining > 0);
  const firstEmpty = draining
    .filter((a) => a.projection.emptyAtMs !== null)
    .map((account) => ({ account, atMs: account.projection.emptyAtMs as number }))
    .sort((a, b) => a.atMs - b.atMs)[0];

  return {
    provider: input.provider,
    window,
    size: input.size,
    accounts,
    unrecordedCount,
    liveRemaining: window.totalRemaining ?? 0,
    capacity: window.capacity,
    pool,
    recorded: recordedOf(accounts.map((a) => a.readings)),
    burn: {
      perHour: draining.reduce((sum, a) => sum + (a.recent?.perHour ?? 0), 0),
      estimated: draining.some((a) => a.recent?.basis !== 'recent'),
    },
    firstEmpty: firstEmpty ?? null,
    emptyNowCount: accounts.length - draining.length,
  };
}
