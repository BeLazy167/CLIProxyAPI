import { describe, expect, test } from 'bun:test';
import {
  buildHourlyDrain,
  buildPoolForecast,
  buildPoolHistory,
  burnRatePerHour,
} from '@/features/quota/quotaForecast';
import type { PoolWindow } from '@/features/quota/quotaPool';

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 12, 12);

const member = (remainingPercent: number, resetInHours: number) =>
  ({
    entry: {} as never,
    status: 'reported',
    remainingPercent,
    resetAtMs: NOW + resetInHours * H,
  }) as PoolWindow['members'][number];

const window = (members: PoolWindow['members']): PoolWindow =>
  ({ periodHours: 168, members, capacity: members.length * 100 }) as PoolWindow;

describe('quota forecast', () => {
  test('burn rate is used percent over hours since the window opened', () => {
    // 84 h into a 168 h window with 42% used → 0.5 %/h.
    expect(burnRatePerHour(58, NOW + 84 * H, 168, NOW)).toBeCloseTo(0.5);
    expect(burnRatePerHour(90, NOW + 167.5 * H, 168, NOW)).toBe(0);
    expect(burnRatePerHour(50, null, 168, NOW)).toBe(0);
  });

  test('drains, floors at zero, and jumps back to full at each reset', () => {
    // A: 0.5 %/h, resets in 84 h. B: 50% used in 24 h → ~2.08 %/h, empty in 24 h, resets in 144 h.
    const forecast = buildPoolForecast(window([member(58, 84), member(50, 144)]), NOW, 168)!;
    expect(forecast.capacity).toBe(200);
    expect(forecast.remaining).toBe(108);
    expect(forecast.drainPerHour).toBeCloseTo(0.5 + 50 / 24);

    const at = (h: number) => forecast.points.filter((p) => p.atMs === NOW + h * H).map((p) => p.remaining);
    // At 84 h: A hit 16%, B is empty; then A refills to 100.
    expect(at(84)[0]).toBeCloseTo(16);
    expect(at(84).at(-1)).toBeCloseTo(100);
    expect(forecast.resets.map((r) => (r.atMs - NOW) / H)).toEqual([84, 144]);
    expect(forecast.resets[0].restore).toBeCloseTo(84);
    expect(Math.min(...forecast.points.map((p) => p.remaining))).toBeGreaterThanOrEqual(0);
  });

  test('history sums accounts once all have a sample, and ignores passive wobble', () => {
    const s = (auth: string, pts: [number, number, number][]) => ({ auth_index: auth, window: 'seven-day', points: pts });
    const t0 = NOW / 1000;
    const series = [
      s('a', [[t0, 80, 0], [t0 + 1800, 79, 1], [t0 + 1860, 80, 1], [t0 + 3600, 70, 0]]),
      s('b', [[t0 + 900, 50, 0], [t0 + 4500, 100, 0]]),
      { auth_index: 'a', window: 'five-hour', points: [[t0, 5, 0]] as [number, number, number][] },
    ];
    const history = buildPoolHistory(series, ['a', 'b'], 'seven-day', NOW, NOW + 2 * H);
    expect(history[0]).toEqual({ atMs: NOW + 15 * 60_000, remaining: 130 });
    expect(history.find((p) => p.atMs === NOW + H)?.remaining).toBe(120);
    expect(history.at(-1)?.remaining).toBe(170);

    // Only a's 80→70 drop counts; b's reset to 100 and a's passive 79/80 wobble do not.
    const drain = buildHourlyDrain(series, ['a', 'b'], 'seven-day', NOW, NOW + 2 * H);
    expect(drain.map((bar) => bar.drain)).toEqual([0, 10]);
  });

  test('nothing reported means no forecast', () => {
    expect(buildPoolForecast(window([]), NOW, 168)).toBeNull();
  });
});
