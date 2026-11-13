import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconZap } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState } from '@/types';
import { formatInstantShort } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { formatDaysLeft } from '../../compactDuration';
import type { QuotaFileEntry } from '../../logic';
import type { QuotaCardState } from '..';
import { formatResetWindows, useClaudeResetGrants } from './ClaudeResetGrants';
import type { ResetGrantKind, ResetSuggestion } from './resetGrantGroups';
import styles from './ClaudeResetGroups.module.scss';

export interface ClaudeResetSuggestionProps {
  suggestion: ResetSuggestion<QuotaFileEntry>;
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  /** True when that account's ⚡ would be disabled. */
  isBlocked: (entry: QuotaFileEntry) => boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
}

/** The reset notice: its title with the tip on how the pick is made, the text, and an action. */
function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.suggestion} data-testid="claude-reset-suggestion">
      <span className={styles.suggestionTitle}>
        {t('quota_management.reset_notice_title')}
        <Tooltip
          label={t('quota_management.tip_suggestion_label')}
          content={t('quota_management.tip_suggestion')}
        />
      </span>
      <p className={styles.suggestionText}>{children}</p>
      {action}
    </div>
  );
}

/** One notice naming the reset to use now across Claude accounts, or why none is worth it. */
export function ClaudeResetSuggestion({
  suggestion,
  quotaFor,
  isBlocked,
  onRefresh,
}: ClaudeResetSuggestionProps) {
  const { t } = useTranslation();
  const now = useNow();

  if (suggestion.state === 'none') {
    return <Notice>{t(`claude_reset.suggest_none_${suggestion.reason}`)}</Notice>;
  }

  const { account: entry, kind, endsAtMs, windows } = suggestion;
  const values = {
    kind: t(`claude_reset.kind_${kind}`),
    email:
      typeof entry.file.email === 'string' ? entry.file.email : getQuotaDisplayName(entry.file),
    windows: formatResetWindows(t, windows, now),
  };
  return (
    <Notice
      action={
        <SuggestedSpend
          key={`${entry.file.name}:${kind}`}
          entry={entry}
          kind={kind}
          quota={quotaFor(entry) as ClaudeQuotaState | undefined}
          blocked={isBlocked(entry)}
          onRefresh={() => onRefresh(entry)}
        />
      }
    >
      {endsAtMs === null
        ? t('claude_reset.suggest_ready_no_end', values)
        : t('claude_reset.suggest_ready', {
            ...values,
            expires: formatDaysLeft(t, endsAtMs - now),
            date: formatInstantShort(endsAtMs),
          })}
    </Notice>
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
    <Button
      size="sm"
      className={styles.suggestionSpend}
      disabled={reset.blocked || group?.action.state !== 'ready'}
      onClick={() => group && reset.confirm(group)}
    >
      <IconZap size={14} aria-hidden="true" className={reset.busy ? styles.pulsing : undefined} />
      {t('claude_reset.suggest_use')}
    </Button>
  );
}
