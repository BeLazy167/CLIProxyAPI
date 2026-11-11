/**
 * Plan labels per provider, shared by the provider bodies and the ledger rows.
 * React-free: `t` is passed in and the quota state is read structurally.
 */

import type { TFunction } from 'i18next';
import type { AntigravityQuotaSubscription } from '@/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';
import type { QuotaProviderType } from './providers/types';

export const getCodexPlanLabel = (t: TFunction, planType?: string | null): string | null => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return t('codex_quota.plan_business_premium');
  }
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
    return t('codex_quota.plan_prolite');
  }
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};

export const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** A loaded credential's plan, or null when the provider didn't report one. */
export function resolveQuotaPlanLabel(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction
): string | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  switch (provider) {
    case 'claude': {
      const planType = nonEmpty((quota as { planType?: string | null }).planType);
      return planType ? t(`claude_quota.${planType}`) : null;
    }
    case 'codex':
      return getCodexPlanLabel(t, (quota as { planType?: string | null }).planType);
    case 'antigravity':
      return getAntigravityPlanLabel(
        (quota as { subscription?: AntigravityQuotaSubscription | null }).subscription,
        t
      );
    case 'devin':
      return nonEmpty((quota as { plan?: string | null }).plan);
    case 'meta':
      return nonEmpty((quota as { data?: { planName?: string } }).data?.planName);
    case 'xai':
      return nonEmpty((quota as { billing?: { planLabel?: string } | null }).billing?.planLabel);
    default:
      return null;
  }
}
