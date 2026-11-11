import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import fixture from './fixtures/claudeUsageFableExhausted.json';
import {
  groupResetGrants,
  type ResetGrantGroup,
} from '../src/features/quota/providers/claude/resetGrantGroups';
import { CLAUDE_CONFIG } from '../src/features/quota/providers/claude/data';
import {
  createResetGrantOperations,
  type ResetGrantOperationDeps,
} from '../src/features/quota/providers/claude/resetGrantOperations';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import {
  parseAnthropicResetGrantStatus,
  type AnthropicResetGrantStatus,
  type AnthropicResetSettledCode,
} from '../src/services/api/claudeResetGrants';
import type { AuthFileItem, ClaudeQuotaWindow } from '../src/types';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-11T13:13:16Z');
const t = ((key: string) => key) as TFunction;
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
});

const ACCOUNT_CLEARS = ['seven_day', 'seven_day_overage_included'];
const MODEL_CLEARS = ['seven_day_overage_included'];

type RawGrant = Record<string, unknown>;
const grant = (id: string, fields: RawGrant = {}): RawGrant => ({
  id,
  resets_total: 1,
  resets_left: 1,
  starts_at: '2026-11-09T18:00:00Z',
  ends_at: '2027-03-09T07:59:00Z',
  clears: MODEL_CLEARS,
  usable_now: true,
  use_requires_limit: false,
  ...fields,
});

const statusOf = (grants: RawGrant[], block: RawGrant = {}): AnthropicResetGrantStatus => {
  const status = parseAnthropicResetGrantStatus({
    eligible: true,
    at_limit: true,
    grants,
    ...block,
  });
  if (!status) throw new Error('fixture block did not parse');
  return status;
};

const window = (id: string, usedPercent: number | null, resetInMs: number | null) =>
  ({
    id,
    label: id,
    labelKey: `claude_quota.${id}`,
    usedPercent,
    resetLabel: '',
    resetAtMs: resetInMs === null ? null : NOW + resetInMs,
    periodHours: 168,
  }) satisfies ClaudeQuotaWindow;

/** Seven-day 64% used, Fable 100% used, both back in five days. */
const fableExhausted = [
  window('seven-day', 64, 5 * 24 * HOUR),
  window('seven-day-fable', 100, 5 * 24 * HOUR),
];

const byKind = (groups: ResetGrantGroup[], kind: 'account' | 'model') =>
  groups.find((group) => group.kind === kind);

const spendGrant = (group: ResetGrantGroup | undefined) =>
  group?.action.state === 'ready' ? group.action.grantId : undefined;

const blockReason = (group: ResetGrantGroup | undefined) =>
  group?.action.state === 'blocked' ? group.action.reason : undefined;

