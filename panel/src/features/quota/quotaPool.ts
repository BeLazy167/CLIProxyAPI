/**
 * Provider pools: per-provider sums of like-for-like quota windows.
 *
 * "5 Claude accounts, 409% of 500% left on the 7-day window" answers a question
 * no single card can — how much of the provider is still usable — but only if
 * the sum is honest:
 *
 * - Windows pool only with the same window identity (`NormalizedQuotaWindow.key`)
 *   inside one provider. A 5-hour limit never adds to a weekly one, and a
 *   model-scoped weekly limit never adds to the shared weekly limit.
 * - The capacity is 100% per *reporting* member. An account that hasn't
 *   loaded, failed, or loaded without a figure is counted as unknown — it is
 *   neither assumed exhausted (0%) nor healthy (100%).
 * - An account that loaded fine but simply has no such window (a model limit
 *   only some plans carry) is "absent": excluded from the pool and called out.
 *
 * Pure and React-free; `nowMs` is passed in.
 */

import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';
import { normalizeQuotaWindows, type QuotaWindowLabel } from './quotaWindows';
import { QUOTA_TAB_ORDER } from './constants';

export type PoolMemberStatus =
  /** Loaded, window present, percentage reported. */
  | 'reported'
  /** Loaded, window present, but no percentage in the payload. */
  | 'unreported'
  /** Loaded, and this account has no such window. */
  | 'absent'
  | 'loading'
  | 'error'
  | 'idle';

export interface PoolMember {
  entry: QuotaFileEntry;
  status: PoolMemberStatus;
  remainingPercent: number | null;
  resetAtMs: number | null;
}

/** Reset instants this close together are reported as one event. */
export const RESET_GROUP_TOLERANCE_MS = 60_000;

export interface PoolNextReset {
  atMs: number;
  /** Percentage points returned to the pool at that instant. */
  restorePercent: number;
  accountCount: number;
}

export interface PoolWindow {
  key: string;
  label: QuotaWindowLabel;
  periodHours: number | null;
  /** Every credential of the provider except those where the window is absent. */
  members: PoolMember[];
  reportedCount: number;
  /** Members still unknown: idle, loading, error, or loaded without a figure. */
  unknownCount: number;
  absentCount: number;
  /** Sum of reported remaining percentages. Null when nothing is reported. */
  totalRemaining: number | null;
  /** 100 per reporting member. */
  capacity: number;
  /** Soonest future reset that actually returns capacity. */
  nextReset: PoolNextReset | null;
  /**
   * When every depleted reporting member has reset. Null when any depleted
   * member lacks a future reset instant, or nothing is depleted.
   */
  allResetAtMs: number | null;
  /** Depleted members whose reported reset already passed — their figure is stale. */
  staleCount: number;
}

export interface ProviderPool {
  provider: QuotaProviderType;
  credentialCount: number;
  statusCounts: Record<'idle' | 'loading' | 'success' | 'error', number>;
  /** Load status per credential, for a summary drawn before any window is known. */
  credentials: { entry: QuotaFileEntry; status: 'idle' | 'loading' | 'success' | 'error' }[];
  /** Ranked by `comparePoolWindows`; ties keep first-appearance order. */
  windows: PoolWindow[];
  /** The window the summary leads with; null when no window is known yet. */
  primaryKey: string | null;
}

type QuotaLookup = (entry: QuotaFileEntry) => { status?: string } | undefined;

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const statusOf = (quota: { status?: string } | undefined): LoadStatus => {
  const status = quota?.status;
  return status === 'loading' || status === 'success' || status === 'error' ? status : 'idle';
};

function summarizeWindow(
  key: string,
  label: QuotaWindowLabel,
  periodHours: number | null,
  members: PoolMember[],
  absentCount: number,
  nowMs: number
): PoolWindow {
  const reported = members.filter((member) => member.status === 'reported');
  const totalRemaining =
    reported.length === 0
      ? null
      : reported.reduce((sum, member) => sum + (member.remainingPercent as number), 0);

  const depleted = reported.filter((member) => (member.remainingPercent as number) < 100);
  const upcoming = depleted.filter(
    (member) => member.resetAtMs !== null && member.resetAtMs > nowMs
  );
  const staleCount = depleted.filter(
    (member) => member.resetAtMs !== null && member.resetAtMs <= nowMs
  ).length;

  let nextReset: PoolNextReset | null = null;
  if (upcoming.length > 0) {
    const atMs = Math.min(...upcoming.map((member) => member.resetAtMs as number));
    const group = upcoming.filter(
      (member) => (member.resetAtMs as number) - atMs <= RESET_GROUP_TOLERANCE_MS
    );
    nextReset = {
      atMs,
      restorePercent: group.reduce(
        (sum, member) => sum + (100 - (member.remainingPercent as number)),
        0
      ),
      accountCount: group.length,
    };
  }

  const allResetAtMs =
    depleted.length > 0 && upcoming.length === depleted.length
      ? Math.max(...upcoming.map((member) => member.resetAtMs as number))
      : null;

  return {
    key,
    label,
    periodHours,
    members,
    reportedCount: reported.length,
    unknownCount: members.length - reported.length,
    absentCount,
    totalRemaining,
    capacity: reported.length * 100,
    nextReset,
    allResetAtMs,
    staleCount,
  };
}

