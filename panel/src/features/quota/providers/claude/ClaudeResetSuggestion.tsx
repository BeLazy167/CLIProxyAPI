import { useTranslation } from 'react-i18next';
import { IconZap } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState } from '@/types';
import { formatInstantShort } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { formatDaysLeft } from '../../compactDuration';
import type { QuotaFileEntry } from '../../logic';
import type { QuotaCardState } from '..';
import { formatResetWindows, useClaudeResetGrants } from './ClaudeResetGrants';
import { groupResetGrants, suggestReset, type ResetGrantKind } from './resetGrantGroups';
import styles from './ClaudeResetGroups.module.scss';

export interface ClaudeResetSuggestionProps {
  /** Every Claude account; the suggestion compares them all. */
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  /** True when that account's ⚡ would be disabled. */
  isBlocked: (entry: QuotaFileEntry) => boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
}

/** One line naming the reset to use now across Claude accounts, or why none is worth it. */
export function ClaudeResetSuggestion({
  entries,
  quotaFor,
  isBlocked,
  onRefresh,
}: ClaudeResetSuggestionProps) {
  const { t } = useTranslation();
  const now = useNow();
  const suggestion = suggestReset(
    entries.map((entry) => {
      const quota = quotaFor(entry) as ClaudeQuotaState | undefined;
      const status = quota?.status === 'success' ? quota.resetGrants : null;
      return {
        account: entry,
        groups: status ? groupResetGrants(status, quota?.windows ?? [], now) : null,
      };
    })
  );

  if (suggestion.state === 'none') {
    return (
      <p className={styles.suggestion} data-testid="claude-reset-suggestion">
        <span className={styles.suggestionText}>
          {t(`claude_reset.suggest_none_${suggestion.reason}`)}
        </span>
      </p>
    );
  }

  const { account: entry, kind, endsAtMs, windows } = suggestion;
  const values = {
    kind: t(`claude_reset.kind_${kind}`),
    email:
      typeof entry.file.email === 'string' ? entry.file.email : getQuotaDisplayName(entry.file),
    windows: formatResetWindows(t, windows, now),
  };
  return (
    <p className={styles.suggestion} data-testid="claude-reset-suggestion">
      <span className={styles.suggestionText}>
        {endsAtMs === null
          ? t('claude_reset.suggest_ready_no_end', values)
          : t('claude_reset.suggest_ready', {
              ...values,
              expires: formatDaysLeft(t, endsAtMs - now),
              date: formatInstantShort(endsAtMs),
            })}
      </span>
      <SuggestedSpend
        key={`${entry.file.name}:${kind}`}
        entry={entry}
        kind={kind}
        quota={quotaFor(entry) as ClaudeQuotaState | undefined}
        blocked={isBlocked(entry)}
        onRefresh={() => onRefresh(entry)}
      />
    </p>
  );
}

/** The suggested account's own ⚡ flow: the same confirm dialog and claim as its row. */
function SuggestedSpend({
  entry,
  kind,
  quota,
  blocked,
  onRefresh,
}: {
  entry: QuotaFileEntry;
  kind: ResetGrantKind;
  quota: ClaudeQuotaState | undefined;
  blocked: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const reset = useClaudeResetGrants(entry.file, quota, blocked, onRefresh);
  const group = reset.groups.find((candidate) => candidate.kind === kind);
  return (
    <button
      type="button"
      className={styles.suggestionSpend}
      disabled={reset.blocked || group?.action.state !== 'ready'}
      onClick={() => group && reset.confirm(group)}
    >
      <IconZap size={14} aria-hidden="true" className={reset.busy ? styles.pulsing : undefined} />
      {t('claude_reset.suggest_use')}
    </button>
  );
}
