import { describe, expect, test } from 'bun:test';
import {
  groupResetGrants,
  suggestReset,
  type ResetCandidate,
} from '../src/features/quota/providers/claude/resetGrantGroups';
import {
  parseAnthropicResetGrantStatus,
  type AnthropicResetGrantStatus,
} from '../src/services/api/claudeResetGrants';
import type { ClaudeQuotaWindow } from '../src/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-12T22:00:00Z');
const ACCOUNT_CLEARS = ['seven_day', 'seven_day_overage_included'];
const MODEL_CLEARS = ['seven_day_overage_included'];

const grant = (id: string, endsInDays: number | null, clears = ACCOUNT_CLEARS) => ({
  id,
  resets_total: 1,
  resets_left: 1,
  starts_at: '2026-11-01T00:00:00Z',
  ends_at: endsInDays === null ? null : new Date(NOW + endsInDays * DAY).toISOString(),
  clears,
  usable_now: true,
  use_requires_limit: false,
});

const statusOf = (
  grants: ReturnType<typeof grant>[],
  block: Record<string, unknown> = {}
): AnthropicResetGrantStatus => {
  const status = parseAnthropicResetGrantStatus({
    eligible: true,
    at_limit: true,
    grants,
    ...block,
  });
  if (!status) throw new Error('fixture block did not parse');
  return status;
};

const window = (id: string, usedPercent: number, refillInHours: number | null) =>
  ({
    id,
    label: id,
    labelKey: `claude_quota.${id}`,
    usedPercent,
    resetLabel: '',
    resetAtMs: refillInHours === null ? null : NOW + refillInHours * HOUR,
    periodHours: 168,
  }) satisfies ClaudeQuotaWindow;

const account = (
  name: string,
  status: AnthropicResetGrantStatus,
  windows: ClaudeQuotaWindow[]
): ResetCandidate<string> => ({ account: name, groups: groupResetGrants(status, windows, NOW) });

const limited = (refillInHours: number | null) => [
  window('seven-day', 100, refillInHours),
  window('seven-day-fable', 60, refillInHours),
];

describe('reset suggestion across accounts', () => {
  test('names the ready grant that expires soonest, with its windows and expiry', () => {
    const suggestion = suggestReset([
      account('late', statusOf([grant('g-late', 90)]), limited(96)),
      account('soon', statusOf([grant('g-soon', 27)]), limited(30)),
    ]);
    expect(suggestion).toMatchObject({
      state: 'ready',
      account: 'soon',
      kind: 'account',
      grantId: 'g-soon',
      endsAtMs: NOW + 27 * DAY,
    });
    if (suggestion.state !== 'ready') throw new Error('expected ready');
    expect(suggestion.windows.map((w) => [w.window, w.usedPercent, w.resetAtMs])).toEqual([
      ['seven_day', 100, NOW + 30 * HOUR],
      ['seven_day_overage_included', 60, NOW + 30 * HOUR],
    ]);
  });

  test('on equal expiry, the account whose limited window refills latest wins', () => {
    const suggestion = suggestReset([
      account('refills-sooner', statusOf([grant('a', 27)]), limited(46)),
      account('refills-later', statusOf([grant('b', 27)]), limited(96)),
    ]);
    expect(suggestion).toMatchObject({ state: 'ready', account: 'refills-later', grantId: 'b' });
  });

  test('a grant that never ends ranks after one that ends', () => {
    const suggestion = suggestReset([
      account('forever', statusOf([grant('a', null)]), limited(96)),
      account('ends', statusOf([grant('b', 200)]), limited(30)),
    ]);
    expect(suggestion).toMatchObject({ state: 'ready', account: 'ends' });
  });

  test('the expiry is the spent grant, not an earlier paused grant in the same group', () => {
    const paused = { ...grant('paused', 3), paused: true };
    const suggestion = suggestReset([
      account('one', statusOf([paused, grant('live', 40)]), limited(96)),
    ]);
    expect(suggestion).toMatchObject({ state: 'ready', grantId: 'live', endsAtMs: NOW + 40 * DAY });
  });

  test('the model reset is suggested when the account reset defers to it', () => {
    const suggestion = suggestReset([
      account('fable-only', statusOf([grant('acct', 10), grant('model', 100, MODEL_CLEARS)]), [
        window('seven-day', 50, 96),
        window('seven-day-fable', 100, 96),
      ]),
    ]);
    expect(suggestion).toMatchObject({ state: 'ready', kind: 'model', grantId: 'model' });
  });

  test('nothing ready: windows under 90% used', () => {
    expect(
      suggestReset([
        account('a', statusOf([grant('a', 27)]), [window('seven-day', 40, 96)]),
        account('b', statusOf([grant('b', 27)]), [window('seven-day', 3, 96)]),
      ])
    ).toEqual({ state: 'none', reason: 'not_limited' });
  });

  test('nothing ready: the limited windows refill within a day', () => {
    expect(
      suggestReset([
        account('a', statusOf([grant('a', 27)]), limited(20)),
        account('b', statusOf([grant('b', 27)]), [window('seven-day', 3, 96)]),
      ])
    ).toEqual({ state: 'none', reason: 'resets_soon' });
  });

  test('nothing ready: a claim cooldown runs', () => {
    const cooling = statusOf([grant('a', 27)], {
      cooldown_until: new Date(NOW + HOUR).toISOString(),
    });
    expect(suggestReset([account('a', cooling, limited(96))])).toEqual({
      state: 'none',
      reason: 'cooldown',
    });
  });

  test('nothing ready: no grant left anywhere', () => {
    expect(
      suggestReset([account('a', statusOf([]), limited(96)), { account: 'b', groups: [] }])
    ).toEqual({ state: 'none', reason: 'no_grants' });
  });

  test('nothing ready while an account has not loaded: says so instead of guessing', () => {
    expect(
      suggestReset([
        account('a', statusOf([grant('a', 27)]), [window('seven-day', 3, 96)]),
        { account: 'b', groups: null },
      ])
    ).toEqual({ state: 'none', reason: 'not_loaded' });
  });

  test('a ready grant is still suggested while another account loads', () => {
    expect(
      suggestReset([
        account('a', statusOf([grant('a', 27)]), limited(96)),
        { account: 'b', groups: null },
      ])
    ).toMatchObject({ state: 'ready', account: 'a' });
  });
});
