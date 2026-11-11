/**
 * Segmented pool bar: one equal-width segment per account, each filled to that
 * account's percent remaining. The whole bar is therefore the pool's capacity
 * and the filled area its remaining share, while still showing *which* account
 * holds it — 409% spread evenly reads very differently from four full accounts
 * and one empty one.
 *
 * Unknown members (not loaded, loading, failed, no figure) render as a dashed,
 * unfilled segment: visibly present, never drawn as empty or full.
 */

import type { CSSProperties } from 'react';
import { remainingTone } from './quotaTone';
import styles from './QuotaSegmentBar.module.scss';

export interface QuotaSegment {
  id: string;
  /** Percent remaining; null renders the unknown treatment. */
  percent: number | null;
  /** Hover text, e.g. "claude-t•••.json: 58% remaining". */
  title: string;
}

export interface QuotaSegmentBarProps {
  segments: QuotaSegment[];
  /** Accessible summary of the whole bar. */
  label: string;
  size?: 'md' | 'sm';
}

const TONE_CLASS = {
  high: styles.fillHigh,
  medium: styles.fillMedium,
  low: styles.fillLow,
} as const;

export function QuotaSegmentBar({ segments, label, size = 'md' }: QuotaSegmentBarProps) {
  if (segments.length === 0) return null;
  return (
    <div
      className={`${styles.bar} ${size === 'sm' ? styles.small : ''}`}
      role="img"
      aria-label={`${label}: ${segments.map((segment) => segment.title).join('; ')}`}
    >
      {segments.map((segment) => {
        const known = segment.percent !== null;
        const width = known ? Math.min(100, Math.max(0, segment.percent as number)) : 0;
        return (
          <span
            key={segment.id}
            className={known ? styles.segment : `${styles.segment} ${styles.unknown}`}
            title={segment.title}
          >
            {known && (
              <span
                className={`${styles.fill} ${TONE_CLASS[remainingTone(width)]}`}
                style={{ width: `${Math.round(width * 100) / 100}%` } as CSSProperties}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
