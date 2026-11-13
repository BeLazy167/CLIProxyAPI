import { useTranslation } from 'react-i18next';
import { Popover } from '@/components/ui/Popover';
import type { AuthFileCooldownSnapshot } from '@/types/authFile';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { CooldownBody } from './AuthFileCooldownSection';
import { formatCooldownDuration, useCooldownNow } from '@/features/authFiles/cooldownClock';
import styles from './AuthFileCooldownChip.module.scss';

export type AuthFileCooldownChipProps = {
  snapshot: AuthFileCooldownSnapshot;
  resetting?: boolean;
  resetDisabled?: boolean;
  onReset?: () => void;
};

/**
 * Single amber chip for ledger rows ("Cooling 12m (429)"); the per-timer list,
 * disclaimer and reset action live in a popover so the row stays one line.
 * Subscribes to the second clock itself so only chips re-render each tick.
 */
export function AuthFileCooldownChip({
  snapshot,
  resetting,
  resetDisabled,
  onReset,
}: AuthFileCooldownChipProps) {
  const { t } = useTranslation();
  const now = useCooldownNow();

  const { rows, earliestSeconds } = summarizeCooldowns(snapshot, now);
  if (rows.length === 0) return null;
  const elapsed = earliestSeconds === 0;
  const status = rows.find((row) => row.remainingSeconds > 0)?.record.httpStatus;
  const label = elapsed
    ? t('auth_files.cooldown_chip_elapsed')
    : status !== undefined
      ? t('auth_files.cooldown_chip_status', {
          time: formatCooldownDuration(t, earliestSeconds),
          status,
        })
      : t('auth_files.cooldown_chip', { time: formatCooldownDuration(t, earliestSeconds) });

  return (
    <Popover
      label={label}
      trigger={label}
      triggerClassName={`${styles.chip} ${elapsed ? styles.chipElapsed : ''}`}
      className={styles.popover}
    >
      <CooldownBody
        snapshot={snapshot}
        now={now}
        resetting={resetting}
        resetDisabled={resetDisabled}
        onReset={onReset}
      />
    </Popover>
  );
}
