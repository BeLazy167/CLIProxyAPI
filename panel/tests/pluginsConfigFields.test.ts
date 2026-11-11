import { describe, expect, test } from 'bun:test';
import {
  buildPluginConfigDraft,
  getConfigFieldLabel,
  isPluginConfigDraftDirty,
  isSecretConfigField,
} from '../src/features/plugins/pluginConfigDraft';
import type { PluginConfigField } from '../src/types';

const field = (name: string, extra: Partial<PluginConfigField> = {}): PluginConfigField => ({
  name,
  type: 'string',
  enumValues: [],
  description: '',
  ...extra,
});

describe('secret-looking config fields', () => {
  test('matches common credential names regardless of case or separators', () => {
    for (const name of [
      'apiKey',
      'api_key',
      'API-KEY',
      'client_secret',
      'token',
      'password',
      'passwd',
      'privateKey',
      'credential',
    ]) {
      expect(isSecretConfigField(field(name))).toBe(true);
    }
  });

  test('leaves ordinary fields alone', () => {
    for (const name of ['baseUrl', 'timeout', 'model', 'tokens_per_minute_limit_name']) {
      expect(isSecretConfigField(field(name))).toBe(name === 'tokens_per_minute_limit_name');
    }
  });
});

describe('config field labels', () => {
  test('humanizes snake_case, kebab-case and camelCase keys', () => {
    expect(getConfigFieldLabel(field('webhook_url'))).toBe('Webhook url');
    expect(getConfigFieldLabel(field('base-url'))).toBe('Base url');
    expect(getConfigFieldLabel(field('maxRetries'))).toBe('Max retries');
  });

  test('prefers a label or title declared by the schema', () => {
    expect(getConfigFieldLabel({ ...field('x'), label: 'Custom' } as PluginConfigField)).toBe(
      'Custom'
    );
    expect(getConfigFieldLabel({ ...field('x'), title: ' Titled ' } as PluginConfigField)).toBe(
      'Titled'
    );
  });
});

describe('draft dirty tracking', () => {
  test('fresh drafts are clean; any touched field marks dirty', () => {
    const draft = buildPluginConfigDraft(
      { enabled: true, configFields: [field('a')] },
      { priority: 1, a: 'x' }
    );
    expect(isPluginConfigDraftDirty(draft)).toBe(false);
    expect(isPluginConfigDraftDirty({ ...draft, enabledTouched: true })).toBe(true);
    expect(isPluginConfigDraftDirty({ ...draft, priorityTouched: true })).toBe(true);
    expect(isPluginConfigDraftDirty({ ...draft, touchedFields: { a: true } })).toBe(true);
  });
});
