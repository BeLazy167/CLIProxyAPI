import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/quota/QuotaPage.tsx', 'utf8');
const styles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');
const searchField = readFileSync('src/components/ui/SearchField/SearchField.tsx', 'utf8');
const searchStyles = readFileSync('src/components/ui/SearchField/SearchField.module.scss', 'utf8');

describe('quota toolbar presentation contracts', () => {
  test('uses the shared search field with a named clear action that restores focus', () => {
    expect(source).toContain('<SearchField');
    expect(source).toContain('ref={searchInputRef}');
    expect(source).toContain("clearLabel={t('quota_management.search_clear')}");
    expect(searchField).toContain('type="search"');
    expect(searchField).toContain('aria-label={clearText}');
    expect(searchField).toMatch(/onChange\(''\);\s*inputRef\.current\?\.focus\(\);/);
    expect(searchField).toContain('<IconX size={14} aria-hidden="true" />');
    expect(searchStyles).toMatch(/&::-webkit-search-cancel-button,[\s\S]*?appearance: none;/);
    expect(searchStyles).toContain('&:focus-within');
  });

  test('groups search and sorting separately from provider navigation', () => {
    const toolbarStart = source.indexOf('<div className={styles.toolbar}>');
    const searchStart = source.indexOf('<SearchField');
    const sortStart = source.indexOf('<div className={styles.sort}>');
    expect(toolbarStart).toBeGreaterThan(source.indexOf('<ProviderTabs'));
    expect(searchStart).toBeGreaterThan(toolbarStart);
    expect(sortStart).toBeGreaterThan(searchStart);
    expect(styles).toMatch(/\.toolbar\s*\{[^}]*flex-wrap: wrap;/);
    expect(source).toMatch(/<Select[\s\S]*?variant="quiet"/);
  });
});
