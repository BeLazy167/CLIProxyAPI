import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { DrainCard } from '@/features/quota/components/DrainCard';
import { buildDrainCard } from '@/features/quota/drainCard';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { PoolWindow } from '@/features/quota/quotaPool';
import {
  currentSegment,
  hourlyDrain,
  readingsOf,
  recentBurnRate,
  splitSegments,
  theilSenPerHour,
  windowAverageRate,
  type QuotaHistorySeries,
  type Reading,
} from '@/features/quota/drainSeries';
import {
  accountRate,
  poolHistory,
  projectAccount,
  sumProjections,
  valueAt,
  type FutureUsage,
} from '@/features/quota/quotaForecast';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 11, 12);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

/** Readings at `NOW + hours` offsets. */
const at = (pairs: [number, number][], passive = false): Reading[] =>
  pairs.map(([hours, remaining]) => ({ atMs: NOW + hours * H, remaining, passive }));

describe('readings', () => {
  test('route points come back sorted, one reading per instant, for one account and window', () => {
    const t = NOW / 1000;
    const series: QuotaHistorySeries[] = [
      {
        auth_index: 'a',
        window: 'seven-day',
        points: [
          [t + 7200, 60, 0],
          [t, 80, 0],
        ],
      },
      {
        auth_index: 'a',
        window: 'seven-day',
        points: [
          [t + 3600, 70, 1],
          [t + 3600, 71, 0],
        ],
      },
      { auth_index: 'a', window: 'five-hour', points: [[t, 5, 0]] },
      { auth_index: 'b', window: 'seven-day', points: [[t, 1, 0]] },
    ];
    expect(readingsOf(series, 'a', 'seven-day')).toEqual([
      { atMs: NOW, remaining: 80, passive: false },
      { atMs: NOW + H, remaining: 71, passive: false },
      { atMs: NOW + 2 * H, remaining: 60, passive: false },
    ]);
  });

  test('passive wobble stays in one segment; refills and partial claimed resets split', () => {
    const readings = at([
      [0, 40],
      [1, 39],
      [1.1, 40],
      [2, 38],
      [3, 100],
      [4, 90],
      [5, 1],
      [6, 41],
    ]);
    expect(splitSegments(readings).map((s) => s.map((r) => r.remaining))).toEqual([
      [40, 39, 40, 38],
      [100, 90, 1],
      [41],
    ]);
    expect(splitSegments([])).toEqual([]);
  });

  test('the current segment drops readings from before the live window opened', () => {
    // History never saw the refill: the live window opened at +2 h, after the last old reading.
    const readings = at([
      [-10, 50],
      [-5, 40],
      [0, 30],
      [3, 98],
      [4, 97],
    ]);
    expect(currentSegment(readings, NOW + 2 * H, NOW + 4 * H).map((r) => r.remaining)).toEqual([
      98, 97,
    ]);
    expect(currentSegment(readings, null, NOW + 4 * H).map((r) => r.remaining)).toEqual([98, 97]);
    expect(currentSegment(readings, null, NOW).map((r) => r.remaining)).toEqual([50, 40, 30]);
  });
});

