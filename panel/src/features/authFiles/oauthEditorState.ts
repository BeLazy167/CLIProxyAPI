import { hasOpenPopup } from '@/components/ui/popupState';
import { normalizeProviderKey } from './constants';

type ModelAliasDraftEntry = {
  id?: string;
  name?: string;
  alias?: string;
  fork?: boolean;
  forceMapping?: boolean;
};

export const getStringSetSignature = (values: Iterable<string>): string =>
  JSON.stringify(
    Array.from(new Set(values), (value) => value.trim())
      .filter(Boolean)
      .sort()
  );

export const getModelAliasDraftSignature = (entries: ModelAliasDraftEntry[]): string =>
  JSON.stringify(
    entries
      .map((entry) => ({
        name: entry.name ?? '',
        alias: entry.alias ?? '',
        fork: entry.fork === true,
        forceMapping: typeof entry.forceMapping === 'boolean' ? entry.forceMapping : undefined,
      }))
      .filter(
        (entry) =>
          entry.name !== '' ||
          entry.alias !== '' ||
          entry.fork !== true ||
          entry.forceMapping !== undefined
      )
  );

export const isOAuthEditorDirty = (
  initialProvider: string,
  currentProvider: string,
  baselineContentSignature: string,
  currentContentSignature: string
): boolean =>
  normalizeProviderKey(initialProvider) !== normalizeProviderKey(currentProvider) ||
  baselineContentSignature !== currentContentSignature;

const TYPING_TARGETS = 'input, select, textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * Both OAuth editor pages bind Escape on `window` to go back. That must not
 * fire while the user is typing in a field or has a popup open (a suggestion
 * list, menu, select or dialog): those own Escape themselves.
 */
export const shouldIgnoreEditorEscape = (event: {
  defaultPrevented?: boolean;
  target: EventTarget | null;
}): boolean => {
  if (event.defaultPrevented) return true;
  const target = event.target;
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as Element;
  return hasOpenPopup(element.ownerDocument) || Boolean(element.closest(TYPING_TARGETS));
};
