import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = readSource('src/features/logs/LogsPage.tsx');
const row = readSource('src/features/logs/components/LogRow.tsx');
const ledger = readSource('src/features/logs/components/ErrorLogLedger.tsx');
const styles = readSource('src/features/logs/LogsPage.module.scss');
const layout = readSource('src/styles/layout.scss');

// Structural guards complement the browser viewport/interaction checks. They do not
// assert browser layout: the important contract is a single flexible scrolling viewer.
describe('log workspace layout contract', () => {
  test('viewer uses remaining space instead of resolution-specific height budgets', () => {
    const panel = styles.match(/\.logPanel \{([^}]+)\}/)?.[1] ?? '';
    expect(panel).toContain('flex: 1');
    expect(panel).toContain('min-height: 0');
    expect(panel).toContain('overflow: auto');
    expect(panel).not.toMatch(/(?:max-height|height):\s*(?:calc|\d+px)/);
    expect(styles).not.toContain('resize: vertical');
    expect(styles).not.toMatch(/calc\(100vh\s*-/);
    expect(styles).not.toMatch(/\n\s*(?:height|min-height|max-height):\s*(?:360|420|480)px/);
    expect(layout).toMatch(
      /&\.content-logs\s*\{\s*height: 100dvh;\s*min-height: 0;\s*overflow: hidden;/
    );
  });

  test('error archive and fullscreen share the flexible viewport contract', () => {
    const archive = styles.match(/\.errorPanel \{([^}]+)\}/)?.[1] ?? '';
    const fullscreen = styles.match(/\.logCardFullscreen \{([^}]+)\}/)?.[1] ?? '';
    expect(archive).toContain('flex: 1');
    expect(archive).toContain('min-height: 0');
    expect(archive).not.toMatch(/\bheight:\s*\d+px/);
    expect(fullscreen).toContain('height: 100dvh');
    expect(page).toContain('className={styles.errorCard}');
  });

  test('tabs use tablist semantics, live in the route query, and keep the viewer mounted', () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tab"');
    expect(page).toContain("searchParams.get('tab') === 'errors'");
    expect(page).toContain("inert={activeTab !== 'logs'}");
    expect(page).not.toContain("activeTab === 'logs' && (");
    const hidden = styles.match(/\.panelHidden \{([^}]+)\}/)?.[1] ?? '';
    expect(hidden).toContain('visibility: hidden');
    expect(hidden).not.toContain('display: none');
  });

  test('quick filters, popovers and chips replace the modal filter panel', () => {
    expect(page).toContain('QUICK_FILTERS.map(');
    expect(page).toContain('<ToolbarPopover');
    expect(page).not.toMatch(/<Modal\s+open=\{structuredFiltersExpanded\}/);
    expect(page).toContain("t('logs.remove_filter', { label: chip.label })");
    expect(page).toContain("t('logs.clear_all_filters')");
    expect(page).toContain("t('logs.search_empty_filters', {");
    expect(page).toContain("'logsPage.showRawLogs'");
    expect(page).toContain("'logsPage.hideManagementLogs'");
    expect(page).toContain("useLocalStorage('logsPage.wrapLogs', isNarrowViewport())");
  });

  test('rows sit on a shared column grid with keyboard-reachable actions', () => {
    expect(styles).toContain('grid-template-columns: subgrid');
    expect(styles).toContain('width: max-content');
    const actions = styles.match(/\.cellActions \{([^}]+)\}/)?.[1] ?? '';
    expect(actions).toContain('position: sticky');
    expect(row).toContain('tabIndex={0}');
    expect(row).toContain("aria-label={t('logs.copy_line')}");
    expect(row).toContain('data-log-id={line.id}');
    expect(row).not.toContain('onDoubleClick');
    expect(row).toContain('styles.srOnly');
    expect(page).toContain('className={styles.daySeparator} role="separator"');
  });

  test('live pill replaces the timer icon and the footer no longer announces the clock', () => {
    expect(page).toContain('aria-pressed={autoRefresh}');
    expect(page).toContain("t('logs.read_status_retrying', { seconds: retrySeconds })");
    expect(page).not.toContain('IconTimer');
    expect(page).toContain('<footer className={styles.statusBar}>');
    expect(page).not.toMatch(/<footer[^>]*role="status"/);
    expect(page).toContain('<div className={styles.viewerArea}>');
    expect(page).toContain('onScroll={handleLogScroll}');
    expect(page).toContain('onClick={resumeFollowing}');
    expect(page).toContain("t('logs.jump_to_latest')");
    expect(page).toContain('loading && logBuffer.buffer.length === 0');
  });

  test('viewer states are explicit and notices are dismissible', () => {
    expect(page).toContain("t('logs.not_connected_title')");
    expect(page).toContain('<ErrorBanner');
    expect(page).toContain("retryLabel={t('logs.retry_now')}");
    expect(page).toContain('onDismiss={dismissReset}');
    expect(page).toContain('onDismiss={dismissHistoryEvicted}');
    expect(page).toContain("t('logs.evicted_note', { count: logBuffer.evicted })");
    expect(page).not.toContain("t('logs.buffer_evicted')");
  });

  test('error logs tab is a ledger with its own search and per-row busy state', () => {
    expect(page).toContain('<ErrorLogLedger');
    expect(ledger).toContain('sortErrorLogFilesNewestFirst');
    expect(ledger).toContain('<SearchField');
    expect(ledger).toContain('<Skeleton');
    expect(ledger).toContain('loading={busy}');
  });

  test('toolbar controls use the shared small sizes instead of local height overrides', () => {
    expect(styles).not.toContain('--log-control-height');
    expect(page).not.toContain('className={styles.actionButton}');
    expect(page).toContain('size="sm"');
  });

  test('all supported locales describe both filtering and display settings', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      const messages = JSON.parse(readSource(`src/i18n/locales/${locale}.json`));
      expect(messages.logs.filter_panel_title).toBeTruthy();
      expect(messages.logs.view_menu_title).toBeTruthy();
      expect(messages.logs.show_raw_logs).toBeTruthy();
      expect(messages.logs.wrap_lines).toBeTruthy();
      expect(messages.logs.hide_management_logs).toBeTruthy();
      for (const removed of [
        'buffer_evicted',
        'filter_panel_expand',
        'filter_panel_collapse',
        'auto_refresh',
        'load_more_hint',
        'clear_confirm',
      ]) {
        expect(messages.logs[removed]).toBeUndefined();
      }
    }
  });
});
