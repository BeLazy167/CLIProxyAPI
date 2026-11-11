/**
 * One credential's quota windows, normalized to *percent remaining*.
 *
 * The provider states disagree about what a percentage means (Claude, Codex,
 * Meta and xAI report percent used; Antigravity a remaining fraction; Kimi raw
 * counts; Devin percent remaining) and where windows live. The pool summary and
 * the ledger both need to line windows up across credentials, so this is the
 * one place that reads those shapes into a comparable row.
 *
 * Pure and React-free: the quota state is read structurally, nothing here
 * imports the store, and missing values stay `null` — an unreported percentage
 * is never coerced to 0 (exhausted) or 100 (healthy).
 *
 * `key` is the like-for-like identity: two credentials of the same provider
 * share a key exactly when they report the same limit. It deliberately avoids
 * positional ids (Codex additional limits and Kimi limits carry the payload
 * index), so an account that reports an extra window can't shift the others.
 */

import { parseIsoToMs } from '@/utils/quota';
import type { QuotaProviderType } from './providers/types';

export interface QuotaWindowLabel {
  /** i18n key, preferred at render time so a language switch re-labels the row. */
  key?: string;
  params?: Record<string, string | number>;
  /** Fallback text — a payload label, or the label baked at fetch time. */
  text: string;
}

export interface NormalizedQuotaWindow {
  key: string;
  label: QuotaWindowLabel;
  /** Percent remaining, 0..100; null when the provider did not report it. */
  remainingPercent: number | null;
  /** Instant this window's capacity comes back; null when not reported. */
  resetAtMs: number | null;
  periodHours: number | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

const paramsKey = (params: Record<string, string | number> | undefined): string =>
  params
    ? Object.keys(params)
        .sort()
        .map((name) => `${name}=${params[name]}`)
        .join('&')
    : '';

interface LabelledWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface AntigravityBucketLike {
  id?: string;
  label?: string;
  remainingFraction?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface KimiRowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  used?: number;
  limit?: number;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface DevinWindowLike {
  id: string;
  label?: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours?: number | null;
}

interface MetaWindowLike {
  id: 'window' | 'weekly';
  usedPercent: number | null;
  resetAt?: number;
  durationMinutes?: number;
}

interface XaiBillingLike {
  mode?: string;
  periodType?: string;
  usagePercent?: number | null;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
  monthlyLimitCents?: number | null;
  billingPeriodEnd?: string;
}

/** Label-derived identity for windows whose ids are positional. */
const labelledKey = (provider: QuotaProviderType, window: LabelledWindowLike): string => {
  const base = window.labelKey ?? window.label ?? window.id ?? '';
  const params = paramsKey(window.labelParams);
  return params ? `${provider}:${base}:${params}` : `${provider}:${base}`;
};

const fromLabelled = (window: LabelledWindowLike, key: string): NormalizedQuotaWindow => ({
  key,
  label: {
    key: window.labelKey,
    params: window.labelParams,
    text: window.label ?? window.id ?? '',
  },
  remainingPercent: remainingFromUsed(window.usedPercent),
  resetAtMs: finiteOrNull(window.resetAtMs),
  periodHours: finiteOrNull(window.periodHours),
});

/** Keep the first occurrence of a key; a duplicate would double-count in a pool. */
const dedupe = (windows: NormalizedQuotaWindow[]): NormalizedQuotaWindow[] => {
  const seen = new Set<string>();
  return windows.filter((window) => {
    if (seen.has(window.key)) return false;
    seen.add(window.key);
    return true;
  });
};

/**
 * Normalized windows for a loaded credential; empty for any other status.
 * Callers distinguish "not loaded / failed" from "loaded, no windows" by status.
 */
export function normalizeQuotaWindows(
  provider: QuotaProviderType,
  quota: unknown
): NormalizedQuotaWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude') {
    // Claude ids come from fixed payload keys, so they are already stable.
    const windows = (quota as { windows?: LabelledWindowLike[] }).windows ?? [];
    return dedupe(windows.map((window) => fromLabelled(window, `claude:${window.id ?? ''}`)));
  }

  if (provider === 'codex') {
    const windows = (quota as { windows?: LabelledWindowLike[] }).windows ?? [];
    return dedupe(windows.map((window) => fromLabelled(window, labelledKey(provider, window))));
  }

