import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import { createSharedClock } from '@/utils/time/sharedClock';

// One timer for visible cooldown displays, never one interval/request per credential.
const clock = createSharedClock({ intervalMs: 1000 });

/** Second-resolution clock shared by every cooldown display on the page. */
export const useCooldownNow = () =>
  useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);

export const formatCooldownDuration = (t: TFunction, seconds: number): string => {
  if (seconds < 60) return t('auth_files.cooldown_seconds', { count: seconds });
  if (seconds < 3600) return t('auth_files.cooldown_minutes', { count: Math.ceil(seconds / 60) });
  return t('auth_files.cooldown_hours', { count: Math.ceil(seconds / 3600) });
};