describe('burn rate', () => {
  test('Theil-Sen ignores one outlier and averages the two middle slopes', () => {
    // Drains 2 points an hour; the +2 h reading is a 10-point outlier.
    const slope = theilSenPerHour(
      at([
        [0, 100],
        [1, 98],
        [2, 86],
        [3, 94],
        [4, 92],
      ])
    );
    expect(slope).toBeCloseTo(-2);
    // Six pair slopes -4, -2.5, -2.5, -2, -1, -1: the median averages -2.5 and -2.
    expect(
      theilSenPerHour(
        at([
          [0, 10],
          [1, 9],
          [2, 5],
          [3, 4],
        ])
      )
    ).toBeCloseTo(-2.25);
    expect(theilSenPerHour(at([[0, 10]]))).toBeNull();
    expect(theilSenPerHour([...at([[0, 10]]), ...at([[0, 9]])])).toBeNull();
  });

  test('recent rate uses only the burn window and never readings after now', () => {
    const segment = at([
      [-6, 100],
      [-3, 70],
      [-2, 66],
      [-1, 62],
      [0, 58],
      [1, 0],
    ]);
    expect(recentBurnRate(segment, NOW, 3)).toEqual({ perHour: 4, basis: 'recent' });
  });

  test('too few readings in the window falls back to the segment average and says so', () => {
    const segment = at([
      [-10, 100],
      [-0.5, 81],
      [0, 80],
    ]);
    expect(recentBurnRate(segment, NOW, 1)).toEqual({ perHour: 2, basis: 'segment' });
    expect(recentBurnRate(at([[0, 80]]), NOW, 1)).toBeNull();
  });

  test('readings after the account emptied do not count as zero drain', () => {
    // Drained 5 points an hour to 0 at -10 h, then sat at 0.
    const segment = at([
      [-20, 50],
      [-15, 25],
      [-10, 0],
      [-3, 0],
      [-2, 0],
      [-1, 0],
      [0, 0],
    ]);
    expect(recentBurnRate(segment, NOW, 3)).toEqual({ perHour: 5, basis: 'segment' });
  });

  test('a rising wobble is no drain, not negative drain', () => {
    expect(
      recentBurnRate(
        at([
          [-1, 50],
          [-0.5, 51],
          [0, 51],
        ]),
        NOW,
        1
      )?.perHour
    ).toBe(0);
  });

  test('average of window is used percent over hours since the window opened', () => {
    expect(windowAverageRate(58, NOW + 84 * H, 168, NOW)).toEqual({
      perHour: 0.5,
      basis: 'window',
    });
    expect(windowAverageRate(90, NOW + 167.5 * H, 168, NOW)?.perHour).toBe(0);
    expect(windowAverageRate(50, null, 168, NOW)).toBeNull();
  });

  test('future usage picks the method; no history means no rate', () => {
    const live = { remaining: 58, resetAtMs: NOW + 84 * H, periodHours: 168 };
    const readings = at([
      [-3, 70],
      [-2, 66],
      [-1, 62],
      [0, 58],
    ]);
    expect(accountRate(live, readings, NOW, { usage: 'same', burnHours: 3 })?.basis).toBe('recent');
    expect(accountRate(live, readings, NOW, { usage: 'average', burnHours: 3 })?.basis).toBe(
      'window'
    );
    expect(accountRate(live, readings, NOW, { usage: 'refill', burnHours: 3 })).toEqual({
      perHour: 4,
      basis: 'segment',
    });
    expect(accountRate(live, [], NOW, { usage: 'same', burnHours: 3 })).toBeNull();
    expect(accountRate(live, [], NOW, { usage: 'average', burnHours: 3 })).toBeNull();
  });
});

