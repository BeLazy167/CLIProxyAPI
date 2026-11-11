import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Source contracts: these guard the UX-audit decisions without a browser.
describe('Plugins page contracts', () => {
  const page = readSource('src/features/plugins/PluginsPage.tsx');
  const scss = readSource('src/features/plugins/PluginsPage.module.scss');

  test('uses the shared page header, summary cards and search field', () => {
    expect(page).toContain('<PageHeader');
    expect(page).toContain('<PluginSummaryCards');
    expect(page).toContain('<SearchField');
    expect(page).toContain('<ErrorBanner');
  });

  test('renders one derived status chip and the reason line per row', () => {
    expect(page).toContain('derivePluginStatus(');
    expect(page).toContain('STATUS_CHIP_CLASS[status.kind]');
    expect(page).toContain('status.reasonKey');
  });

  test('builds page links with buildPluginResourceRoute only for effective plugins', () => {
    expect(page).toMatch(/plugin\.effectiveEnabled \? \(\s*<PluginOverflowMenu/);
    expect(page).toContain('buildPluginResourceRoute(plugin.id, index)');
  });

  test('config sheet opens immediately, confirms close when dirty and keeps runtime_pending inline', () => {
    expect(page).toContain('confirmClose={confirmSheetClose}');
    expect(page).toContain("'plugin_management.runtime_pending'");
    expect(page).toContain('setSheetNotice(');
    expect(page).toContain('<Skeleton');
  });

  test('masks secret-looking fields with a show toggle and uses schema labels', () => {
    expect(page).toContain('isSecretConfigField(field)');
    expect(page).toContain("type={secret && !revealed ? 'password' : 'text'}");
    expect(page).toContain('getConfigFieldLabel(field)');
  });

  test('delete lives in the overflow menu and aria-labels carry the plugin name', () => {
    expect(page).toContain("key: 'delete'");
    expect(page).toContain("t('plugin_management.toggle_aria', { name: title })");
    expect(page).toContain("t('plugin_management.edit_config_aria', { name: title })");
    expect(page).toContain("t('plugin_management.more_actions', { name: title })");
  });

  test('reads ?focus= and clears it after highlighting', () => {
    expect(page).toContain("searchParams.get('focus')");
    expect(page).toContain("next.delete('focus')");
    expect(page).toContain('{ replace: true }');
  });

  test('moves the action cluster below 1100px', () => {
    expect(scss).toContain('@media (max-width: 1100px)');
    expect(scss).toMatch(/\.actions \{\s*grid-column: 1 \/ -1;/);
  });

  test('array/object fields keep the JSON textarea (no dead array editor keys)', () => {
    expect(page).not.toContain('add_array_item');
    expect(page).not.toContain('remove_array_item');
  });
});

describe('Plugin resource page contracts', () => {
  const page = readSource('src/features/plugins/PluginResourcePage.tsx');

  test('has a toolbar with reload and open-in-new-tab, and a slow-load hint', () => {
    expect(page).toContain("t('plugin_resource.reload')");
    expect(page).toContain("t('plugin_resource.open_new_tab')");
    expect(page).toContain("t('plugin_resource.slow_load_hint')");
    expect(page).toContain('onLoad={() => setFrameLoaded(true)}');
  });

  test('does not sandbox the plugin iframe (documented decision)', () => {
    expect(page).not.toMatch(/<iframe[^>]*\bsandbox=/s);
    expect(page).toContain('Intentionally no `sandbox` attribute');
  });
});

describe('sidebar plugin labels', () => {
  const layout = readSource('src/components/layout/MainLayout.tsx');

  test('single-page plugins show "Plugin: Menu"', () => {
    expect(layout).toContain('`${group.pluginTitle}: ${resource.label}`');
  });
});