describe('reset grant groups', () => {
  test('the model reset never spends the account-wide grant (live response, Fable used up)', () => {
    const status = parseAnthropicResetGrantStatus(fixture.cedar_ember)!;
    const groups = groupResetGrants(status, fableExhausted, NOW);
    expect(groups.map((group) => group.kind)).toEqual(['account', 'model']);
    expect(spendGrant(byKind(groups, 'model'))).toBe('launch-2610-fable');
    expect(blockReason(byKind(groups, 'account'))).toBe('use_model_reset');
    expect(byKind(groups, 'model')).toMatchObject({
      resetsLeft: 1,
      endsAtMs: Date.parse('2027-03-09T07:59:00+00:00'),
    });
    expect(byKind(groups, 'account')).toMatchObject({
      resetsLeft: 1,
      endsAtMs: Date.parse('2026-12-10T22:00:00+00:00'),
    });
  });

  test('kind comes from the windows a grant clears, not its id or label', () => {
    const groups = groupResetGrants(
      statusOf([
        grant('fable-sounding-name', { clears: ACCOUNT_CLEARS, label: 'Fable reset' }),
        grant('full-reset-sounding', { clears: MODEL_CLEARS, label: 'Full reset' }),
      ]),
      [window('seven-day', 100, 5 * 24 * HOUR), window('seven-day-fable', 100, 5 * 24 * HOUR)],
      NOW
    );
    expect(spendGrant(byKind(groups, 'account'))).toBe('fable-sounding-name');
    expect(spendGrant(byKind(groups, 'model'))).toBe('full-reset-sounding');
  });

  test('resets left and soonest end ignore used-up and ended grants; empty groups hide', () => {
    const groups = groupResetGrants(
      statusOf([
        grant('a', { resets_total: 2, resets_left: 2, ends_at: '2027-01-01T00:00:00Z' }),
        grant('b', { resets_left: 0, usable_now: false, ends_at: '2026-11-20T00:00:00Z' }),
        grant('c', { ends_at: '2026-11-10T00:00:00Z' }),
        grant('d', { usable_now: false, ends_at: '2027-02-01T00:00:00Z' }),
        grant('e', { clears: ACCOUNT_CLEARS, resets_left: 0, usable_now: false }),
      ]),
      fableExhausted,
      NOW
    );
    expect(groups.map((group) => group.kind)).toEqual(['model']);
    expect(groups[0].resetsLeft).toBe(3);
    expect(groups[0].endsAtMs).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });

  test('a group with resets left but no grant usable now is blocked, not hidden', () => {
    for (const fields of [
      { paused: true },
      { usable_now: false },
      { starts_at: '2026-12-01T00:00:00Z' },
      { use_requires_limit: true },
    ]) {
      const groups = groupResetGrants(
        statusOf([grant('a', fields)], { at_limit: false }),
        fableExhausted,
        NOW
      );
      expect(blockReason(groups[0])).toBe('unavailable');
      expect(groups[0].resetsLeft).toBe(1);
    }
    const ineligible = groupResetGrants(
      statusOf([grant('a')], { eligible: false }),
      fableExhausted,
      NOW
    );
    expect(blockReason(ineligible[0])).toBe('unavailable');
  });

  test('the soonest-ending usable grant is spent first, then the lowest id', () => {
    const groups = groupResetGrants(
      statusOf([
        grant('late', { ends_at: '2027-06-01T00:00:00Z' }),
        grant('soon-b', { ends_at: '2027-01-01T00:00:00Z' }),
        grant('soon-a', { ends_at: '2027-01-01T00:00:00Z' }),
        grant('soonest-unusable', { ends_at: '2026-12-01T00:00:00Z', usable_now: false }),
      ]),
      fableExhausted,
      NOW
    );
    expect(spendGrant(groups[0])).toBe('soon-a');
    expect(groups[0].endsAtMs).toBe(Date.parse('2026-12-01T00:00:00Z'));
  });

  test('an upstream cooldown blocks every group', () => {
    const groups = groupResetGrants(
      statusOf([grant('a'), grant('b', { clears: ACCOUNT_CLEARS })], {
        cooldown_until: new Date(NOW + HOUR).toISOString(),
      }),
      fableExhausted,
      NOW
    );
    expect(groups.map(blockReason)).toEqual(['cooldown', 'cooldown']);
  });

  test('waste guard: a grant is never offered when no window it clears is 90% used', () => {
    const below = [
      window('seven-day', 89, 5 * 24 * HOUR),
      window('seven-day-fable', 89.9, 5 * 24 * HOUR),
    ];
    const groups = groupResetGrants(
      statusOf([grant('model'), grant('account', { clears: ACCOUNT_CLEARS })]),
      below,
      NOW
    );
    expect(groups.map(blockReason)).toEqual(['not_limited', 'not_limited']);
    const atNinety = groupResetGrants(
      statusOf([grant('model')]),
      [window('seven-day-fable', 90, 5 * 24 * HOUR)],
      NOW
    );
    expect(spendGrant(atNinety[0])).toBe('model');
  });

  test('waste guard: blocked when every limited window comes back on its own within 24 h', () => {
    for (const resetIn of [HOUR, 24 * HOUR, -HOUR]) {
      const groups = groupResetGrants(
        statusOf([grant('model')]),
        [window('seven-day-fable', 100, resetIn)],
        NOW
      );
      expect(blockReason(groups[0])).toBe('resets_soon');
    }
    const later = groupResetGrants(
      statusOf([grant('model')]),
      [window('seven-day-fable', 100, 24 * HOUR + 60_000)],
      NOW
    );
    expect(spendGrant(later[0])).toBe('model');
  });

  test('waste guard: an account reset is blocked when its only limited window returns soon', () => {
    const groups = groupResetGrants(
      statusOf([grant('account', { clears: ACCOUNT_CLEARS })]),
      [window('seven-day', 40, 5 * 24 * HOUR), window('seven-day-fable', 100, 6 * HOUR)],
      NOW
    );
    expect(blockReason(groups[0])).toBe('resets_soon');
  });

  test('the account reset is held back when a ready model reset covers every limited window', () => {
    const grants = [grant('full', { clears: ACCOUNT_CLEARS }), grant('model')];
    const fableOnly = groupResetGrants(
      statusOf(grants),
      [window('seven-day', 64, 5 * 24 * HOUR), window('seven-day-fable', 100, 5 * 24 * HOUR)],
      NOW
    );
    expect(blockReason(fableOnly[0])).toBe('use_model_reset');
    expect(fableOnly[1].action.state).toBe('ready');

    const weeklyToo = groupResetGrants(
      statusOf(grants),
      [window('seven-day', 100, 5 * 24 * HOUR), window('seven-day-fable', 100, 5 * 24 * HOUR)],
      NOW
    );
    expect(weeklyToo[0].action.state).toBe('ready');

    const noModelGrant = groupResetGrants(
      statusOf([grant('full', { clears: ACCOUNT_CLEARS })]),
      [window('seven-day', 64, 5 * 24 * HOUR), window('seven-day-fable', 100, 5 * 24 * HOUR)],
      NOW
    );
    expect(noModelGrant[0].action.state).toBe('ready');
  });

  test('unknown use is not a limit; an unknown reset time is not "soon"', () => {
    const unknownUse = groupResetGrants(
      statusOf([grant('model', { percent_used: {} })]),
      [window('seven-day-fable', null, 5 * 24 * HOUR)],
      NOW
    );
    expect(blockReason(unknownUse[0])).toBe('not_limited');
    const unknownReset = groupResetGrants(
      statusOf([grant('model')]),
      [window('seven-day-fable', 95, null)],
      NOW
    );
    expect(spendGrant(unknownReset[0])).toBe('model');
  });

  test('the confirmation reads each cleared window from its quota window', () => {
    const groups = groupResetGrants(
      statusOf([grant('account', { clears: ACCOUNT_CLEARS })]),
      fableExhausted,
      NOW
    );
    expect(groups[0].action).toEqual({
      state: 'ready',
      grantId: 'account',
      retry: false,
      windows: [
        {
          window: 'seven_day',
          label: { key: 'claude_quota.seven-day', text: 'seven-day' },
          usedPercent: 64,
          resetAtMs: NOW + 5 * 24 * HOUR,
        },
        {
          window: 'seven_day_overage_included',
          label: { key: 'claude_quota.seven-day-fable', text: 'seven-day-fable' },
          usedPercent: 100,
          resetAtMs: NOW + 5 * 24 * HOUR,
        },
      ],
    });
  });

  test('a cleared window missing from the quota falls back to the grant figure', () => {
    const groups = groupResetGrants(
      statusOf([grant('model', { percent_used: { seven_day_overage_included: 97 } })]),
      [window('seven-day', 10, 5 * 24 * HOUR)],
      NOW
    );
    expect(groups[0].action).toMatchObject({
      state: 'ready',
      windows: [{ window: 'seven_day_overage_included', usedPercent: 97, resetAtMs: null }],
    });
  });

  test('a pending unknown claim retries its own grant and blocks the other group', () => {
    const status = statusOf([
      grant('model-soon', { ends_at: '2027-01-01T00:00:00Z' }),
      grant('model-late'),
      grant('account', { clears: ACCOUNT_CLEARS }),
    ]);
    const quiet = [window('seven-day', 10, 5 * 24 * HOUR), window('seven-day-fable', 10, HOUR)];
    const groups = groupResetGrants(status, quiet, NOW, { grantId: 'model-late', expired: false });
    expect(byKind(groups, 'model')?.action).toMatchObject({
      state: 'ready',
      grantId: 'model-late',
      retry: true,
    });
    expect(blockReason(byKind(groups, 'account'))).toBe('pending');
    const expired = groupResetGrants(status, quiet, NOW, { grantId: 'model-late', expired: true });
    expect(expired.map(blockReason)).toEqual(['expired', 'expired']);
  });

  test('the group a pending claim belongs to stays visible after its count drops to 0', () => {
    const groups = groupResetGrants(
      statusOf([grant('model', { resets_left: 0, usable_now: false })]),
      fableExhausted,
      NOW,
      { grantId: 'model', expired: false }
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'model', resetsLeft: 0 });
    expect(spendGrant(groups[0])).toBe('model');
  });
});

