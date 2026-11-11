import { describe, expect, test } from 'bun:test';
import {
  PLUGIN_RESTART_STORAGE_KEY,
  usePluginRestartStore,
} from '../src/features/plugins/pluginRestartStore';

describe('plugin restart store', () => {
  test('marks ids once and clears them all', () => {
    const store = usePluginRestartStore;
    store.getState().clearRestartRequired();
    store.getState().markRestartRequired('a');
    store.getState().markRestartRequired('a');
    store.getState().markRestartRequired('b');
    expect(store.getState().ids).toEqual(['a', 'b']);
    store.getState().clearRestartRequired();
    expect(store.getState().ids).toEqual([]);
  });

  test('uses a stable storage key shared by both pages', () => {
    expect(PLUGIN_RESTART_STORAGE_KEY).toBe('cli-proxy-plugin-restart-required');
  });
});
