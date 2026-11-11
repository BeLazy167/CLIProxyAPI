/**
 * One-number quota summary per credential for the ledger cell and the
 * "Lowest quota" sort: the window with the least remaining capacity.
 */

import type { AuthFileItem } from '@/types';
import { resolveQuotaProviderType } from '@/features/quota/logic';
import { normalizeQuotaWindows, type NormalizedQuotaWindow } from '@/features/quota/quotaWindows';
import type { QuotaProviderType } from '@/features/quota/providers/types';

export { resolveQuotaProviderType };

/** Lowest-remaining window of a loaded quota; null when nothing reports a percent. */
export const worstQuotaWindow = (
  type: QuotaProviderType,
  quota: unknown
): NormalizedQuotaWindow | null => {
  let worst: NormalizedQuotaWindow | null = null;
  for (const window of normalizeQuotaWindows(type, quota)) {
    if (window.remainingPercent === null) continue;
    if (worst === null || window.remainingPercent < (worst.remainingPercent ?? 100)) {
      worst = window;
    }
  }
  return worst;
};

/** Percent for sorting: null when the file has no quota support or nothing loaded. */
export const worstQuotaPercent = (file: AuthFileItem, quota: unknown): number | null => {
  const type = resolveQuotaProviderType(file);
  if (!type) return null;
  return worstQuotaWindow(type, quota)?.remainingPercent ?? null;
};
