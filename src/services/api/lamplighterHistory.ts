import { apiClient } from './client';
import { normalizeApiBase } from '@/utils/connection';
import type { QuotaHistorySeries } from '@/features/quota/quotaForecast';

/**
 * Quota history recorded by the Lamplighter plugin. Plugin routes keep their
 * backend-declared v0 path, so this is an absolute URL rather than one under
 * the client's /v8/management base. Null when the plugin is not installed.
 */
export async function readLamplighterHistory(
  apiBase: string,
  range: '4d' | '8d'
): Promise<QuotaHistorySeries[] | null> {
  const url = `${normalizeApiBase(apiBase)}/v0/management/lamplighter/history`;
  return apiClient
    .get<{ series?: QuotaHistorySeries[] }>(url, { params: { range } })
    .then((data) => data.series ?? [])
    .catch(() => null);
}
