import { useTranslation } from 'react-i18next';
import type { AuthFileStatusCounts } from '@/features/authFiles/constants';
import type { AuthFilesStatusFilterMode } from '@/features/authFiles/uiState';
import styles from './VaultSummary.module.scss';

export type VaultSummaryProps = {
  counts: AuthFileStatusCounts;
  statusFilterMode: AuthFilesStatusFilterMode;
  onChange: (mode: AuthFilesStatusFilterMode) => void;
};

const CHIPS: Array<{
  mode: AuthFilesStatusFilterMode;
  countKey: keyof AuthFileStatusCounts;
  labelKey: string;
  tone?: 'ok' | 'danger' | 'warning' | 'muted';
}> = [
  { mode: 'all', countKey: 'total', labelKey: 'auth_files.summary_total' },
  { mode: 'active', countKey: 'active', labelKey: 'auth_files.problem_filter_active', tone: 'ok' },
  {
    mode: 'problem',
    countKey: 'problem',
    labelKey: 'auth_files.problem_filter_problem',
    tone: 'danger',
  },
  {
    mode: 'cooling',
    countKey: 'cooling',
    labelKey: 'auth_files.problem_filter_cooling',
    tone: 'warning',
  },
  {
    mode: 'disabled',
    countKey: 'disabled',
    labelKey: 'auth_files.problem_filter_disabled',
    tone: 'muted',
  },
];

const TONE_CLASS = {
  ok: styles.chipOk,
  danger: styles.chipDanger,
  warning: styles.chipWarning,
  muted: styles.chipMuted,
} as const;

/** Clickable status counts; counts come from the current provider/search scope so they match the list. */
export function VaultSummary({ counts, statusFilterMode, onChange }: VaultSummaryProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.summary} role="group" aria-label={t('auth_files.problem_filter_label')}>
      {CHIPS.map((chip) => {
        const active = statusFilterMode === chip.mode;
        return (
          <button
            key={chip.mode}
            type="button"
            className={[
              styles.chip,
              chip.tone ? TONE_CLASS[chip.tone] : '',
              active ? styles.chipActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={active}
            onClick={() => onChange(active && chip.mode !== 'all' ? 'all' : chip.mode)}
          >
            <span className={styles.chipCount}>{counts[chip.countKey]}</span>
            <span className={styles.chipLabel}>{t(chip.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