  if (provider === 'devin') {
    const windows = (quota as { windows?: DevinWindowLike[] }).windows ?? [];
    return dedupe(
      windows.map((window) => ({
        key: `devin:${window.id}`,
        label: { key: `devin_quota.${window.id}`, text: window.label ?? window.id },
        remainingPercent:
          finiteOrNull(window.remainingPercent) === null
            ? null
            : clampPercent(window.remainingPercent as number),
        resetAtMs: finiteOrNull(window.resetAtMs),
        periodHours: finiteOrNull(window.periodHours),
      }))
    );
  }

  if (provider === 'meta') {
    const windows = (quota as { data?: { windows?: MetaWindowLike[] } }).data?.windows ?? [];
    return dedupe(
      windows.map((window) => {
        const resetAt = finiteOrNull(window.resetAt);
        const minutes =
          window.id === 'weekly' ? 7 * 24 * 60 : (finiteOrNull(window.durationMinutes) ?? null);
        return {
          key: `meta:${window.id}`,
          label: { key: `meta_quota.${window.id}`, text: window.id },
          remainingPercent: remainingFromUsed(window.usedPercent),
          // Meta reports Unix seconds.
          resetAtMs: resetAt === null ? null : resetAt * 1000,
          periodHours: minutes === null || minutes <= 0 ? null : minutes / 60,
        };
      })
    );
  }

  if (provider === 'antigravity') {
    const buckets = (
      (quota as { groups?: { buckets?: AntigravityBucketLike[] }[] }).groups ?? []
    ).flatMap((group) => group.buckets ?? []);
    return dedupe(
      buckets.map((bucket) => {
        const fraction = finiteOrNull(bucket.remainingFraction);
        return {
          key: `antigravity:${bucket.id ?? bucket.label ?? ''}`,
          label: { text: bucket.label ?? bucket.id ?? '' },
          // Antigravity reports the fraction REMAINING.
          remainingPercent: fraction === null ? null : clampPercent(fraction * 100),
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          periodHours: finiteOrNull(bucket.periodHours),
        };
      })
    );
  }

  if (provider === 'kimi') {
    const rows = (quota as { rows?: KimiRowLike[] }).rows ?? [];
    return dedupe(
      rows.map((row) => {
        const used = finiteOrNull(row.used);
        const limit = finiteOrNull(row.limit);
        return {
          key: labelledKey(provider, row),
          label: { key: row.labelKey, params: row.labelParams, text: row.label ?? row.id ?? '' },
          // Kimi reports raw counts; a zero limit has no meaningful percentage.
          remainingPercent:
            used === null || limit === null || limit <= 0
              ? null
              : clampPercent(((limit - used) / limit) * 100),
          resetAtMs: finiteOrNull(row.resetAtMs),
          periodHours: finiteOrNull(row.periodHours),
        };
      })
    );
  }

  if (provider === 'xai') {
    const billing = (quota as { billing?: XaiBillingLike | null }).billing;
    // Paid-health mode proves the account answers but carries no quota figures.
    if (!billing || billing.mode === 'paid-health') return [];
    const windows: NormalizedQuotaWindow[] = [];
    if (billing.periodType === 'weekly') {
      windows.push({
        key: 'xai:weekly',
        label: { key: 'xai_quota.weekly_limit', text: 'weekly' },
        remainingPercent: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        periodHours: finiteOrNull(billing.periodHours) ?? 24 * 7,
      });
    }
    // The monthly credit allowance is a spend cap with its own rollover; it is
    // a separate identity so it never pools with a weekly rate limit.
    const monthlyLimit = finiteOrNull(billing.monthlyLimitCents);
    if (monthlyLimit !== null && monthlyLimit > 0) {
      windows.push({
        key: 'xai:monthly',
        label: { key: 'xai_quota.monthly_credits', text: 'monthly' },
        remainingPercent: remainingFromUsed(billing.usedPercent),
        resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
        periodHours: null,
      });
    }
    return windows;
  }

  return [];
}

/** Render a window label in the current language, falling back to the payload text. */
export const formatQuotaWindowLabel = (
  t: (key: string, options?: Record<string, unknown>) => string,
  label: QuotaWindowLabel
): string => (label.key ? t(label.key, { ...label.params, defaultValue: label.text }) : label.text);

/** Display rounding for a percent remaining; `--` when unknown, never a guessed number. */
export const formatRemainingPercent = (percent: number | null): string =>
  percent === null ? '--' : `${Math.round(percent)}%`;
