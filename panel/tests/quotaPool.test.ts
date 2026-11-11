/**
 * Provider pool arithmetic: like-for-like window matching, unknown states that
 * must never be read as 0% or 100%, and reset summaries.
 */

import { describe, expect, test } from 'bun:test';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import type { QuotaProviderType } from '../src/features/quota/providers/types';
import {
  buildProviderPool,
  buildProviderPools,
  ledgerColumns,
  pickPrimaryWindow,
  type PoolWindow,
} from '../src/features/quota/quotaPool';
import { normalizeQuotaWindows } from '../src/features/quota/quotaWindows';
import { maskEmails } from '../src/features/quota/maskIdentity';

const NOW = Date.UTC(2026, 9, 7, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const entry = (name: string, type: QuotaProviderType = 'claude'): QuotaFileEntry => ({
  file: { name, type },
  type,
});

type ClaudeWindowFixture = {
  id: string;
  usedPercent: number | null;
  resetAtMs?: number | null;
  periodHours?: number;
};

const claude = (windows: ClaudeWindowFixture[]) => ({
  status: 'success',
  windows: windows.map((window) => ({
    label: window.id,
    labelKey: `claude_quota.${window.id}`,
    resetLabel: '-',
    periodHours: window.id === 'five-hour' ? 5 : 168,
    ...window,
  })),
});

const lookup =
  (states: Record<string, unknown>) =>
  (item: QuotaFileEntry): { status?: string } | undefined =>
    states[item.file.name] as { status?: string } | undefined;

const windowOf = (pool: { windows: PoolWindow[] }, key: string) => {
  const found = pool.windows.find((window) => window.key === key);
  if (!found) throw new Error(`missing window ${key}`);
  return found;
};

describe('normalizeQuotaWindows', () => {
  test('converts each provider to percent remaining and keeps unknown as null', () => {
    expect(
      normalizeQuotaWindows(
        'claude',
        claude([
          { id: 'seven-day', usedPercent: 21, resetAtMs: NOW + DAY },
          { id: 'five-hour', usedPercent: null },
        ])
      ).map((window) => [window.key, window.remainingPercent])
    ).toEqual([
      ['claude:seven-day', 79],
      ['claude:five-hour', null],
    ]);

    expect(
      normalizeQuotaWindows('antigravity', {
        status: 'success',
        groups: [{ buckets: [{ id: 'gemini-pro', label: 'Gemini Pro', remainingFraction: 0.4 }] }],
      })[0].remainingPercent
    ).toBe(40);

    const kimi = normalizeQuotaWindows('kimi', {
      status: 'success',
      rows: [
        { id: 'limit-0', labelKey: 'kimi_quota.weekly_limit', used: 25, limit: 100 },
        { id: 'limit-1', label: 'broken', used: 3, limit: 0 },
      ],
    });
    expect(kimi.map((window) => window.remainingPercent)).toEqual([75, null]);

    expect(
      normalizeQuotaWindows('devin', {
        status: 'success',
        windows: [{ id: 'daily', remainingPercent: null, resetAtMs: null, periodHours: 24 }],
      })[0].remainingPercent
    ).toBeNull();
  });

  test('returns nothing for credentials that are not loaded', () => {
    for (const status of ['idle', 'loading', 'error']) {
      expect(normalizeQuotaWindows('claude', { status, windows: [] })).toEqual([]);
    }
    expect(normalizeQuotaWindows('claude', undefined)).toEqual([]);
  });

  test('keys Codex additional limits by name rather than payload position', () => {
    const spark = (index: number) => ({
      id: `gpt-spark-weekly-${index}`,
      label: 'Spark weekly',
      labelKey: 'codex_quota.additional_secondary_window',
      labelParams: { name: 'GPT-Spark' },
      usedPercent: 10,
      resetLabel: '-',
    });
    const first = normalizeQuotaWindows('codex', { status: 'success', windows: [spark(0)] });
    const second = normalizeQuotaWindows('codex', { status: 'success', windows: [spark(3)] });
    expect(first[0].key).toBe(second[0].key);
    expect(first[0].label).toEqual({
      key: 'codex_quota.additional_secondary_window',
      params: { name: 'GPT-Spark' },
      text: 'Spark weekly',
    });
  });

  test('keeps the xAI weekly rate limit and monthly spend cap as separate identities', () => {
    const windows = normalizeQuotaWindows('xai', {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 30,
        usedPercent: 60,
        resetAtMs: NOW + DAY,
        monthlyLimitCents: 5000,
        billingPeriodEnd: '2026-11-01T00:00:00Z',
        productUsage: [],
      },
    });
    expect(windows.map((window) => [window.key, window.remainingPercent])).toEqual([
      ['xai:weekly', 70],
      ['xai:monthly', 40],
    ]);
    expect(
      normalizeQuotaWindows('xai', {
        status: 'success',
        billing: { mode: 'paid-health', periodType: 'unknown', productUsage: [] },
      })
    ).toEqual([]);
  });
});

