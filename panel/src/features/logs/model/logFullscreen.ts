export function shouldExitLogFullscreen(
  event: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>,
  hasOpenPopup: boolean
): boolean {
  // Nested controls (for example Select) get first refusal on Escape.
  return event.key === 'Escape' && !event.defaultPrevented && !hasOpenPopup;
}
