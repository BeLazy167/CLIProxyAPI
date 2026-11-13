// Every UI SDK popup's content part has a data-slot ending in "-content", and data-open while open.
const OPEN_POPUP = '[data-slot$="-content"][data-open]';

/**
 * Whether a UI SDK popup (select, menu, popover, dialog, sheet, suggestions, tooltip) is open. An
 * open popup handles Escape itself, so page-level Escape shortcuts leave it alone.
 */
export const hasOpenPopup = (doc: Pick<Document, 'querySelector'> | null | undefined): boolean =>
  Boolean(doc?.querySelector(OPEN_POPUP));
