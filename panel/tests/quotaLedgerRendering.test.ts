import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { QuotaLedger } from '../src/features/quota/components/QuotaLedger';
import { QuotaPools } from '../src/features/quota/components/QuotaPools';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import { maskEmails } from '../src/features/quota/maskIdentity';
import type { QuotaCardState } from '../src/features/quota/providers';
import { buildProviderPools } from '../src/features/quota/quotaPool';

const NOW = Date.UTC(2026, 9, 7, 12);
const DAY = 24 * 60 * 60 * 1000;

const entry = (name: string, type: QuotaFileEntry['type'] = 'claude'): QuotaFileEntry => ({
  file: { name, type },
  type,
});

const claudeWindow = (id: string, usedPercent: number | null, resetAtMs: number | null) => ({
  id,
  label: id,
  labelKey: `claude_quota.${id.replace(/-/g, '_')}`,
  usedPercent,
  resetLabel: '-',
  resetAtMs,
  periodHours: id === 'five-hour' ? 5 : 168,
});

const entries = [
  entry('claude-theo@example.dev.json'),
  entry('claude-ana@example.gg.json'),
  entry('claude-idle@example.gg.json'),
  entry('claude-broken@example.gg.json'),
  entry('codex-one@example.com.json', 'codex'),
];

const states: Record<string, unknown> = {
  'claude-theo@example.dev.json': {
    status: 'success',
    planType: 'plan_max',
    windows: [
      claudeWindow('seven-day-fable', 42, NOW + DAY),
      claudeWindow('five-hour', 0, null),
      claudeWindow('seven-day', 21, NOW + DAY),
    ],
  },
  // Lacks the model-scoped window entirely.
  'claude-ana@example.gg.json': {
    status: 'success',
    windows: [
      claudeWindow('five-hour', 1, NOW + 3 * 60 * 60 * 1000),
      claudeWindow('seven-day', null, null),
    ],
  },
  'claude-broken@example.gg.json': { status: 'error', windows: [], error: 'upstream 500' },
};

const quotaFor = (item: QuotaFileEntry) => states[item.file.name] as QuotaCardState | undefined;

let originalLanguage = 'en';
beforeAll(async () => {
  originalLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(originalLanguage);
});

const renderLedger = () =>
  renderToStaticMarkup(
    createElement(QuotaLedger, {
      entries,
      quotaFor,
      displayNameFor: maskEmails,
      resolvedTheme: 'dark',
      now: NOW,
      pools: buildProviderPools(entries, quotaFor, NOW),
      canRefresh: () => true,
      resettingKey: null,
      onRefresh: () => {},
      onReset: () => {},
    })
  );

describe('QuotaLedger rendering', () => {
  test('groups rows by provider and masks emails in account names', () => {
    const markup = renderLedger();
    expect(markup).toContain('claude-t•••@e•••.dev.json');
    expect(markup).not.toContain('claude-theo@');
    expect(markup.indexOf('quota-ledger-claude')).toBeLessThan(
      markup.indexOf('quota-ledger-codex')
    );
    expect(markup).toContain('Max');
  });

  test('aligns columns, marking a missing window as not reported rather than empty', () => {
    const markup = renderLedger();
    const anaRow = markup.slice(markup.indexOf('claude-a•••'), markup.indexOf('claude-i•••'));
    expect(anaRow).toContain('Not reported');
    // Unknown figure renders as --, never as 0%.
    expect(anaRow).toContain('>--<');
    expect(anaRow).not.toContain('>0%<');
    expect(anaRow).toContain('99% left');
  });

  test('a column header names each window once, with the pool summary beside the group', () => {
    const markup = renderLedger();
    const claude = markup.slice(
      markup.indexOf('quota-ledger-claude'),
      markup.indexOf('quota-ledger-codex')
    );
    const head = claude.slice(claude.indexOf('Credential'), claude.indexOf('</div>'));
    expect(head).toContain('5-hour');
    expect(head).toContain('7-day Fable');
    expect(head).toContain('Resets');
    expect(claude).toContain('of 200% pool');
    expect(claude).toContain('Next reset +');
  });

  test('a window reads as percent left with a countdown, and low windows are marked', () => {
    const lowStates: Record<string, unknown> = {
      'claude-theo@example.dev.json': {
        status: 'success',
        loadedAtMs: NOW - 4 * 60 * 1000,
        windows: [claudeWindow('seven-day', 89, NOW + 2 * DAY + 30 * 60 * 1000)],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        entries: [entries[0]],
        quotaFor: (item: QuotaFileEntry) => lowStates[item.file.name] as QuotaCardState | undefined,
        displayNameFor: maskEmails,
        resolvedTheme: 'dark',
        now: NOW,
        pools: [],
        canRefresh: () => true,
        resettingKey: null,
        onRefresh: () => {},
        onReset: () => {},
      })
    );
    expect(markup).toContain('11% left');
    expect(markup).toContain('Low');
    expect(markup).toContain('Resets in 2d 0h');
    expect(markup).toContain('Claude · 4m ago');
  });

  test('distinguishes not loaded, failed, and loaded rows', () => {
    const markup = renderLedger();
    expect(markup).toContain('Quota not loaded');
    expect(markup).toContain('upstream 500');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-valuenow="58"');
    expect(markup).toContain('No reset pending');
    expect(markup).toContain('Refresh quota for claude-t•••@e•••.dev.json');
  });
});

describe('QuotaPools rendering', () => {
  test('shows remaining over reporting capacity with coverage, never padding unknowns', () => {
    const pools = buildProviderPools(entries, quotaFor, NOW);
    const markup = renderToStaticMarkup(
      createElement(QuotaPools, {
        pools,
        now: NOW,
        resolvedTheme: 'light',
        displayNameFor: maskEmails,
      })
    );
    // Claude: the model window is reported by one account (58%); the shared
    // 7-day window by one of two loaded accounts. 5-hour leads on coverage.
    expect(markup).toContain('199%');
    expect(markup).toContain('of 200%');
    expect(markup).toContain('2 of 4 reporting');
    expect(markup).toContain('1 failed');
    expect(markup).toContain('1 not loaded');
    // Codex never loaded: an explicit unknown total, not 0%.
    expect(markup).toMatch(/>--<\/span><span[^>]*>of 100%/);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('4 credentials');
    expect(markup).toContain('1 credential<');
  });
});
