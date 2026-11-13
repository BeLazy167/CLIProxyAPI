import type { ClaudeQuotaState } from '@/types';
import type { QuotaFileEntry } from '../../logic';
import type { QuotaCardState } from '..';
import { groupResetGrants, suggestReset, type ResetSuggestion } from './resetGrantGroups';

/** The one reset worth using now across every Claude account, from their loaded grants. */
export function claudeResetSuggestion(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  now: number
): ResetSuggestion<QuotaFileEntry> {
  return suggestReset(
    entries.map((entry) => {
      const quota = quotaFor(entry) as ClaudeQuotaState | undefined;
      const status = quota?.status === 'success' ? quota.resetGrants : null;
      return {
        account: entry,
        groups: status ? groupResetGrants(status, quota?.windows ?? [], now) : null,
      };
    })
  );
}