describe('projection', () => {
  test('hits 0 at the exact instant, holds 0 until the reset, refills to the cap, and repeats', () => {
    const p = projectAccount(
      { remaining: 20, perHour: 2, resetAtMs: NOW + 30 * H, periodHours: 40 },
      NOW,
      NOW + 100 * H
    );
    expect(p.emptyAtMs).toBe(NOW + 10 * H);
    expect(valueAt(p.points, NOW + 5 * H, 'after')).toBeCloseTo(10);
    expect(valueAt(p.points, NOW + 29 * H, 'after')).toBe(0);
    expect(valueAt(p.points, NOW + 30 * H, 'before')).toBe(0);
    expect(valueAt(p.points, NOW + 30 * H, 'after')).toBe(100);
    expect(p.refills).toEqual([
      { atMs: NOW + 30 * H, restore: 100 },
      { atMs: NOW + 70 * H, restore: 80 },
    ]);
    for (const point of p.points) {
      expect(point.remaining).toBeGreaterThanOrEqual(0);
      expect(point.remaining).toBeLessThanOrEqual(100);
    }
  });

  test('an account that reaches 0 exactly at its reset is empty there, as the pool says', () => {
    for (const start of [
      { remaining: 20, perHour: 2, resetAtMs: NOW + 10 * H, periodHours: 168 },
      { remaining: 50, perHour: 50 / 84, resetAtMs: NOW + 84 * H, periodHours: 168 },
    ]) {
      const p = projectAccount(start, NOW, NOW + 200 * H);
      expect(p.emptyAtMs).toBe(start.resetAtMs);
      expect(valueAt(p.points, start.resetAtMs, 'before')).toBe(0);
      expect(p.refills[0]).toEqual({ atMs: start.resetAtMs, restore: 100 });
      expect(sumProjections([{ projection: p, perHour: start.perHour }]).emptyAtMs).toBe(
        p.emptyAtMs
      );
    }
  });

  test('a stale reset never refills, and an unknown period stops after the first reset', () => {
    const stale = projectAccount(
      { remaining: 30, perHour: 1, resetAtMs: NOW - H, periodHours: 168 },
      NOW,
      NOW + 50 * H
    );
    expect(stale.refills).toEqual([]);
    expect(valueAt(stale.points, NOW + 40 * H, 'after')).toBe(0);
    const once = projectAccount(
      { remaining: 50, perHour: 0, resetAtMs: NOW + H, periodHours: null },
      NOW,
      NOW + 500 * H
    );
    expect(once.refills).toEqual([{ atMs: NOW + H, restore: 50 }]);
  });

  test('an input above the cap is clamped', () => {
    const p = projectAccount(
      { remaining: 140, perHour: 0, resetAtMs: null, periodHours: null },
      NOW,
      NOW + H
    );
    expect(p.points[0].remaining).toBe(100);
  });

  test('the pool is the sum of accounts, keeps each jump, and is empty only when all are', () => {
    const a = projectAccount(
      { remaining: 10, perHour: 1, resetAtMs: NOW + 20 * H, periodHours: 168 },
      NOW,
      NOW + 30 * H
    );
    const b = projectAccount(
      { remaining: 30, perHour: 2, resetAtMs: NOW + 25 * H, periodHours: 168 },
      NOW,
      NOW + 30 * H
    );
    const pool = sumProjections([
      { projection: a, perHour: 1 },
      { projection: b, perHour: 2 },
    ]);
    expect(pool.points[0]).toEqual({ atMs: NOW, remaining: 40 });
    expect(pool.drainPerHour).toBe(3);
    expect(valueAt(pool.points, NOW + 10 * H, 'after')).toBeCloseTo(10);
    expect(pool.emptyAtMs).toBe(NOW + 15 * H);
    expect(valueAt(pool.points, NOW + 20 * H, 'after')).toBeCloseTo(100);
    expect(valueAt(pool.points, NOW + 25 * H, 'after')).toBeCloseTo(195);
    expect(pool.refills).toEqual([
      { atMs: NOW + 20 * H, restore: 100 },
      { atMs: NOW + 25 * H, restore: 100 },
    ]);

    const alive = sumProjections([
      { projection: a, perHour: 1 },
      {
        projection: projectAccount(
          { remaining: 90, perHour: 0, resetAtMs: null, periodHours: null },
          NOW,
          NOW + 30 * H
        ),
        perHour: 0,
      },
    ]);
    expect(alive.emptyAtMs).toBeNull();
  });

  test('pool drain now skips accounts already at 0', () => {
    const empty = projectAccount(
      { remaining: 0, perHour: 4, resetAtMs: NOW + 5 * H, periodHours: 168 },
      NOW,
      NOW + 10 * H
    );
    const live = projectAccount(
      { remaining: 50, perHour: 1, resetAtMs: null, periodHours: null },
      NOW,
      NOW + 10 * H
    );
    const pool = sumProjections([
      { projection: empty, perHour: 4 },
      { projection: live, perHour: 1 },
    ]);
    expect(pool.drainPerHour).toBe(1);
  });
});