/**
 * Rank windows for display: most members reporting first, then the longest
 * period, then the most constrained (lowest share remaining). Windows nobody
 * reported sink to the end.
 *
 * Period outranks tightness so the summary leads with the limit that governs
 * the week (Claude's model-scoped 7-day window, Codex's weekly limit) rather
 * than a 5-hour window that is back within hours; the 5-hour window still
 * shows in the list below. Among equal periods the tighter limit wins — a
 * model-scoped weekly window at 82% outranks the shared weekly one at 91%.
 */
export function comparePoolWindows(a: PoolWindow, b: PoolWindow): number {
  if (a.reportedCount !== b.reportedCount) return b.reportedCount - a.reportedCount;
  if (a.reportedCount === 0) return 0;
  const period = (b.periodHours ?? 0) - (a.periodHours ?? 0);
  if (period !== 0) return period;
  return (a.totalRemaining as number) / a.capacity - (b.totalRemaining as number) / b.capacity;
}

/** The window a pool summary leads with; null when nothing is reported yet. */
export function pickPrimaryWindow(windows: readonly PoolWindow[]): PoolWindow | null {
  const [best] = [...windows].sort(comparePoolWindows);
  return best && best.reportedCount > 0 ? best : null;
}

/** Pool one provider's credentials. `entries` must all belong to `provider`. */
export function buildProviderPool(
  provider: QuotaProviderType,
  entries: readonly QuotaFileEntry[],
  quotaFor: QuotaLookup,
  nowMs: number
): ProviderPool {
  const statusCounts = { idle: 0, loading: 0, success: 0, error: 0 };
  const perEntry = entries.map((entry) => {
    const quota = quotaFor(entry);
    const status = statusOf(quota);
    statusCounts[status] += 1;
    return { entry, status, windows: normalizeQuotaWindows(provider, quota) };
  });

  // Window identities in first-appearance order, with the first label seen.
  const order: { key: string; label: QuotaWindowLabel; periodHours: number | null }[] = [];
  const seen = new Set<string>();
  perEntry.forEach(({ windows }) =>
    windows.forEach((window) => {
      if (seen.has(window.key)) return;
      seen.add(window.key);
      order.push({ key: window.key, label: window.label, periodHours: window.periodHours });
    })
  );

  const windows = order.map(({ key, label, periodHours }) => {
    let absentCount = 0;
    const members: PoolMember[] = [];
    perEntry.forEach(({ entry, status, windows: own }) => {
      if (status !== 'success') {
        members.push({ entry, status, remainingPercent: null, resetAtMs: null });
        return;
      }
      const match = own.find((window) => window.key === key);
      if (!match) {
        absentCount += 1;
        return;
      }
      members.push({
        entry,
        status: match.remainingPercent === null ? 'unreported' : 'reported',
        remainingPercent: match.remainingPercent,
        resetAtMs: match.resetAtMs,
      });
    });
    return summarizeWindow(key, label, periodHours, members, absentCount, nowMs);
  });
  // Array#sort is stable, so equal-ranked windows keep payload order.
  windows.sort(comparePoolWindows);

  return {
    provider,
    credentialCount: entries.length,
    statusCounts,
    credentials: perEntry.map(({ entry, status }) => ({ entry, status })),
    windows,
    primaryKey: windows[0] && windows[0].reportedCount > 0 ? windows[0].key : null,
  };
}

/** One pool per provider present in `entries`, in tab order. */
export function buildProviderPools(
  entries: readonly QuotaFileEntry[],
  quotaFor: QuotaLookup,
  nowMs: number
): ProviderPool[] {
  return QUOTA_TAB_ORDER.map((provider) => {
    const own = entries.filter((entry) => entry.type === provider);
    return own.length === 0 ? null : buildProviderPool(provider, own, quotaFor, nowMs);
  }).filter((pool): pool is ProviderPool => pool !== null);
}

/**
 * Column layout for one provider's ledger rows: every window identity any of
 * the rows reports. Rows lacking a column render an explicit "not reported"
 * cell so columns stay aligned across accounts.
 *
 * `preferredOrder` (normally the provider pool's ranked window keys) puts the
 * columns in the same order as the summary above; keys it doesn't know follow
 * in first-appearance order.
 */
export function ledgerColumns(
  provider: QuotaProviderType,
  entries: readonly QuotaFileEntry[],
  quotaFor: QuotaLookup,
  preferredOrder: readonly string[] = []
): { key: string; label: QuotaWindowLabel }[] {
  const columns: { key: string; label: QuotaWindowLabel }[] = [];
  const seen = new Set<string>();
  entries.forEach((entry) =>
    normalizeQuotaWindows(provider, quotaFor(entry)).forEach((window) => {
      if (seen.has(window.key)) return;
      seen.add(window.key);
      columns.push({ key: window.key, label: window.label });
    })
  );
  const rank = (key: string) => {
    const index = preferredOrder.indexOf(key);
    return index === -1 ? preferredOrder.length : index;
  };
  return columns.sort((a, b) => rank(a.key) - rank(b.key));
}
