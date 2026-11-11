/**
 * Backtest of the quota drain forecast on saved Lamplighter history.
 *
 * Usage: bun scripts/drain-backtest.ts [historyDir] [reportPath]
 *
 * For every 7-day account window and every hour where the account was being
 * read, forecast from the readings up to that hour with each method and burn
 * window, then compare with what was recorded 6 h and 24 h later. The earlier
 * half of the history picks the default; the later half checks it.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Reading } from '../src/features/quota/drainSeries';
import {
  accountRate,
  projectAccount,
  valueAt,
  type ForecastOptions,
} from '../src/features/quota/quotaForecast';

const HOUR_MS = 3_600_000;
const PERIOD_HOURS = 168;
const HORIZONS = [6, 24] as const;
const MATCH_MS = 20 * 60_000;
const OBSERVED_MS = 30 * 60_000;
const SPLIT_MS = Date.UTC(2026, 9, 25);

const historyDir =
  process.argv[2] ?? join(homedir(), '.cli-proxy-api/plugins/data/lamplighter/history');
const reportPath = process.argv[3] ?? 'drain-backtest-report.md';

interface RawReading extends Reading {
  resetAtMs: number | null;
}

interface Method {
  name: string;
  options: ForecastOptions;
  activeOnly: boolean;
}

const METHODS: Method[] = [
  { name: 'average of window', options: { usage: 'average', burnHours: 3 }, activeOnly: false },
  { name: 'since last refill', options: { usage: 'refill', burnHours: 3 }, activeOnly: false },
  ...[1, 3, 6].flatMap((burnHours) =>
    [false, true].map((activeOnly) => ({
      name: `same as now, ${burnHours}h${activeOnly ? ', active polls only' : ''}`,
      options: { usage: 'same' as const, burnHours },
      activeOnly,
    }))
  ),
];

/** `r` is dropped from a line when it is 0 (the writer omits zero values); `x` marks the line as a real reading. */
function loadSeries(dir: string): Map<string, RawReading[]> {
  const series = new Map<string, RawReading[]>();
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line) as {
        k: string;
        t: number;
        g?: string;
        w?: string;
        r?: number;
        x?: number;
        s?: string;
      };
      if (o.k !== 's' || !o.g || !o.w || (o.r === undefined && o.x === undefined)) continue;
      if (!o.w.startsWith('seven-day')) continue;
      const [provider, account] = o.g.split(':');
      const key = `${provider}\t${o.w}\t${account}`;
      const list = series.get(key) ?? [];
      list.push({
        atMs: o.t * 1000,
        remaining: o.r ?? 0,
        passive: o.s === 'passive',
        resetAtMs: o.x === undefined ? null : o.x * 1000,
      });
      series.set(key, list);
    }
  }
  for (const list of series.values()) list.sort((a, b) => a.atMs - b.atMs);
  return series;
}

function nearest(readings: readonly RawReading[], atMs: number): RawReading | null {
  let best: RawReading | null = null;
  for (const reading of readings) {
    const gap = Math.abs(reading.atMs - atMs);
    if (gap <= MATCH_MS && (!best || gap < Math.abs(best.atMs - atMs))) best = reading;
  }
  return best;
}

interface Sample {
  provider: string;
  method: string;
  horizon: number;
  late: boolean;
  moving: boolean;
  error: number;
  basis: string;
}

const samples: Sample[] = [];
const series = loadSeries(historyDir);

