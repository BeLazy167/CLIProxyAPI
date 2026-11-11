import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { LoginPage } from '@/pages/LoginPage';
import { getLocalizedLoginError } from '@/pages/loginErrors';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = (key: string) => i18n.t(key);

describe('login error mapping', () => {
  test('401 is a key problem and leaves the connection closed', () => {
    const error = getLocalizedLoginError({ status: 401, message: 'Unauthorized' }, t);
    expect(error.message).toContain('HTTP 401');
    expect(error.message).toContain(en.login.error_unauthorized);
    expect(error.connection).toBeUndefined();
    expect(error.causes).toBeUndefined();
  });

  test('403 splits into a headline and a short causes list', () => {
    const error = getLocalizedLoginError({ status: 403 }, t);
    expect(error.message).toContain(en.login.error_forbidden);
    expect(error.causes).toEqual([
      en.login.error_forbidden_cause_remote,
      en.login.error_forbidden_cause_key,
      en.login.error_forbidden_cause_banned,
    ]);
  });

  test('network, CORS and 404 open the connection editor', () => {
    expect(getLocalizedLoginError({ code: 'ERR_NETWORK' }, t).connection).toBe(true);
    expect(getLocalizedLoginError(new Error('CORS request rejected'), t).connection).toBe(true);
    expect(getLocalizedLoginError({ status: 404 }, t).connection).toBe(true);
    expect(getLocalizedLoginError({ status: 500 }, t).connection).toBeUndefined();
    expect(getLocalizedLoginError(new LegacyBackendError(), t).connection).toBeUndefined();
  });

  test('backend detail is appended only when it is not the generic axios text', () => {
    const generic = getLocalizedLoginError(
      { status: 500, message: 'Request failed with status code 500' },
      t
    );
    expect(generic.message).not.toContain(en.login.error_backend_detail);
    const detailed = getLocalizedLoginError({ status: 500, message: 'boom' }, t);
    expect(detailed.message).toContain(`${en.login.error_backend_detail}: boom`);
  });
});

describe('login page markup', () => {
  test('renders nothing but the splash until the saved session is checked', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, null, createElement(LoginPage))
      )
    );
    expect(markup).toContain(en.splash.title);
    expect(markup).not.toContain('<form');
  });

  test('login copy has no trailing colons, no hard-coded fallbacks, and exists in every locale', () => {
    for (const locale of [en, zhCN, zhTW, ru, vi]) {
      const login = locale.login as Record<string, string>;
      for (const key of Object.keys(en.login)) {
        expect(login[key]?.trim()).toBeTruthy();
      }
      expect(login.management_key_label.endsWith(':')).toBe(false);
      expect(login.management_key_label.endsWith('：')).toBe(false);
      expect(login.custom_connection_label.endsWith(':')).toBe(false);
      expect(login.custom_connection_label.endsWith('：')).toBe(false);
    }
    expect(en.login.error_required).toBe('Enter the management key');
    expect(en.login.remember_password_label).toBe('Remember key on this device');
  });
});