describe('buildProviderPool', () => {
  const fiveClaude = ['a', 'b', 'c', 'd', 'e'].map((name) => entry(`${name}.json`));

  test('sums like-for-like windows: 409% of 500% across five accounts', () => {
    const fable = [58, 100, 100, 51, 100];
    const states = Object.fromEntries(
      fiveClaude.map((item, index) => [
        item.file.name,
        claude([
          { id: 'seven-day-fable', usedPercent: 100 - fable[index], resetAtMs: NOW + DAY },
          { id: 'five-hour', usedPercent: 0, resetAtMs: null },
        ]),
      ])
    );
    const pool = buildProviderPool('claude', fiveClaude, lookup(states), NOW);
    const window = windowOf(pool, 'claude:seven-day-fable');
    expect(window.totalRemaining).toBe(409);
    expect(window.capacity).toBe(500);
    expect(window.unknownCount).toBe(0);
    // The 5-hour window pools separately; it never adds into the 7-day figure.
    expect(windowOf(pool, 'claude:five-hour').totalRemaining).toBe(500);
    expect(pool.primaryKey).toBe('claude:seven-day-fable');
    // Ranked for display: the summary leads with the primary window.
    expect(pool.windows.map((window) => window.key)).toEqual([
      'claude:seven-day-fable',
      'claude:five-hour',
    ]);
  });

  test('counts idle, loading, failed and figure-less accounts as unknown, not 0% or 100%', () => {
    const states = {
      'a.json': claude([{ id: 'seven-day', usedPercent: 40 }]),
      'b.json': { status: 'loading', windows: [] },
      'c.json': { status: 'error', windows: [], error: 'boom' },
      'd.json': claude([{ id: 'seven-day', usedPercent: null }]),
      // e.json has never been loaded
    };
    const pool = buildProviderPool('claude', fiveClaude, lookup(states), NOW);
    const window = windowOf(pool, 'claude:seven-day');
    expect(window.totalRemaining).toBe(60);
    expect(window.capacity).toBe(100);
    expect(window.reportedCount).toBe(1);
    expect(window.unknownCount).toBe(4);
    expect(window.members.map((member) => member.status)).toEqual([
      'reported',
      'loading',
      'error',
      'unreported',
      'idle',
    ]);
    expect(window.members.slice(1).every((member) => member.remainingPercent === null)).toBe(true);
    expect(pool.statusCounts).toEqual({ idle: 1, loading: 1, success: 2, error: 1 });
  });

  test('leaves the pool empty, not zero, when nothing has loaded', () => {
    const pool = buildProviderPool('claude', fiveClaude, lookup({}), NOW);
    expect(pool.windows).toEqual([]);
    expect(pool.primaryKey).toBeNull();
    expect(pool.credentials.map((credential) => credential.status)).toEqual([
      'idle',
      'idle',
      'idle',
      'idle',
      'idle',
    ]);
  });

  test('excludes accounts that loaded without a window instead of pooling them as empty', () => {
    const states = {
      'a.json': claude([
        { id: 'seven-day', usedPercent: 10 },
        { id: 'seven-day-fable', usedPercent: 50 },
      ]),
      'b.json': claude([{ id: 'seven-day', usedPercent: 30 }]),
    };
    const pool = buildProviderPool(
      'claude',
      [entry('a.json'), entry('b.json')],
      lookup(states),
      NOW
    );
    const fable = windowOf(pool, 'claude:seven-day-fable');
    expect(fable.absentCount).toBe(1);
    expect(fable.members.map((member) => member.entry.file.name)).toEqual(['a.json']);
    expect(fable.totalRemaining).toBe(50);
    expect(fable.capacity).toBe(100);
    expect(windowOf(pool, 'claude:seven-day').totalRemaining).toBe(160);
  });

  test('never mixes providers', () => {
    const pools = buildProviderPools(
      [entry('c.json', 'claude'), entry('x.json', 'codex')],
      lookup({
        'c.json': claude([{ id: 'five-hour', usedPercent: 20 }]),
        'x.json': {
          status: 'success',
          windows: [
            {
              id: 'five-hour',
              label: '5h',
              labelKey: 'codex_quota.primary_window',
              usedPercent: 90,
              resetLabel: '-',
            },
          ],
        },
      }),
      NOW
    );
    expect(pools.map((pool) => [pool.provider, pool.windows.map((w) => w.totalRemaining)])).toEqual(
      [
        ['claude', [80]],
        ['codex', [10]],
      ]
    );
  });
});

