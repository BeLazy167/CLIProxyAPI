import type { ProviderBehaviorOptions, ProviderKeyConfig } from '@/types/provider';
import { getProviderBehaviorCapabilities } from './descriptors';
import type { ProviderBrand } from './types';

/** Keep protocol-specific form values out of other provider payloads. */
export function pickProviderBehavior(
  input: ProviderBehaviorOptions | ProviderKeyConfig,
  brand: ProviderBrand
): ProviderBehaviorOptions {
  const capabilities = getProviderBehaviorCapabilities(brand);
  return {
    ...(capabilities.alphaSearch ? { alphaSearch: input.alphaSearch } : {}),
    ...(capabilities.disableCodexCloaking
      ? { disableCodexCloaking: input.disableCodexCloaking }
      : {}),
    ...(capabilities.rebuildMidSystemMessage
      ? { rebuildMidSystemMessage: input.rebuildMidSystemMessage }
      : {}),
    ...(capabilities.supportPromptCacheKey
      ? { supportPromptCacheKey: input.supportPromptCacheKey }
      : {}),
  };
}

/** 已显式配置的行为开关数量，供折叠头提示用。 */
export const countConfiguredBehavior = (value: ProviderBehaviorOptions): number =>
  [
    value.alphaSearch === true,
    value.disableCodexCloaking !== undefined,
    value.rebuildMidSystemMessage === true,
    value.supportPromptCacheKey === true,
  ].filter(Boolean).length;
