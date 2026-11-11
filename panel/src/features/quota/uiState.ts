import {
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  QUOTA_VIEW_MODES,
  type QuotaSortMode,
  type QuotaTabId,
  type QuotaViewMode,
} from './constants';

/** 额度页 UI 偏好：会话级持久化（sessionStorage），跨会话不携带。 */
export type QuotaUiState = {
  tab?: QuotaTabId;
  sortMode?: QuotaSortMode;
  view?: QuotaViewMode;
  /** Emails in display names are masked unless this is true. */
  showEmails?: boolean;
};

const QUOTA_UI_STATE_KEY = 'quotaPage.uiState';

const QUOTA_TAB_ID_SET = new Set<string>(['all', ...QUOTA_TAB_ORDER]);
const QUOTA_SORT_MODE_SET = new Set<string>(QUOTA_SORT_MODES);
const QUOTA_VIEW_MODE_SET = new Set<string>(QUOTA_VIEW_MODES);

export const isQuotaTabId = (value: unknown): value is QuotaTabId =>
  typeof value === 'string' && QUOTA_TAB_ID_SET.has(value);

export const isQuotaSortMode = (value: unknown): value is QuotaSortMode =>
  typeof value === 'string' && QUOTA_SORT_MODE_SET.has(value);

export const isQuotaViewMode = (value: unknown): value is QuotaViewMode =>
  typeof value === 'string' && QUOTA_VIEW_MODE_SET.has(value);

export const readQuotaUiState = (): QuotaUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(QUOTA_UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotaUiState;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      tab: isQuotaTabId(parsed.tab) ? parsed.tab : undefined,
      sortMode: isQuotaSortMode(parsed.sortMode) ? parsed.sortMode : undefined,
      view: isQuotaViewMode(parsed.view) ? parsed.view : undefined,
      showEmails: typeof parsed.showEmails === 'boolean' ? parsed.showEmails : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Merge into whatever is already stored.
 *
 * Callers write one preference at a time — the tab strip knows nothing about
 * the sort control — so a whole-object write would silently drop the other
 * field every time either one changed.
 */
export const writeQuotaUiState = (state: QuotaUiState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readQuotaUiState(), ...state };
    window.sessionStorage.setItem(QUOTA_UI_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};

/**
 * "Show emails" is one preference shared by every page that displays credential
 * identities (Quota, Auth Files). Persisted across sessions in localStorage;
 * `null` means nothing stored yet (callers fall back to masked).
 */
const SHOW_EMAILS_KEY = 'credentials.showEmails';

export const readShowEmailsPreference = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SHOW_EMAILS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
};

export const writeShowEmailsPreference = (showEmails: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHOW_EMAILS_KEY, JSON.stringify(showEmails));
  } catch {
    // ignore
  }
};
