import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Two units, truncated like the relative countdowns: "2d 0h", "19h 11m", "11m". */
export function formatCountdown(t: Translate, ms: number): string {
  const span = Math.max(0, ms);
  const d = Math.floor(span / DAY_MS);
  const h = Math.floor((span % DAY_MS) / HOUR_MS);
  const m = Math.floor((span % HOUR_MS) / MINUTE_MS);
  if (d > 0) return t('quota_management.duration_days_hours', { d, h });
  if (h > 0) return t('quota_management.duration_hours_minutes', { h, m });
  return t('quota_management.duration_minutes', { m });
}

/** Whole days for a span of a day or more ("35d"), else the countdown. */
export function formatDaysLeft(t: Translate, ms: number): string {
  return ms >= DAY_MS
    ? t('quota_management.duration_days', { d: Math.floor(ms / DAY_MS) })
    : formatCountdown(t, ms);
}
