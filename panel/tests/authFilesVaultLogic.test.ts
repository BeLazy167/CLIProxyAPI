import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { countAuthFileStatuses, getAuthFileStatusKind } from '../src/features/authFiles/constants';
import { sortAuthFiles } from '../src/features/authFiles/logic';
import { shouldIgnoreEditorEscape } from '../src/features/authFiles/oauthEditorState';
import { normalizePersistedStatusFilterMode } from '../src/features/authFiles/uiState';
import { readShowEmailsPreference, writeShowEmailsPreference } from '../src/features/quota/uiState';
import type { AuthFileItem } from '../src/types';

const NOW = Date.UTC(2026, 9, 7, 12);

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'credential.json',
  type: 'codex',
  ...overrides,
});

const cooling = (overrides: Partial<AuthFileItem> = {}) =>
  authFile({
    cooldownSnapshot: {
      receivedAtMs: NOW - 10_000,
      records: [
        {
          scope: 'credential',
          reason: 'quota',
          retryAt: new Date(NOW + 600_000).toISOString(),
          remainingSeconds: 600,
          httpStatus: 429,
        },
      ],
    },
    ...overrides,
  });

describe('getAuthFileStatusKind', () => {
  test('puts every file in exactly one bucket, disabled > problem > cooling > active', () => {
    expect(getAuthFileStatusKind(authFile(), NOW)).toBe('active');
    expect(getAuthFileStatusKind(cooling(), NOW)).toBe('cooling');
    expect(getAuthFileStatusKind(cooling({ unavailable: true }), NOW)).toBe('problem');
    expect(getAuthFileStatusKind(cooling({ unavailable: true, disabled: true }), NOW)).toBe(
      'disabled'
    );
  });

  test('an elapsed cooldown is active again', () => {
    expect(getAuthFileStatusKind(cooling(), NOW + 700_000)).toBe('active');
  });

  test('counts agree with the per-file kinds', () => {
    const files = [
      authFile({ name: 'a.json' }),
      cooling({ name: 'b.json' }),
      authFile({ name: 'c.json', status: 'error' }),
      authFile({ name: 'd.json', disabled: true }),
      authFile({ name: 'e.json' }),
    ];
    expect(countAuthFileStatuses(files, NOW)).toEqual({
      total: 5,
      active: 2,
      cooling: 1,
      problem: 1,
      disabled: 1,
    });
  });
});

describe('sortAuthFiles (vault modes)', () => {
  test("'problems' puts problem, then cooling, then active, then disabled", () => {
    const files = [
      authFile({ name: 'disabled.json', disabled: true }),
      authFile({ name: 'active.json' }),
      cooling({ name: 'cooling.json' }),
      authFile({ name: 'problem.json', unavailable: true }),
    ];
    expect(sortAuthFiles(files, 'problems', { nowMs: NOW }).map((f) => f.name)).toEqual([
      'problem.json',
      'cooling.json',
      'active.json',
      'disabled.json',
    ]);
  });

  test("'mostUsed' orders by total request count descending", () => {
    const files = [
      authFile({ name: 'quiet.json', successCount: 1 }),
      authFile({ name: 'busy.json', successCount: 40, failureCount: 2 }),
      authFile({ name: 'none.json' }),
    ];
    expect(sortAuthFiles(files, 'mostUsed').map((f) => f.name)).toEqual([
      'busy.json',
      'quiet.json',
      'none.json',
    ]);
  });

  test("'lowestQuota' puts the least remaining first and unknown quota last", () => {
    const percents: Record<string, number | null> = {
      'full.json': 90,
      'empty.json': 0,
      'unknown.json': null,
    };
    const files = Object.keys(percents).map((name) => authFile({ name }));
    expect(
      sortAuthFiles(files, 'lowestQuota', {
        quotaPercentFor: (file) => percents[file.name],
      }).map((f) => f.name)
    ).toEqual(['empty.json', 'full.json', 'unknown.json']);
  });
});

describe('normalizePersistedStatusFilterMode', () => {
  test('maps the old persisted names onto the new chips', () => {
    expect(normalizePersistedStatusFilterMode('enabled')).toBe('active');
    expect(normalizePersistedStatusFilterMode('disabledProblem')).toBe('problem');
    expect(normalizePersistedStatusFilterMode('cooling')).toBe('cooling');
    expect(normalizePersistedStatusFilterMode('bogus')).toBeNull();
  });
});

describe('shouldIgnoreEditorEscape', () => {
  const elementIn = (selector: string | null) =>
    ({
      closest: (query: string) =>
        selector && query.split(',').some((part) => part.trim() === selector) ? {} : null,
    }) as unknown as Element;

  test('ignores Escape while typing or while a popover is open', () => {
    expect(shouldIgnoreEditorEscape({ target: elementIn('input') })).toBe(true);
    expect(shouldIgnoreEditorEscape({ target: elementIn('textarea') })).toBe(true);
    expect(shouldIgnoreEditorEscape({ target: elementIn('[role="menu"]') })).toBe(true);
    expect(shouldIgnoreEditorEscape({ defaultPrevented: true, target: null })).toBe(true);
  });

  test('lets Escape through from the page body', () => {
    expect(shouldIgnoreEditorEscape({ target: elementIn(null) })).toBe(false);
    expect(shouldIgnoreEditorEscape({ target: null })).toBe(false);
  });
});

describe('shared show-emails preference', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    };
  });

  afterAll(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('defaults to null (callers mask) and round-trips a boolean under one key', () => {
    expect(readShowEmailsPreference()).toBeNull();
    writeShowEmailsPreference(true);
    expect(store.get('credentials.showEmails')).toBe('true');
    expect(readShowEmailsPreference()).toBe(true);
    store.set('credentials.showEmails', '"nope"');
    expect(readShowEmailsPreference()).toBeNull();
  });
});