const claudeFile = {
  name: 'claude-test.json',
  type: 'claude',
  auth_index: 'idx-1',
} as AuthFileItem;

describe('Claude quota fetch reads grants from the one usage call', () => {
  const answer = (usageBody: unknown) => {
    const calls: ApiCallRequest[] = [];
    apiCallApi.request = async (request) => {
      calls.push(request);
      const body = request.url.includes('/api/oauth/usage') ? usageBody : { account: {} };
      return { statusCode: 200, body, bodyText: '', header: {} };
    };
    return calls;
  };

  test('one usage request per account, and its grant block lands in the quota state', async () => {
    const calls = answer(fixture);
    const data = await CLAUDE_CONFIG.fetchQuota(claudeFile, t);
    const usageCalls = calls.filter((call) => call.url.includes('/api/oauth/usage'));
    expect(usageCalls).toHaveLength(1);
    expect(new URL(usageCalls[0].url).searchParams.get('cedar_ember')).toBe('1');
    expect(new URL(usageCalls[0].url).searchParams.has('skip_spend')).toBe(false);
    const state = CLAUDE_CONFIG.buildSuccessState(data);
    expect(state.resetGrants?.nextGrantId).toBe('full-reset-2611');
    expect(state.resetGrants?.grants.map((item) => item.id)).toEqual([
      'full-reset-2611',
      'launch-2610-fable',
    ]);
    expect(state.windows.map((item) => item.id)).toEqual(['seven-day', 'seven-day-fable']);
  });

  test('a missing or malformed grant block still loads the quota windows', async () => {
    for (const cedar of [null, { eligible: 'yes' }]) {
      answer({ ...fixture, cedar_ember: cedar });
      const state = CLAUDE_CONFIG.buildSuccessState(await CLAUDE_CONFIG.fetchQuota(claudeFile, t));
      expect(state.status).toBe('success');
      expect(state.resetGrants).toBeNull();
      expect(state.windows).toHaveLength(2);
    }
  });
});

