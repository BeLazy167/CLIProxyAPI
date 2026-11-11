/**
 * Email masking for quota display names (`claude-theo@example.dev.json` →
 * `claude-t•••@e•••.dev.json`).
 *
 * Credential filenames usually embed the account email, which is what makes a
 * screenshot of this page sensitive. Masking keeps enough to tell rows apart —
 * the provider prefix, first characters, and the domain suffix — and nothing
 * else. Display only: search and cache identity keep using the real name.
 */

const MASK = '•••';

/** Filename prefixes that name the provider, not the person. */
const PROVIDER_PREFIX =
  /^(claude|codex|antigravity|kimi|xai|grok|devin|meta|gemini|vertex|qwen|iflow|aistudio)[-_]/i;

const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)/g;

const maskLocal = (local: string): string => {
  const prefix = local.match(PROVIDER_PREFIX)?.[0] ?? '';
  const rest = local.slice(prefix.length);
  return rest ? `${prefix}${rest.slice(0, 1)}${MASK}` : `${prefix}${MASK}`;
};

export function maskEmails(text: string): string {
  return text.replace(
    EMAIL_PATTERN,
    (_match, local: string, domain: string, suffix: string) =>
      `${maskLocal(local)}@${domain.slice(0, 1)}${MASK}${suffix}`
  );
}

/** Display-name transform for the current "show emails" preference. */
export const displayNameTransform = (showEmails: boolean) =>
  showEmails ? (name: string) => name : maskEmails;
