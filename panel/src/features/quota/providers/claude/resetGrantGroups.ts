/**
 * Claude reset grants grouped by what they clear.
 *
 * An "account" grant clears the shared 7-day window (and the model window with
 * it); a "model" grant clears only a model-scoped window such as Fable. Each
 * group spends its own grants, so a Fable-only shortfall never burns the
 * account-wide reset.
 *
 * The waste guard keeps the spend button off unless some cleared window is at
 * least RESET_LIMITED_PERCENT used and at least one such window stays limited
 * for more than RESET_NATURAL_WINDOW_MS. A window that refills on its own within
 * a day is not worth a reset. The claude-quota plugin, which sends every claim,
 * checks its own guards again before it claims.
 *
 * Pure and clock-free: `now` is passed in.
 */

import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrant,
  type AnthropicResetGrantStatus,
  type AnthropicResetWindow,
} from '@/services/api/claudeResetGrants';
import type { ClaudeQuotaWindow } from '@/types';
import { DAY_MS } from '@/utils/time/durations';
import type { QuotaWindowLabel } from '../../quotaWindows';

export const RESET_LIMITED_PERCENT = 90;
export const RESET_NATURAL_WINDOW_MS = DAY_MS;

export const RESET_GRANT_KINDS = ['account', 'model'] as const;
export type ResetGrantKind = (typeof RESET_GRANT_KINDS)[number];

/** The quota window each grant-clearable usage window is shown as. */
const QUOTA_WINDOW: Record<AnthropicResetWindow, { id: string; labelKey: string }> = {
  five_hour: { id: 'five-hour', labelKey: 'claude_quota.five_hour' },
  seven_day: { id: 'seven-day', labelKey: 'claude_quota.seven_day' },
  seven_day_overage_included: {
    id: 'seven-day-fable',
    labelKey: 'claude_quota.seven_day_fable',
  },
};

export interface ResetWindowReading {
  window: AnthropicResetWindow;
  label: QuotaWindowLabel;
  usedPercent: number | null;
  resetAtMs: number | null;
}

export type ResetGroupBlock =
  'cooldown' | 'unavailable' | 'not_limited' | 'resets_soon' | 'use_model_reset';

export type ResetGroupAction =
  | { state: 'ready'; grantId: string; windows: ResetWindowReading[] }
  | { state: 'blocked'; reason: ResetGroupBlock };

export interface ResetGrantGroup {
  kind: ResetGrantKind;
  /** Resets left across this group's grants that have not ended. */
  resetsLeft: number;
  /** Soonest end among grants that still have resets left. */
  endsAtMs: number | null;
  action: ResetGroupAction;
}

export const resetGrantKind = (grant: AnthropicResetGrant): ResetGrantKind =>
  grant.clears.includes('seven_day') ? 'account' : 'model';

const parseMs = (value: string | null): number | null =>
  value === null ? null : Date.parse(value);

const hasEnded = (grant: AnthropicResetGrant, now: number) => {
  const endsAt = parseMs(grant.endsAt);
  return endsAt !== null && endsAt <= now;
};

const isSpendable = (
  status: AnthropicResetGrantStatus,
  grant: AnthropicResetGrant,
  now: number
) => {
  const startsAt = parseMs(grant.startsAt);
  return (
    anthropicResetGrantBlocker(status, grant.id) === null &&
    (startsAt === null || startsAt <= now) &&
    !hasEnded(grant, now)
  );
};

/** Soonest end first, so a grant about to lapse is used before one that keeps. */
const bySoonestEnd = (a: AnthropicResetGrant, b: AnthropicResetGrant) => {
  const endA = parseMs(a.endsAt) ?? Infinity;
  const endB = parseMs(b.endsAt) ?? Infinity;
  if (endA !== endB) return endA - endB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function readWindows(grant: AnthropicResetGrant, windows: readonly ClaudeQuotaWindow[]) {
  return grant.clears.map((window): ResetWindowReading => {
    const target = QUOTA_WINDOW[window];
    const quota = windows.find((candidate) => candidate.id === target.id);
    return {
      window,
      label: quota
        ? { key: quota.labelKey, text: quota.label }
        : { key: target.labelKey, text: window },
      // The grant's own figure travels with the status, so a fresh status read
      // brings fresh use even when the page's windows are minutes old.
      usedPercent: grant.percentUsed[window] ?? quota?.usedPercent ?? null,
      resetAtMs: quota?.resetAtMs ?? null,
    };
  });
}

const isLimited = (reading: ResetWindowReading) =>
  reading.usedPercent !== null && reading.usedPercent >= RESET_LIMITED_PERCENT;

function wasteGuard(readings: ResetWindowReading[], now: number): ResetGroupBlock | null {
  const limited = readings.filter(isLimited);
  if (limited.length === 0) return 'not_limited';
  const refillsSoon = (reading: ResetWindowReading) =>
    reading.resetAtMs !== null && reading.resetAtMs - now <= RESET_NATURAL_WINDOW_MS;
  return limited.every(refillsSoon) ? 'resets_soon' : null;
}

function groupAction(
  status: AnthropicResetGrantStatus,
  grants: AnthropicResetGrant[],
  windows: readonly ClaudeQuotaWindow[],
  now: number
): ResetGroupAction {
  const cooldownUntil = parseMs(status.cooldownUntil);
  if (cooldownUntil !== null && cooldownUntil > now)
    return { state: 'blocked', reason: 'cooldown' };
  const [grant] = grants.filter((item) => isSpendable(status, item, now)).sort(bySoonestEnd);
  if (!grant) return { state: 'blocked', reason: 'unavailable' };
  const readings = readWindows(grant, windows);
  const guard = wasteGuard(readings, now);
  return guard
    ? { state: 'blocked', reason: guard }
    : { state: 'ready', grantId: grant.id, windows: readings };
}

/**
 * The account reset also clears the model window, so it would be ready whenever
 * a model reset is. Hold it back while the narrower reset covers every limited window.
 */
function preferNarrowerReset(groups: ResetGrantGroup[]): ResetGrantGroup[] {
  const model = groups.find((group) => group.kind === 'model')?.action;
  if (model?.state !== 'ready') return groups;
  const covered = new Set(model.windows.map((reading) => reading.window));
  return groups.map((group) =>
    group.kind === 'account' &&
    group.action.state === 'ready' &&
    group.action.windows.filter(isLimited).every((reading) => covered.has(reading.window))
      ? { ...group, action: { state: 'blocked', reason: 'use_model_reset' } }
      : group
  );
}

/** Account group first, then model; a group shows while it has resets left. */
export function groupResetGrants(
  status: AnthropicResetGrantStatus,
  windows: readonly ClaudeQuotaWindow[],
  now: number
): ResetGrantGroup[] {
  const groups = RESET_GRANT_KINDS.flatMap((kind): ResetGrantGroup[] => {
    const grants = status.grants.filter((grant) => resetGrantKind(grant) === kind);
    const live = grants.filter((grant) => grant.resetsLeft > 0 && !hasEnded(grant, now));
    if (live.length === 0) return [];
    const ends = live.map((grant) => parseMs(grant.endsAt)).filter((ms) => ms !== null);
    return [
      {
        kind,
        resetsLeft: live.reduce((sum, grant) => sum + grant.resetsLeft, 0),
        endsAtMs: ends.length > 0 ? Math.min(...ends) : null,
        action: groupAction(status, grants, windows, now),
      },
    ];
  });
  return preferNarrowerReset(groups);
}
