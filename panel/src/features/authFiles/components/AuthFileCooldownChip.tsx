import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileCooldownSnapshot } from '@/types/authFile';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { CooldownBody } from './AuthFileCooldownSection';
import { formatCooldownDuration, useCooldownNow } from '@/features/authFiles/cooldownClock';
import { useDismissable } from '@/features/authFiles/hooks/useDismissable';
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  useDismissable(rootRef, open, () => setOpen(false));

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
    <span className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.chip} ${elapsed ? styles.chipElapsed : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={label}>
          <CooldownBody
            snapshot={snapshot}
            now={now}
            resetting={resetting}
            resetDisabled={resetDisabled}
            onReset={onReset}
          />
        </div>
      )}
    </span>
  );
}
