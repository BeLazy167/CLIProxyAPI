import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';

export type QuotaTone = 'high' | 'medium' | 'low';

/** The same three bands the card meters use (≥70 / ≥30 / below), on percent remaining. */
export const remainingTone = (percent: number): QuotaTone =>
  percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
    ? 'high'
    : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
      ? 'medium'
      : 'low';