describe('recorded history', () => {
  test('the pool line sums each account once all have a reading, and labels refills', () => {
    const a = at([
      [0, 80],
      [1, 70],
      [2, 100],
    ]);
    const b = at([
      [0.25, 50],
      [1.25, 40],
    ]);
    const history = poolHistory([a, b], NOW, NOW + 2 * H, 15 * 60_000);
    const points = history.runs.flat();
    expect(history.runs).toHaveLength(1);
    expect(points[0]).toEqual({ atMs: NOW + 0.25 * H, remaining: 130 });
    expect(points.find((p) => p.atMs === NOW + 1.25 * H)?.remaining).toBe(110);
    expect(points[points.length - 1].remaining).toBe(140);
    expect(history.refills).toEqual([{ atMs: NOW + 2 * H, restore: 30 }]);
  });

  test('a gap in the recording breaks the pool line instead of holding old readings', () => {
    const a = at([
      [0, 80],
      [0.25, 79],
      [10, 60],
      [10.25, 59],
    ]);
    const history = poolHistory([a], NOW, NOW + 10.25 * H, 15 * 60_000);
    const hours = history.runs.flat().map((p) => (p.atMs - NOW) / H);
    expect(history.runs).toHaveLength(2);
    expect(hours.some((h) => h > 3.25 && h < 10)).toBe(false);
    expect(hours).toContain(10);
  });

  test('hourly drain counts drops only; refills and wobble rises are not use', () => {
    const a = at([
      [0, 80],
      [0.5, 79],
      [0.6, 80],
      [1.5, 70],
      [1.7, 100],
    ]);
    const bars = hourlyDrain([a], NOW, NOW + 2 * H);
    expect(bars.map((bar) => bar.drain)).toEqual([1, 10]);
  });
});

describe('drain card', () => {
  const entry: QuotaFileEntry = { file: { name: 'a.json', type: 'claude' }, type: 'claude' };
  const window: PoolWindow = {
    key: 'claude:seven-day',
    label: { text: 'seven-day' },
    periodHours: 168,
    members: [{ entry, status: 'reported', remainingPercent: 30, resetAtMs: NOW + 100 * H }],
    reportedCount: 1,
    unknownCount: 0,
    absentCount: 0,
    totalRemaining: 30,
    capacity: 100,
    nextReset: null,
    allResetAtMs: null,
    staleCount: 0,
  };
  const series = (points: [number, number, 0 | 1][]): QuotaHistorySeries[] => [
    {
      auth_index: 'a',
      window: 'seven-day',
      points: points.map(([hours, remaining, passive]) => [
        (NOW + hours * H) / 1000,
        remaining,
        passive,
      ]),
    },
  ];
  const card = (history: QuotaHistorySeries[], usage: FutureUsage) =>
    buildDrainCard({
      provider: 'claude',
      window,
      history: 'seven-day',
      size: 'full',
      authIndexOf: () => 'a',
      rateSeries: history,
      drawSeries: history,
      nowMs: NOW,
      fromMs: NOW - 24 * H,
      toMs: NOW + 24 * H,
      options: { usage, burnHours: 3 },
    });
  const forecastRate = (model: ReturnType<typeof card>) =>
    model?.kind === 'forecast' ? model.accounts[0].rate.perHour : null;

  test('a refill seen only in a passive reading still starts a new segment', () => {
    const history = series([
      [-3, 50, 0],
      [-2, 90, 1],
      [-1, 40, 0],
      [0, 30, 0],
    ]);
    expect(forecastRate(card(history, 'refill'))).toBeCloseTo(10);
  });

  test('passive readings alone give no drain rate for the history methods', () => {
    const history = series([
      [-3, 90, 1],
      [-2, 70, 1],
      [-1, 50, 1],
      [0, 30, 1],
    ]);
    expect(card(history, 'refill')?.kind).toBe('sparse');
    expect(card(history, 'same')?.kind).toBe('sparse');
    expect(card(history, 'average')?.kind).toBe('forecast');
  });

  test('history too sparse for the method keeps a card that says so', () => {
    const history = series([[0, 30, 0]]);
    const model = card(history, 'refill');
    expect(model?.kind).toBe('sparse');
    expect(card([], 'refill')).toBeNull();

    const html = renderToStaticMarkup(
      createElement(DrainCard, {
        model: model as NonNullable<typeof model>,
        tab: 'remaining',
        burnHours: 3,
        showAccounts: false,
        now: NOW,
        fromMs: NOW - 24 * H,
        toMs: NOW + 24 * H,
        resolvedTheme: 'light',
        nameOf: () => 'a',
      })
    );
    expect(html).toContain(i18n.t('quota_management.drain_sparse'));
    expect(html).toContain('30%');
    expect(html).not.toContain('<svg');
  });
});

