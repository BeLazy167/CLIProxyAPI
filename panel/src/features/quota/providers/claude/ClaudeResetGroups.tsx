import { useTranslation } from 'react-i18next';
import { IconCheck, IconTimer, IconZap } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatInstantShort } from '@/utils/quota';
import { formatDaysLeft } from '../../compactDuration';
import { formatResetWindows, type ClaudeResetGrantsView } from './ClaudeResetGrants';
import type { ResetGrantGroup, ResetGrantKind } from './resetGrantGroups';
import styles from './ClaudeResetGroups.module.scss';

/** What the grant clears, how many are left and when the soonest ends. */
function grantTip(t: ReturnType<typeof useTranslation>['t'], group: ResetGrantGroup, now: number) {
  const kind = t(`claude_reset.tip_kind_${group.kind}`, { count: group.resetsLeft });
  const expiry =
    group.endsAtMs === null
      ? t('claude_reset.tip_no_end')
      : t('claude_reset.tip_expires', {
          count: group.resetsLeft,
          time: formatDaysLeft(t, group.endsAtMs - now),
          date: formatInstantShort(group.endsAtMs),
        });
  return `${kind} ${expiry}`;
}

/** Why the spend is held, plus the windows the grant would clear when they are known. */
function eligibilityTip(
  t: ReturnType<typeof useTranslation>['t'],
  group: ResetGrantGroup,
  now: number
) {
  const action = group.action;
  if (action.state === 'ready') return t('claude_reset.tip_ready');
  const reason = t(`claude_reset.tip_block_${action.reason}`);
  if (!action.windows?.length) return reason;
  const clears = t('claude_reset.tip_clears', {
    kind: t(`claude_reset.kind_${group.kind}`),
    windows: formatResetWindows(t, action.windows, now),
  });
  return `${reason} ${clears}`;
}

/**
 * One line per reset group in three cells: the grant (count, kind, soonest end), its
 * eligibility, and its ⚡ spend button. Each line is a subgrid row, so a reason never sits
 * beside another group's button.
 */
export function ClaudeResetGroups({
  reset,
  now,
  suggestedKind,
}: {
  reset: ClaudeResetGrantsView;
  now: number;
  /** The kind the reset notice suggests on this account, if any. */
  suggestedKind: ResetGrantKind | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {reset.groups.map((group) => {
        const kind = t(`claude_reset.kind_${group.kind}`);
        const ready = group.action.state === 'ready';
        const reason =
          group.action.state === 'blocked' ? t(`claude_reset.block_${group.action.reason}`) : null;
        const spendLabel = t('claude_reset.spend_label', { kind });
        return (
          <div key={group.kind} className={styles.line} data-grant={group.kind}>
            <span className={styles.summary}>
              <Tooltip content={grantTip(t, group, now)}>
                <span className={styles.count}>{group.resetsLeft}</span> {kind}
                {group.endsAtMs !== null && (
                  <span className={styles.expiry}>
                    <IconTimer size={12} aria-hidden="true" />
                    {formatDaysLeft(t, group.endsAtMs - now)}
                  </span>
                )}
              </Tooltip>
            </span>
            <span className={ready ? styles.ready : styles.reason}>
              {ready && <IconCheck size={14} aria-hidden="true" />}
              <Tooltip content={eligibilityTip(t, group, now)}>
                {ready ? t('claude_reset.ready') : reason}
              </Tooltip>
              {ready && suggestedKind === group.kind && (
                <span className={styles.suggestedTag}>{t('claude_reset.suggested')}</span>
              )}
            </span>
            <span className={styles.spendCell}>
              <button
                type="button"
                className={styles.spend}
                disabled={reset.blocked || !ready}
                onClick={() => reset.confirm(group)}
                aria-label={reason ? `${spendLabel} · ${reason}` : spendLabel}
              >
                <IconZap
                  size={15}
                  aria-hidden="true"
                  className={reset.busy ? styles.pulsing : undefined}
                />
              </button>
            </span>
          </div>
        );
      })}
      {reset.message && (
        <p role="status" className={styles.message}>
          {t(`claude_reset.${reset.message}`)}
        </p>
      )}
    </>
  );
}
