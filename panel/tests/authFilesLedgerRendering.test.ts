import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import {
  AuthFilesLedger,
  AuthFilesLedgerSkeleton,
} from '../src/features/authFiles/components/AuthFilesLedger';
import { maskEmails } from '../src/features/quota/maskIdentity';
import type { QuotaCardState } from '../src/features/quota/providers';
import type { AuthFileItem } from '../src/types';

const NOW = Date.UTC(2026, 9, 7, 12);
const noop = () => {};

const files: AuthFileItem[] = [
  { name: 'claude-theo@example.dev.json', type: 'claude', email: 'theo@example.dev' },
  {
    name: 'claude-broken@example.gg.json',
    type: 'claude',
    email: 'broken@example.gg',
    unavailable: true,
    status: 'error',
    statusMessage: 'invalid_grant',
  },
  {
    name: 'codex-cool@example.com.json',
    type: 'codex',
    email: 'cool@example.com',
    // The chip ticks on a live clock, so anchor the cooldown to real time.
    cooldownSnapshot: {
      receivedAtMs: Date.now(),
      records: [
        {
          scope: 'credential',
          reason: 'quota',
          retryAt: new Date(Date.now() + 720_000).toISOString(),
          remainingSeconds: 720,
          httpStatus: 429,
        },
      ],
    },
  },
];

const quotaStates: Record<string, QuotaCardState> = {
  'claude-theo@example.dev.json': {
    status: 'success',
    windows: [
      {
        id: 'five-hour',
        label: 'five-hour',
        labelKey: 'claude_quota.five_hour',
        usedPercent: 70,
        resetLabel: '-',
        resetAtMs: NOW + 3_600_000,
        periodHours: 5,
      },
    ],
  } as unknown as QuotaCardState,
};

const render = (showEmails: boolean) =>
  renderToStaticMarkup(
    createElement(AuthFilesLedger, {
      groups: [
        { provider: 'claude', files: files.slice(0, 2) },
        { provider: 'codex', files: files.slice(2) },
      ],
      now: NOW,
      resolvedTheme: 'light',
      displayNameFor: showEmails ? (name: string) => name : maskEmails,
      selectedFiles: new Set<string>(),
      disableControls: false,
      deleting: null,
      statusUpdating: {},
      manualRefreshing: {},
      cooldownResetting: {},
      quotaFor: (file) => quotaStates[file.name],
      quotaLoading: false,
      onLoadGroupQuota: noop,
      onRefreshQuota: noop,
      onShowModels: noop,
      onDownload: noop,
      onManualRefresh: noop,
      onCooldownReset: noop,
      onOpenDetails: noop,
      onDelete: noop,
      onToggleStatus: noop,
      onToggleSelect: noop,
    })
  );

describe('AuthFilesLedger', () => {
  let previousLanguage: string;
  beforeAll(async () => {
    previousLanguage = i18n.language;
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(previousLanguage);
  });

  test('groups rows by provider with counts and a problem badge', () => {
    const markup = render(false);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('Load quota');
    // One problem in the claude group, none in codex.
    expect(markup.match(/1 problem/g)?.length).toBe(1);
  });

  test('masks emails by default and reveals them on request', () => {
    const masked = render(false);
    expect(masked).not.toContain('theo@example.dev');
    expect(render(true)).toContain('theo@example.dev');
  });

  test('renders a single cooldown chip and a quota meter', () => {
    const markup = render(false);
    expect(markup).toContain('Cooling 12m (429)');
    expect(markup).toContain('30%');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  test('skeleton rows are hidden from assistive tech', () => {
    expect(renderToStaticMarkup(createElement(AuthFilesLedgerSkeleton, { rows: 2 }))).toContain(
      'aria-hidden="true"'
    );
  });
});
