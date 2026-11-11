import type { PluginListEntry } from '@/types';

export type PluginStatusKind = 'running' | 'disabled' | 'needsConfig' | 'restartNeeded' | 'error';

export type PluginStatusFilter = 'all' | 'running' | 'disabled' | 'attention';

export interface PluginStatus {
  kind: PluginStatusKind;
  /** i18n key under plugin_management explaining why the plugin is not running. */
  reasonKey: string | null;
}

const ATTENTION_KINDS: ReadonlySet<PluginStatusKind> = new Set([
  'needsConfig',
  'restartNeeded',
  'error',
]);

export const isAttentionStatus = (kind: PluginStatusKind) => ATTENTION_KINDS.has(kind);

/**
 * One glanceable status per plugin, derived from the four backend flags plus the
 * locally remembered "restart required" marker set by install/delete.
 */
export function derivePluginStatus(
  plugin: Pick<PluginListEntry, 'enabled' | 'registered' | 'effectiveEnabled' | 'configured'>,
  pluginsEnabled: boolean,
  restartRequired = false
): PluginStatus {
  if (restartRequired) {
    return { kind: 'restartNeeded', reasonKey: 'plugin_management.reason_restart_required' };
  }
  if (plugin.effectiveEnabled) {
    return { kind: 'running', reasonKey: null };
  }
  if (!plugin.enabled) {
    return { kind: 'disabled', reasonKey: 'plugin_management.reason_disabled' };
  }
  if (!pluginsEnabled) {
    return { kind: 'disabled', reasonKey: 'plugin_management.reason_global_disabled' };
  }
  if (!plugin.registered) {
    return { kind: 'restartNeeded', reasonKey: 'plugin_management.reason_not_loaded' };
  }
  if (!plugin.configured) {
    return { kind: 'needsConfig', reasonKey: 'plugin_management.reason_not_configured' };
  }
  return { kind: 'error', reasonKey: 'plugin_management.reason_not_effective' };
}

export const matchesPluginStatusFilter = (kind: PluginStatusKind, filter: PluginStatusFilter) => {
  if (filter === 'all') return true;
  if (filter === 'attention') return isAttentionStatus(kind);
  return kind === filter;
};
