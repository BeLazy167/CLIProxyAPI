// Upstream cedar_ember contract, following opencodex anthropic-reset-grants.
import { apiClient } from './client';
import { normalizeApiBase } from '@/utils/connection';
import type { ApiError } from '@/types';

export const ANTHROPIC_RESET_GRANT_ID_RE = /^[a-z0-9_-]{1,40}$/;

/** Usage windows a grant can clear. Others upstream may add are dropped. */
export const ANTHROPIC_RESET_WINDOWS = [
  'five_hour',
  'seven_day',
  'seven_day_overage_included',
] as const;
export type AnthropicResetWindow = (typeof ANTHROPIC_RESET_WINDOWS)[number];

/** The claude-quota plugin's claim route. Plugin routes keep their v0 path. */
export const CLAUDE_QUOTA_CLAIM_PATH = '/v0/management/plugins/claude-quota/claim';
/** Longer than the plugin's own 90 s wait, so the plugin's answer arrives first. */
const CLAUDE_QUOTA_CLAIM_TIMEOUT_MS = 120_000;

export interface AnthropicResetGrant {
  id: string;
  label: string;
  resetsTotal: number;
  resetsLeft: number;
  startsAt: string | null;
  endsAt: string | null;
  clears: AnthropicResetWindow[];
  paused: boolean;
  usableNow: boolean;
  useRequiresLimit: boolean;
  percentUsed: Partial<Record<AnthropicResetWindow, number>>;
}

export interface AnthropicResetGrantStatus {
  eligible: boolean;
  ineligibleReason: string | null;
  atLimit: boolean;
  grants: AnthropicResetGrant[];
  nextGrantId: string | null;
  weeklyResetsAt: string | null;
  cooldownUntil: string | null;
}

/** The plugin's answer to a claim: its message, the offer's state, and whether it answered 2xx. */
export interface ClaudeQuotaClaimAnswer {
  ok: boolean;
  message: string;
  state: string;
}

const KNOWN_INELIGIBLE_REASONS = new Set([
  'config_off',
  'tier',
  'seat',
  'mobile',
  'surface',
  'cli_version',
  'no_grant',
  'tenure',
  'other_experiment',
  'unavailable',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Optional ISO timestamp: absent/null → null, anything unparsable rejects the block. */
function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean | undefined {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : undefined;
}

/** Upstream display text, stripped of control characters and bounded. */
function safeLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return (
    value
      // Strip untrusted display control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  );
}

function parseWindows(value: unknown): AnthropicResetWindow[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return undefined;
  return ANTHROPIC_RESET_WINDOWS.filter((window) => value.includes(window));
}

function parsePercentUsed(value: unknown): Partial<Record<AnthropicResetWindow, number>> {
  const out: Partial<Record<AnthropicResetWindow, number>> = {};
  if (!isRecord(value)) return out;
  for (const window of ANTHROPIC_RESET_WINDOWS) {
    const percent = value[window];
    if (typeof percent === 'number' && Number.isInteger(percent) && percent >= 0 && percent <= 100)
      out[window] = percent;
  }
  return out;
}

function parseGrant(value: unknown): AnthropicResetGrant | null {
  if (!isRecord(value)) return null;
  const { id, resets_total: total, resets_left: left } = value;
  if (typeof id !== 'string' || !ANTHROPIC_RESET_GRANT_ID_RE.test(id)) return null;
  if (!isCount(total) || !isCount(left) || left > total) return null;
  const startsAt = optionalTimestamp(value.starts_at);
  const endsAt = optionalTimestamp(value.ends_at);
  const clears = parseWindows(value.clears);
  const paused = optionalBoolean(value.paused, false);
  // Missing usability flags default to the refusing side: a grant that does not
  // say it is usable is not offered for spending.
  const usableNow = optionalBoolean(value.usable_now, false);
  const useRequiresLimit = optionalBoolean(value.use_requires_limit, true);
  if (
    startsAt === undefined ||
    endsAt === undefined ||
    clears === undefined ||
    paused === undefined ||
    usableNow === undefined ||
    useRequiresLimit === undefined
  )
    return null;
  return {
    id,
    label: safeLabel(value.label),
    resetsTotal: total,
    resetsLeft: left,
    startsAt,
    endsAt,
    clears,
    paused,
    usableNow,
    useRequiresLimit,
    percentUsed: parsePercentUsed(value.percent_used),
  };
}

/**
 * Parses the `cedar_ember` block. Returns null for a missing or malformed block;
 * one malformed grant, a duplicate id, or a bad timestamp rejects the whole block.
 */
export function parseAnthropicResetGrantStatus(block: unknown): AnthropicResetGrantStatus | null {
  if (!isRecord(block) || typeof block.eligible !== 'boolean') return null;
  const rawGrants = block.grants ?? [];
  if (!Array.isArray(rawGrants)) return null;
  const grants: AnthropicResetGrant[] = [];
  const seen = new Set<string>();
  for (const raw of rawGrants) {
    const grant = parseGrant(raw);
    if (!grant || seen.has(grant.id)) return null;
    seen.add(grant.id);
    grants.push(grant);
  }
  const reason = block.ineligible_reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return null;
  const atLimit = optionalBoolean(block.at_limit, false);
  const weeklyResetsAt = optionalTimestamp(block.weekly_resets_at);
  const cooldownUntil = optionalTimestamp(block.cooldown_until);
  if (atLimit === undefined || weeklyResetsAt === undefined || cooldownUntil === undefined)
    return null;
  const next = block.next_grant_id;
  return {
    eligible: block.eligible,
    ineligibleReason:
      typeof reason === 'string'
        ? KNOWN_INELIGIBLE_REASONS.has(reason)
          ? reason
          : 'unknown'
        : null,
    atLimit,
    grants,
    nextGrantId: typeof next === 'string' && seen.has(next) ? next : null,
    weeklyResetsAt,
    cooldownUntil,
  };
}

/** Why a grant cannot be spent right now, or null when it can. */
export function anthropicResetGrantBlocker(
  status: AnthropicResetGrantStatus,
  grantId: string
): 'ineligible' | 'unknown_grant' | 'paused' | 'not_usable' | 'exhausted' | 'not_limited' | null {
  if (!status.eligible) return 'ineligible';
  const grant = status.grants.find((candidate) => candidate.id === grantId);
  if (!grant) return 'unknown_grant';
  if (grant.paused) return 'paused';
  if (!grant.usableNow) return 'not_usable';
  if (grant.resetsLeft <= 0) return 'exhausted';
  if (grant.useRequiresLimit && !status.atLimit) return 'not_limited';
  return null;
}

/**
 * Asks the claude-quota plugin to claim a grant. The plugin is the only claim sender: it re-reads
 * the status, re-checks every guard, keeps the request ID and clears the gateway cooldown.
 * Rejects when the plugin gave no answer, since it may still have sent the claim.
 */
export async function claimClaudeResetGrant(
  apiBase: string,
  authIndex: string,
  grantId: string
): Promise<ClaudeQuotaClaimAnswer> {
  const [ok, body] = await apiClient
    .post(
      normalizeApiBase(apiBase) + CLAUDE_QUOTA_CLAIM_PATH,
      { auth_index: authIndex, grant_id: grantId },
      { timeout: CLAUDE_QUOTA_CLAIM_TIMEOUT_MS }
    )
    .then(
      (data) => [true, data] as const,
      (error: ApiError) => [false, error.data] as const
    );
  if (!isRecord(body) || typeof body.message !== 'string') {
    throw new Error('claude-quota gave no answer');
  }
  return { ok, message: body.message, state: typeof body.state === 'string' ? body.state : '' };
}
