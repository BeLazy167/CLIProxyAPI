import { apiClient } from './client';
import { normalizeApiBase } from '@/utils/connection';
import type { QuotaHistorySeries } from '@/features/quota/drainSeries';

/**
 * Quota history recorded by the Lamplighter plugin. Plugin routes keep their
 * backend-declared v0 path, so this is an absolute URL rather than one under
 * the client's /v8/management base. Null when the plugin is not installed.
 * The route keeps raw readings up to 24h, 15-minute buckets for 8d and hourly
 * buckets for 36d; any other range falls back to 24h.
 */
export async function readLamplighterHistory(
  apiBase: string,
  range: '8d' | '36d'
): Promise<QuotaHistorySeries[] | null> {
  const url = `${normalizeApiBase(apiBase)}/v0/management/lamplighter/history`;
  return apiClient
    .get<{ series?: QuotaHistorySeries[] }>(url, { params: { range } })
    .then((data) => data.series ?? [])
    .catch(() => null);
}