describe('a settled claim clears the gateway cooldown', () => {
  const organization = '11111111-2222-3333-4444-555555555555';
  const setup = (code: AnthropicResetSettledCode) => {
    const cleared: string[] = [];
    const deps: ResetGrantOperationDeps = {
      revision: () => 1,
      now: () => NOW,
      requestId: () => 'request-1',
      readStatus: async () => statusOf([grant('model')]),
      readOrganization: async () => organization,
      claim: async () => code,
      resetCooldown: async (authIndex: string) => {
        cleared.push(authIndex);
        return { status: 'ok' as const, auth_index: authIndex, models: [] };
      },
    };
    return { deps, cleared };
  };

  test('reset and already_used clear the cooldown for that credential', async () => {
    for (const code of ['reset', 'already_used'] as const) {
      const { deps, cleared } = setup(code);
      const answer = await createResetGrantOperations(deps).run('key', 'idx-1', 'model');
      expect(answer).toEqual({ code, unresolved: false });
      expect(cleared).toEqual(['idx-1']);
    }
  });

  test('refusals leave the cooldown alone', async () => {
    for (const code of ['not_limited', 'cooldown', 'ineligible', 'rate_limited'] as const) {
      const { deps, cleared } = setup(code);
      await createResetGrantOperations(deps).run('key', 'idx-1', 'model');
      expect(cleared).toEqual([]);
    }
  });

  test('a failed cooldown clear is reported, and the claim still counts as settled', async () => {
    const { deps } = setup('reset');
    deps.resetCooldown = async () => {
      throw new Error('gateway down');
    };
    const operations = createResetGrantOperations(deps);
    expect(await operations.run('key', 'idx-1', 'model')).toEqual({
      code: 'cooldown_clear_failed',
      unresolved: false,
    });
    expect(operations.inspect('key')?.code).toBe('reset');
  });
});