describe('drain card pool with an account that has no rate', () => {
  const entryOf = (name: string): QuotaFileEntry => ({
    file: { name, type: 'claude', authIndex: name },
    type: 'claude',
  });
  const member = (name: string, remainingPercent: number, resetInHours: number) => ({
    entry: entryOf(name),
    status: 'reported' as const,
    remainingPercent,
    resetAtMs: NOW + resetInHours * H,
  });
  const poolOf = (members: ReturnType<typeof member>[]): PoolWindow => ({
    key: 'claude:seven-day',
    label: { text: 'seven-day' },
    periodHours: 168,
    members,
    reportedCount: members.length,
    unknownCount: 0,
    absentCount: 0,
    totalRemaining: members.reduce((sum, m) => sum + m.remainingPercent, 0),
    capacity: 100 * members.length,
    nextReset: null,
    allResetAtMs: null,
    staleCount: 0,
  });
  /** `drained` has a steady pace down to 0; `fresh` has one reading since its refill. */
  const history: QuotaHistorySeries[] = [
    {
      auth_index: 'drained',
      window: 'seven-day',
      points: [-6, -4, -2, 0].map((h, i) => [(NOW + h * H) / 1000, 30 - i * 10, 0]),
    },
    { auth_index: 'fresh', window: 'seven-day', points: [[(NOW - H) / 1000, 97, 0]] },
  ];
  const card = (members: ReturnType<typeof member>[]) => {
    const model = buildDrainCard({
      provider: 'claude',
      window: poolOf(members),
      history: 'seven-day',
      size: 'full',
      authIndexOf: (entry) => entry.file.name,
      rateSeries: history,
      drawSeries: history,
      nowMs: NOW,
      fromMs: NOW - 24 * H,
      toMs: NOW + 10 * 24 * H,
      options: { usage: 'same', burnHours: 3 },
    });
    if (model?.kind !== 'forecast') throw new Error('expected a forecast card');
    return model;
  };

  test('the pool is not empty while an account without a rate still holds quota', () => {
    const model = card([member('drained', 0, 30), member('fresh', 97, 60)]);
    expect(model.unrecordedCount).toBe(1);
    expect(model.pool.points[0].remaining).toBe(97);
    expect(model.pool.emptyAtMs).toBeNull();
  });

  test('that account holds its figure, refills at its reset, and adds no drain', () => {
    const model = card([member('drained', 0, 30), member('fresh', 97, 60)]);
    expect(valueAt(model.pool.points, NOW + 29 * H, 'after')).toBeCloseTo(97);
    const refill =
      valueAt(model.pool.points, NOW + 60 * H, 'after') -
      valueAt(model.pool.points, NOW + 60 * H, 'before');
    expect(refill).toBeCloseTo(3);
    expect(model.pool.drainPerHour).toBe(0);
    expect(model.burn.perHour).toBe(0);
  });

  test('the pool still reads empty now when every account is at 0', () => {
    const model = card([member('drained', 0, 30), member('fresh', 0, 60)]);
    expect(model.pool.emptyAtMs).toBe(NOW);
  });
});
