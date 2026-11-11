import { describe, expect, test } from 'bun:test';
import {
  derivePluginStatus,
  isAttentionStatus,
  matchesPluginStatusFilter,
} from '../src/features/plugins/pluginStatus';

const base = { enabled: true, registered: true, effectiveEnabled: true, configured: true };

describe('derivePluginStatus', () => {
  test('effective plugins are running with no reason', () => {
    expect(derivePluginStatus(base, true)).toEqual({ kind: 'running', reasonKey: null });
  });

  test('restart marker wins over everything else', () => {
    expect(derivePluginStatus(base, true, true)).toEqual({
      kind: 'restartNeeded',
      reasonKey: 'plugin_management.reason_restart_required',
    });
  });

  test('instance disabled beats global disabled', () => {
    expect(derivePluginStatus({ ...base, enabled: false, effectiveEnabled: false }, false)).toEqual(
      {
        kind: 'disabled',
        reasonKey: 'plugin_management.reason_disabled',
      }
    );
  });

  test('global disabled explains an enabled but ineffective plugin', () => {
    expect(derivePluginStatus({ ...base, effectiveEnabled: false }, false).reasonKey).toBe(
      'plugin_management.reason_global_disabled'
    );
  });

  test('unregistered -> restart needed, unconfigured -> needs config, otherwise error', () => {
    expect(
      derivePluginStatus({ ...base, registered: false, effectiveEnabled: false }, true).kind
    ).toBe('restartNeeded');
    expect(
      derivePluginStatus({ ...base, configured: false, effectiveEnabled: false }, true).kind
    ).toBe('needsConfig');
    expect(derivePluginStatus({ ...base, effectiveEnabled: false }, true)).toEqual({
      kind: 'error',
      reasonKey: 'plugin_management.reason_not_effective',
    });
  });
});

describe('status filters', () => {
  test('attention groups needsConfig, restartNeeded and error', () => {
    expect(isAttentionStatus('needsConfig')).toBe(true);
    expect(isAttentionStatus('restartNeeded')).toBe(true);
    expect(isAttentionStatus('error')).toBe(true);
    expect(isAttentionStatus('running')).toBe(false);
    expect(isAttentionStatus('disabled')).toBe(false);
  });

  test('matchesPluginStatusFilter', () => {
    expect(matchesPluginStatusFilter('error', 'all')).toBe(true);
    expect(matchesPluginStatusFilter('running', 'running')).toBe(true);
    expect(matchesPluginStatusFilter('disabled', 'running')).toBe(false);
    expect(matchesPluginStatusFilter('needsConfig', 'attention')).toBe(true);
    expect(matchesPluginStatusFilter('disabled', 'attention')).toBe(false);
  });
});