for (const [key, readings] of series) {
  const [provider, window] = key.split('\t');
  const label = `${provider} ${window}`;
  const first = readings[0].atMs;
  const last = readings[readings.length - 1].atMs;
  for (let t = Math.ceil(first / HOUR_MS) * HOUR_MS + 6 * HOUR_MS; t <= last; t += HOUR_MS) {
    const known = readings.filter((reading) => reading.atMs <= t);
    const latest = known[known.length - 1];
    if (!latest || t - latest.atMs > OBSERVED_MS) continue;
    const live = {
      remaining: latest.remaining,
      resetAtMs: latest.resetAtMs,
      periodHours: PERIOD_HOURS,
    };
    const actuals = HORIZONS.map((h) => nearest(readings, t + h * HOUR_MS));
    if (actuals.every((actual) => actual === null)) continue;

    const active = known.filter((reading) => !reading.passive);
    const rates = METHODS.map((method) =>
      accountRate(live, method.activeOnly && active.length > 0 ? active : known, t, method.options)
    );
    if (rates.some((rate) => rate === null)) continue;
    METHODS.forEach((method, m) => {
      const rate = rates[m] as NonNullable<(typeof rates)[number]>;
      const projection = projectAccount({ ...live, perHour: rate.perHour }, t, t + 25 * HOUR_MS);
      HORIZONS.forEach((h, i) => {
        const actual = actuals[i];
        if (!actual) return;
        const predicted = valueAt(projection.points, actual.atMs, 'after');
        samples.push({
          provider: label,
          method: method.name,
          horizon: h,
          late: t >= SPLIT_MS,
          moving: Math.abs(actual.remaining - latest.remaining) >= 2,
          error: Math.abs(predicted - actual.remaining),
          basis: rate.basis,
        });
      });
    });
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const quantile = (values: number[], q: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const fmt = (value: number) => (Number.isNaN(value) ? 'n/a' : value.toFixed(2));
const pick = (filter: (s: Sample) => boolean) => samples.filter(filter);
const errors = (filter: (s: Sample) => boolean) => pick(filter).map((s) => s.error);

const candidates = METHODS.map((m) => m.name);
const trainMedian = (name: string) =>
  median(errors((s) => !s.late && s.method === name && s.horizon === 6 && s.moving));
const chosen = [...candidates].sort((a, b) => trainMedian(a) - trainMedian(b))[0];
const baseline = 'average of window';

const lines: string[] = [];
lines.push('# Drain forecast backtest', '');
lines.push(
  `Generated ${new Date().toISOString()} by \`bun scripts/drain-backtest.ts\` from \`${historyDir}\`.`,
  ''
);
lines.push(
  'Each sample is one account at one past hour where it had a reading in the previous 30 minutes and every method could forecast, so all methods score the same moments. ' +
    'The forecast uses only readings up to that hour, the live remaining figure and reset instant from the latest reading, and a 168 h period. ' +
    'It is compared with the reading recorded nearest 6 h or 24 h later (within 20 minutes). ' +
    'A line with `x` and no `r` counts as 0% left. ' +
    'Error is the absolute difference in percentage points.',
  ''
);
lines.push(
  `Early split: before ${new Date(SPLIT_MS).toISOString().slice(0, 10)} (picks the default). Late split: from that date on (checks it). ` +
    '"Moving" keeps only samples where the account changed by 2 points or more over the horizon; the rest are accounts parked at 0 or 100, which every method gets right.',
  ''
);
lines.push(`Default picked on the early split, 6 h, moving samples: **${chosen}**.`, '');

for (const late of [false, true]) {
  for (const moving of [true, false]) {
    lines.push(
      `## ${late ? 'Late' : 'Early'} split, ${moving ? 'moving samples' : 'all samples'}`,
      ''
    );
    lines.push(
      '| Provider window | Method | n 6h | median 6h | p90 6h | n 24h | median 24h | p90 24h |'
    );
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|');
    const providers = [...new Set(samples.map((s) => s.provider))].sort();
    for (const provider of [...providers, 'all']) {
      for (const method of METHODS) {
        const base = (s: Sample) =>
          s.late === late &&
          (!moving || s.moving) &&
          s.method === method.name &&
          (provider === 'all' || s.provider === provider);
        const e6 = errors((s) => base(s) && s.horizon === 6);
        const e24 = errors((s) => base(s) && s.horizon === 24);
        if (e6.length + e24.length === 0) continue;
        const mark = method.name === chosen ? ' (default)' : '';
        lines.push(
          `| ${provider} | ${method.name}${mark} | ${e6.length} | ${fmt(median(e6))} | ${fmt(quantile(e6, 0.9))} | ${e24.length} | ${fmt(median(e24))} | ${fmt(quantile(e24, 0.9))} |`
        );
      }
    }
    lines.push('');
  }
}

const requested = METHODS.filter((m) => m.options.usage === 'same' && m.activeOnly).map(
  (m) => m.name
);
const median6 = (name: string, late: boolean, moving: boolean) =>
  median(
    errors((s) => s.late === late && (!moving || s.moving) && s.method === name && s.horizon === 6)
  );
lines.push(
  '## Pass check: recent burn rate (Theil-Sen, active polls) against average of window, 6 h, all providers',
  ''
);
lines.push(
  'Pass needs a median of at most 5 points and a lower median than average of window on the same samples.',
  ''
);
lines.push(
  '| Method | Split | Samples | median | average-of-window median | at most 5 | beats average |'
);
lines.push('|---|---|---|---:|---:|---|---|');
for (const name of requested) {
  for (const late of [false, true]) {
    for (const moving of [true, false]) {
      const own = median6(name, late, moving);
      const base = median6(baseline, late, moving);
      lines.push(
        `| ${name} | ${late ? 'late' : 'early'} | ${moving ? 'moving' : 'all'} | ${fmt(own)} | ${fmt(base)} | ${own <= 5 ? 'yes' : 'no'} | ${own < base ? 'yes' : own === base ? 'tie' : 'no'} |`
      );
    }
  }
}
lines.push('');

lines.push('## How often the recent rate fell back to the segment average (6 h samples)', '');
for (const name of requested) {
  const all = pick((s) => s.method === name && s.horizon === 6);
  const fallback = all.filter((s) => s.basis === 'segment').length;
  lines.push(`- ${name}: ${fallback} of ${all.length}`);
}
lines.push('');

writeFileSync(reportPath, lines.join('\n'));
console.log(lines.slice(lines.findIndex((line) => line.startsWith('## Pass check'))).join('\n'));
console.log(`samples ${samples.length}; report ${reportPath}`);
