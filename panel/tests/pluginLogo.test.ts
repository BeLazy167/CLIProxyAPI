import { describe, expect, test } from 'bun:test';
import { getPluginLogo } from '../src/features/plugins/pluginLogo';
import type { PluginListEntry } from '../src/types';

const plugin = (overrides: Partial<PluginListEntry> = {}) =>
  ({ id: 'example', logo: '', metadata: null, ...overrides }) as PluginListEntry;

describe('management plugin logos', () => {
  test('prefers runtime logo, then metadata logo, else none', () => {
    const metadata = {
      name: '',
      version: '',
      author: '',
      githubRepository: '',
      logo: 'metadata.png',
      configFields: [],
    };
    expect(getPluginLogo(plugin({ logo: 'runtime.png', metadata }))).toBe('runtime.png');
    expect(getPluginLogo(plugin({ logo: '  ', metadata }))).toBe('metadata.png');
    expect(getPluginLogo(plugin())).toBe('');
  });
});
