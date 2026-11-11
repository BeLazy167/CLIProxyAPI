/**
 * Session-scoped quota page preferences.
 *
 * The merge-on-write case is the one that matters: the tab strip and the sort
 * control each write a single field and know nothing about the other, so a
 * whole-object write would make changing a tab silently reset the sort.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readQuotaUiState, writeQuotaUiState } from '@/features/quota/uiState';

const KEY = 'quotaPage.uiState';

/** Test files share one process — leaving a fake `window` behind would leak. */
const originalWindow = (globalThis as { window?: unknown }).window;

/** bun's global has no sessionStorage; a Map-backed stub is enough here. */
function installSessionStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };
  return storage;
}

let storage: ReturnType<typeof installSessionStorage>;

beforeEach(() => {
  storage = installSessionStorage();
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('quota ui state', () => {
  test('round-trips both preferences', () => {
    writeQuotaUiState({ tab: 'codex', sortMode: 'soonest' });
    expect(readQuotaUiState()).toEqual({ tab: 'codex', sortMode: 'soonest' });
  });

  test('retains the Devin tab across visits', () => {
    writeQuotaUiState({ tab: 'devin', sortMode: 'soonest' });
    expect(readQuotaUiState()).toEqual({ tab: 'devin', sortMode: 'soonest' });
  });

  test('writing one preference preserves the other', () => {
    writeQuotaUiState({ sortMode: 'soonest' });
    writeQuotaUiState({ tab: 'kimi' });

    expect(readQuotaUiState()).toEqual({ tab: 'kimi', sortMode: 'soonest' });
  });

  test('rejects values that are not part of the current contract', () => {
    storage.setItem(KEY, JSON.stringify({ tab: 'not-a-tab', sortMode: 'by-vibes' }));
    expect(readQuotaUiState()).toEqual({ tab: undefined, sortMode: undefined });
  });

  test('keeps the view mode and email visibility alongside tab and sort', () => {
    writeQuotaUiState({ tab: 'claude', sortMode: 'soonest' });
    writeQuotaUiState({ view: 'ledger' });
    writeQuotaUiState({ showEmails: true });
    expect(readQuotaUiState()).toEqual({
      tab: 'claude',
      sortMode: 'soonest',
      view: 'ledger',
      showEmails: true,
    });

    storage.setItem(KEY, JSON.stringify({ view: 'spreadsheet', showEmails: 'yes' }));
    const state = readQuotaUiState();
    expect(state?.view).toBeUndefined();
    // Anything but an explicit boolean leaves emails masked by default.
    expect(state?.showEmails).toBeUndefined();
  });

  test('survives absent, malformed, and non-object payloads', () => {
    expect(readQuotaUiState()).toBeNull();

    storage.setItem(KEY, '{not json');
    expect(readQuotaUiState()).toBeNull();

    storage.setItem(KEY, '"a string"');
    expect(readQuotaUiState()).toBeNull();
  });
});
