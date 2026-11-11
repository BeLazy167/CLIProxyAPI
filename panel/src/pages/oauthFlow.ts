import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type { AuthFileItem } from '@/types';

/** Auth-file type that a login with this provider produces. */
export const authFileKeyForProvider = (provider: string): string => {
  const key = normalizeOAuthProviderKey(provider);
  if (key === 'anthropic') return 'claude';
  if (key === 'kimi-ai') return 'kimi';
  return key;
};

export const authFileKey = (file: AuthFileItem): string =>
  normalizeOAuthProviderKey(String(file.type ?? file.provider ?? ''));

/** Wall clock for attempt timestamps; kept out of the component so the purity lint can see it is event-time only. */
export const nowMs = (): number => Date.now();

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/** Name of the credential this attempt added, preferring the provider's own type. */
export const findCreatedCredential = (
  before: readonly string[],
  after: readonly AuthFileItem[],
  provider: string
): string | undefined => {
  const known = new Set(before);
  const added = after.filter((file) => file.name && !known.has(file.name));
  const expected = authFileKeyForProvider(provider);
  return (added.find((file) => authFileKey(file) === expected) ?? added[0])?.name;
};
