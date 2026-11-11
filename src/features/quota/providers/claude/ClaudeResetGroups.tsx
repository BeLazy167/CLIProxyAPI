import { useTranslation } from 'react-i18next';
import { IconTimer, IconZap } from '@/components/ui/icons';
import { formatInstantShort } from '@/utils/quota';
import { formatDaysLeft } from '../../compactDuration';
import type { ClaudeResetGrantsView } from './ClaudeResetGrants';
import styles from './ClaudeResetGroups.module.scss';

/** One line per reset group: count, kind, soonest end, and its ⚡ spend button. */
export function ClaudeResetGroups({ reset, now }: { reset: ClaudeResetGrantsView; now: number }) {
  const { t } = useTranslation();
  if (reset.groups.length === 0 && !reset.message) return null;
  return (
    <div className={styles.groups}>
      {reset.groups.map((group) => {
        const kind = t(`claude_reset.kind_${group.kind}`);
        const reason =
          group.action.state === 'blocked' ? t(`claude_reset.block_${group.action.reason}`) : null;
        const spendLabel = t(
          group.action.state === 'ready' && group.action.retry
            ? 'claude_reset.retry'
            : 'claude_reset.spend_label',
          { kind }
        );
        return (
          <div key={group.kind} className={styles.group}>
            <span
              className={styles.summary}
              aria-label={t('claude_reset.group_label', { count: group.resetsLeft, kind })}
            >
              <span className={styles.count}>{group.resetsLeft}</span>
              <span className={styles.kind}>{kind}</span>
              {group.endsAtMs !== null && (
                <span
                  className={styles.expiry}
                  title={t('claude_reset.expires', {
                    time: formatDaysLeft(t, group.endsAtMs - now),
                    date: formatInstantShort(group.endsAtMs),
                  })}
                >
                  <IconTimer size={12} aria-hidden="true" />
                  {formatDaysLeft(t, group.endsAtMs - now)}
                </span>
              )}
            </span>
            {reason && (
              <span className={styles.reason} title={reason}>
                {reason}
              </span>
            )}
            <button
              type="button"
              className={styles.spend}
              disabled={reset.blocked || group.action.state !== 'ready'}
              onClick={() => reset.confirm(group)}
              aria-label={reason ? `${spendLabel} · ${reason}` : spendLabel}
              title={reason ?? spendLabel}
            >
              <IconZap
                size={15}
                aria-hidden="true"
                className={reset.busy ? styles.pulsing : undefined}
              />
            </button>
          </div>
        );
      })}
      {reset.message && (
        <p role="status" className={styles.message}>
          {t(`claude_reset.${reset.message}`)}
        </p>
      )}
    </div>
  );
}
