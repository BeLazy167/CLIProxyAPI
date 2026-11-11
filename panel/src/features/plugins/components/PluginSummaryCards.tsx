import styles from './PluginSummaryCards.module.scss';

export type PluginSummaryTone = 'ok' | 'muted' | 'warning' | 'danger' | 'accent';

export interface PluginSummaryCard {
  key: string;
  label: string;
  count: number;
  tone?: PluginSummaryTone;
  active?: boolean;
  onClick?: () => void;
}

const TONE_CLASS: Record<PluginSummaryTone, string> = {
  ok: styles.toneOk,
  muted: styles.toneMuted,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
  accent: styles.toneAccent,
};

/** Quota-style stat cards; cards with `onClick` double as filters (aria-pressed). */
export function PluginSummaryCards({
  cards,
  ariaLabel,
}: {
  cards: PluginSummaryCard[];
  ariaLabel: string;
}) {
  return (
    <div className={styles.grid} role="group" aria-label={ariaLabel}>
      {cards.map((card) => {
        const className = [
          styles.card,
          card.tone ? TONE_CLASS[card.tone] : '',
          card.active ? styles.cardActive : '',
          card.onClick ? styles.cardButton : '',
        ]
          .filter(Boolean)
          .join(' ');
        const body = (
          <>
            <span className={styles.count}>{card.count}</span>
            <span className={styles.label}>{card.label}</span>
          </>
        );
        return card.onClick ? (
          <button
            key={card.key}
            type="button"
            className={className}
            onClick={card.onClick}
            aria-pressed={Boolean(card.active)}
          >
            {body}
          </button>
        ) : (
          <div key={card.key} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
