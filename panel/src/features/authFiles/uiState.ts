export const AUTH_FILES_SORT_MODES = [
  'default',
  'az',
  'priority',
  'problems',
  'mostUsed',
  'lowestQuota',
] as const;
export const AUTH_FILES_STATUS_FILTER_MODES = [
  'all',
  'active',
  'problem',
  'cooling',
  'disabled',
] as const;
export const AUTH_FILES_VIEW_MODES = ['rows', 'cards'] as const;

export type AuthFilesSortMode = (typeof AUTH_FILES_SORT_MODES)[number];
export type AuthFilesStatusFilterMode = (typeof AUTH_FILES_STATUS_FILTER_MODES)[number];
export type AuthFilesViewMode = (typeof AUTH_FILES_VIEW_MODES)[number];

export type AuthFilesUiState = {
  filter?: string;
  statusFilterMode?: AuthFilesStatusFilterMode;
  search?: string;
  page?: number;
  sortMode?: AuthFilesSortMode;
  viewMode?: AuthFilesViewMode;
  routingRulesOpen?: boolean;
};

const AUTH_FILES_UI_STATE_KEY = 'authFilesPage.uiState';
const AUTH_FILES_SORT_MODE_SET = new Set<AuthFilesSortMode>(AUTH_FILES_SORT_MODES);
const AUTH_FILES_STATUS_FILTER_MODE_SET = new Set<AuthFilesStatusFilterMode>(
  AUTH_FILES_STATUS_FILTER_MODES
);
const AUTH_FILES_VIEW_MODE_SET = new Set<AuthFilesViewMode>(AUTH_FILES_VIEW_MODES);

export const isAuthFilesSortMode = (value: unknown): value is AuthFilesSortMode =>
  typeof value === 'string' && AUTH_FILES_SORT_MODE_SET.has(value as AuthFilesSortMode);

export const isAuthFilesStatusFilterMode = (value: unknown): value is AuthFilesStatusFilterMode =>
  typeof value === 'string' &&
  AUTH_FILES_STATUS_FILTER_MODE_SET.has(value as AuthFilesStatusFilterMode);

export const isAuthFilesViewMode = (value: unknown): value is AuthFilesViewMode =>
  typeof value === 'string' && AUTH_FILES_VIEW_MODE_SET.has(value as AuthFilesViewMode);

/** Older builds persisted `enabled` (and before that, `disabledProblem`). */
export const normalizePersistedStatusFilterMode = (
  value: unknown
): AuthFilesStatusFilterMode | null => {
  if (value === 'enabled') return 'active';
  if (value === 'disabledProblem') return 'problem';
  return isAuthFilesStatusFilterMode(value) ? value : null;
};

const readAuthFilesUiStateFromStorage = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): AuthFilesUiState | null => {
  if (!storage) return null;
  const raw = storage.getItem(AUTH_FILES_UI_STATE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as AuthFilesUiState;
  return parsed && typeof parsed === 'object' ? parsed : null;
};

export const readAuthFilesUiState = (): AuthFilesUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    return (
      readAuthFilesUiStateFromStorage(window.localStorage) ??
      readAuthFilesUiStateFromStorage(window.sessionStorage)
    );
  } catch {
    return null;
  }
};

export const writeAuthFilesUiState = (state: AuthFilesUiState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(AUTH_FILES_UI_STATE_KEY);
  } catch {
    // ignore
  }
};
