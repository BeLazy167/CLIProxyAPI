import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { OAuthPage } from '@/pages/OAuthPage';
import { authFileKeyForProvider, findCreatedCredential, formatClock } from '@/pages/oauthFlow';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

describe('OAuth flow helpers', () => {
  test('formats remaining and elapsed time as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(161_000)).toBe('2:41');
    expect(formatClock(-5_000)).toBe('0:00');
    expect(formatClock(5 * 60 * 1000)).toBe('5:00');
  });

  test('maps providers onto the auth-file type their login produces', () => {
    expect(authFileKeyForProvider('anthropic')).toBe('claude');
    expect(authFileKeyForProvider('kimi-ai')).toBe('kimi');
    expect(authFileKeyForProvider('xai')).toBe('xai');
    expect(authFileKeyForProvider('codex')).toBe('codex');
  });

  test('finds the credential an attempt created, preferring the provider type', () => {
    const before = ['codex-old@example.com.json'];
    const after = [
      { name: 'codex-old@example.com.json', type: 'codex' },
      { name: 'claude-new@example.com.json', type: 'claude' },
      { name: 'codex-new@example.com.json', type: 'codex' },
    ];
    expect(findCreatedCredential(before, after, 'anthropic')).toBe('claude-new@example.com.json');
    expect(findCreatedCredential(before, after, 'codex')).toBe('codex-new@example.com.json');
    // Unknown type still reports the one new file rather than nothing.
    expect(findCreatedCredential(before, after.slice(0, 2), 'xai')).toBe(
      'claude-new@example.com.json'
    );
    expect(findCreatedCredential(before, after.slice(0, 1), 'codex')).toBeUndefined();
  });
});

describe('OAuth page as a provider list', () => {
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(OAuthPage))
    )
  );

  test('renders every built-in provider as a row with its login button and the Vertex row', () => {
    for (const key of [
      'meta_oauth_button',
      'kimi_oauth_button',
      'kimi_ai_oauth_button',
      'codex_oauth_button',
      'anthropic_oauth_button',
      'antigravity_oauth_button',
      'xai_oauth_button',
      'devin_oauth_button',
    ] as const) {
      expect(markup).toContain(en.auth_login[key]);
    }
    expect(markup).toContain(en.auth_login.other_login_methods);
    expect(markup).toContain(en.vertex_import.title);
    expect(markup).toContain(en.auth_login.page_description);
  });

  test('demotes the Kimi sign-up to a plain link and shows no active-login panel while idle', () => {
    expect(markup).toMatch(/<a [^>]*href="https:\/\/platform\.kimi\.com[^"]*"/);
    expect(markup).toMatch(/<a [^>]*href="https:\/\/platform\.kimi\.ai[^"]*"/);
    expect(markup).not.toContain(en.auth_login.step_open_link);
    expect(markup).not.toContain(en.auth_login.oauth_callback_button);
    expect(markup).not.toContain('auth_login.');
  });

  test('keeps a cancel/retry path and the success state until dismissed', () => {
    const source = readFileSync('src/pages/OAuthPage.tsx', 'utf8');
    expect(source).not.toContain('SUCCESS_RESET_DELAY_MS');
    expect(source).toContain("t('auth_login.cancel_login')");
    expect(source).toContain("t('auth_login.retry_login')");
    expect(source).toContain("t('auth_login.dismiss')");
    expect(source).toContain("t('auth_login.waiting_left'");
    expect(source).toContain("t('auth_login.waiting_elapsed'");
    expect(source).toContain('to="/auth-files"');
  });
});
