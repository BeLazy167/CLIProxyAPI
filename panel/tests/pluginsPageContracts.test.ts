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

describe('Plugin Store page contracts', () => {
  const page = readSource('src/features/plugins/PluginStorePage.tsx');

  test('remembers the security note dismissal and shows a single alert stack', () => {
    expect(page).toMatch(/useLocalStorage\(\s*SECURITY_NOTE_STORAGE_KEY/);
    expect(page).toMatch(/className=\{styles\.alerts\}/);
  });

  test('install modal is keyed per entry and the gate receives a target version', () => {
    expect(page).toContain('key={getStoreEntryKey(installOptionsEntry)}');
    expect(page).toContain('targetVersion={gateTargetVersion}');
  });

  test('Manage deep-links to the Plugins page focus param', () => {
    expect(page).toContain('/plugins?focus=${encodeURIComponent(entry.id)}');
  });

  test('reads ?filter= initially and shows Source select only with multiple sources', () => {
    expect(page).toContain("parseStatusFilter(searchParams.get('filter'))");
    expect(page).toContain('sources.length > 1 ?');
  });

  test('restart-required state goes through the shared store', () => {
    expect(page).toContain('markRestartRequired(entry.id)');
    expect(page).not.toContain('setRestartRequiredKeys');
  });

  test('disabled Install explains itself inline instead of a tooltip', () => {
    expect(page).toContain("t('plugin_store.auth_required_hint')");
    expect(page).not.toContain('title={actionTitle}');
  });
});

describe('Plugin install modals', () => {
  const options = readSource('src/features/plugins/components/PluginInstallOptionsModal.tsx');
  const gate = readSource('src/features/plugins/components/PluginInstallGateModal.tsx');

  test('releases are only fetched after the disclosure is opened', () => {
    expect(options).toContain("'plugin_store.choose_another_version'");
    expect(options).toContain('install_versions_rate_limited');
  });

  test('gate has two steps and updates skip typed confirmation', () => {
    expect(gate).toContain('useState<1 | 2>(1)');
    expect(gate).toContain('const requireTypedConfirm = !isUpdate;');
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