describe('pool reset summaries', () => {
  const entries = ['a', 'b', 'c', 'd'].map((name) => entry(`${name}.json`));

  test('reports the soonest reset that returns capacity, grouped by instant', () => {
    const states = {
      'a.json': claude([{ id: 'seven-day', usedPercent: 40, resetAtMs: NOW + DAY }]),
      'b.json': claude([{ id: 'seven-day', usedPercent: 20, resetAtMs: NOW + DAY + 30_000 }]),
      'c.json': claude([{ id: 'seven-day', usedPercent: 50, resetAtMs: NOW + 4 * DAY }]),
      // Full accounts return nothing, so their earlier reset is not "next".
      'd.json': claude([{ id: 'seven-day', usedPercent: 0, resetAtMs: NOW + HOUR }]),
    };
    const window = windowOf(
      buildProviderPool('claude', entries, lookup(states), NOW),
      'claude:seven-day'
    );
    expect(window.nextReset).toEqual({ atMs: NOW + DAY, restorePercent: 60, accountCount: 2 });
    expect(window.allResetAtMs).toBe(NOW + 4 * DAY);
    expect(window.staleCount).toBe(0);
  });

  test('flags resets that already passed as stale and leaves them out of "next"', () => {
    const states = {
      'a.json': claude([{ id: 'seven-day', usedPercent: 70, resetAtMs: NOW - HOUR }]),
      'b.json': claude([{ id: 'seven-day', usedPercent: 10, resetAtMs: NOW + 2 * DAY }]),
    };
    const window = windowOf(
      buildProviderPool('claude', entries.slice(0, 2), lookup(states), NOW),
      'claude:seven-day'
    );
    expect(window.staleCount).toBe(1);
    expect(window.nextReset).toEqual({ atMs: NOW + 2 * DAY, restorePercent: 10, accountCount: 1 });
    // One depleted member has no future reset, so "all reset by" is unknowable.
    expect(window.allResetAtMs).toBeNull();
  });

  test('has no next reset when every reporting account is full', () => {
    const states = {
      'a.json': claude([{ id: 'five-hour', usedPercent: 0, resetAtMs: null }]),
    };
    const window = windowOf(
      buildProviderPool('claude', entries.slice(0, 1), lookup(states), NOW),
      'claude:five-hour'
    );
    expect(window.nextReset).toBeNull();
    expect(window.allResetAtMs).toBeNull();
  });
});

describe('pickPrimaryWindow', () => {
  const summary = (
    key: string,
    reportedCount: number,
    totalRemaining: number,
    periodHours: number
  ): PoolWindow => ({
    key,
    label: { text: key },
    periodHours,
    members: [],
    reportedCount,
    unknownCount: 0,
    absentCount: 0,
    totalRemaining,
    capacity: reportedCount * 100,
    nextReset: null,
    allResetAtMs: null,
    staleCount: 0,
  });

  test('prefers coverage, then the longest period, then the most constrained window', () => {
    expect(
      pickPrimaryWindow([summary('narrow', 1, 10, 168), summary('wide', 5, 450, 168)])?.key
    ).toBe('wide');
    expect(
      pickPrimaryWindow([summary('shared', 5, 454, 168), summary('model', 5, 409, 168)])?.key
    ).toBe('model');
    expect(
      pickPrimaryWindow([summary('short', 2, 100, 5), summary('long', 2, 100, 168)])?.key
    ).toBe('long');
    // A drained 5-hour window recovers within hours; the weekly limit still leads.
    expect(
      pickPrimaryWindow([summary('five-hour', 3, 20, 5), summary('weekly', 3, 250, 168)])?.key
    ).toBe('weekly');
    expect(pickPrimaryWindow([summary('none', 0, 0, 168)])).toBeNull();
  });
});

describe('ledgerColumns', () => {
  test('unions window identities across a provider group in first-appearance order', () => {
    const states = {
      'a.json': claude([{ id: 'five-hour', usedPercent: 1 }]),
      'b.json': claude([
        { id: 'seven-day-fable', usedPercent: 1 },
        { id: 'five-hour', usedPercent: 1 },
      ]),
      'c.json': { status: 'error', windows: [] },
    };
    expect(
      ledgerColumns(
        'claude',
        [entry('a.json'), entry('b.json'), entry('c.json')],
        lookup(states)
      ).map((column) => column.key)
    ).toEqual(['claude:five-hour', 'claude:seven-day-fable']);
  });

  test('follows the pool ranking when given one, keeping unknown keys last', () => {
    const states = {
      'a.json': claude([
        { id: 'five-hour', usedPercent: 1 },
        { id: 'seven-day', usedPercent: 1 },
        { id: 'seven-day-fable', usedPercent: 1 },
      ]),
    };
    expect(
      ledgerColumns('claude', [entry('a.json')], lookup(states), [
        'claude:seven-day-fable',
        'claude:five-hour',
      ]).map((column) => column.key)
    ).toEqual(['claude:seven-day-fable', 'claude:five-hour', 'claude:seven-day']);
  });
});

describe('maskEmails', () => {
  test('masks email-bearing filenames while keeping the provider prefix and suffix', () => {
    expect(maskEmails('claude-theo@example.dev.json')).toBe('claude-t•••@e•••.dev.json');
    expect(maskEmails('codex-jane.doe@gmail.com-team.json')).toBe('codex-j•••@g•••.com-team.json');
    expect(maskEmails('session · person@corp.io')).toBe('session · p•••@c•••.io');
    expect(maskEmails('kimi-oauth.json')).toBe('kimi-oauth.json');
  });
});
