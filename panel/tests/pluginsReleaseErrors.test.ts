import { describe, expect, test } from 'bun:test';
import {
  PluginReleaseFetchError,
  isGitHubRateLimitError,
} from '../src/features/plugins/pluginReleaseVersions';
import { formatPluginVersion, pluginVersionMatches } from '../src/features/plugins/pluginVersion';

describe('GitHub release errors', () => {
  test('403 and 429 fetch errors are rate limits', () => {
    expect(isGitHubRateLimitError(new PluginReleaseFetchError('forbidden', 403))).toBe(true);
    expect(isGitHubRateLimitError(new PluginReleaseFetchError('slow down', 429))).toBe(true);
    expect(isGitHubRateLimitError(new PluginReleaseFetchError('nope', 500))).toBe(false);
  });

  test('plain errors mentioning a rate limit also count', () => {
    expect(isGitHubRateLimitError(new Error('API rate limit exceeded'))).toBe(true);
    expect(isGitHubRateLimitError(new Error('network down'))).toBe(false);
    expect(isGitHubRateLimitError('rate limit')).toBe(false);
  });
});

describe('plugin version helpers', () => {
  test('formatPluginVersion adds a single v prefix', () => {
    expect(formatPluginVersion('1.2.0')).toBe('v1.2.0');
    expect(formatPluginVersion(' V1.2.0 ')).toBe('V1.2.0');
    expect(formatPluginVersion('  ')).toBe('');
  });

  test('pluginVersionMatches ignores the prefix', () => {
    expect(pluginVersionMatches('v1.0.0', '1.0.0')).toBe(true);
    expect(pluginVersionMatches('v1.0.0', 'v1.0.1')).toBe(false);
  });
});
