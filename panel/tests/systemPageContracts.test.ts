import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('System page contracts', () => {
  const page = readSource('src/pages/SystemPage.tsx');

  test('update check result is rendered inline with last-checked time and a release link', () => {
    expect(page).toContain("t('system_info.last_checked', { time: checkedAtText })");
    expect(page).toContain('href={RELEASES_URL}');
    expect(page).toContain('let updateCheckCache');
  });

  test('tiles are named Management Center / CLIProxyAPI and the easter egg is gone', () => {
    expect(page).toContain("t('system_info.tile_ui')");
    expect(page).toContain("t('system_info.tile_api')");
    expect(page).not.toContain('handleInfoVersionTap');
    expect(page).not.toContain('versionTapCount');
  });

  test('request logging is a visible Diagnostics toggle that saves immediately', () => {
    expect(page).toContain("t('system_info.diagnostics_title')");
    expect(page).toContain('configApi.updateRequestLog(next)');
    expect(page).not.toContain('<Modal');
  });

  test('Models card shows total, search, collapse-all, copy-on-click and the key used', () => {
    expect(page).toContain('{models.length}');
    expect(page).toContain("t('system_info.models_search_label')");
    expect(page).toContain("'system_info.collapse_all'");
    expect(page).toContain('copyToClipboard(name)');
    expect(page).toContain('maskApiKey(modelsKey)');
    expect(page).toContain("t('system_info.models_empty_no_key')");
  });

  test('Session card merges connection and local login data', () => {
    expect(page).toContain("t('system_info.session_title')");
    expect(page).toContain("t('common.logout')");
    expect(page).toContain("t('system_info.clear_login_button')");
    expect(page).not.toContain("defaultValue: 'Clear Login Storage'");
  });
});
