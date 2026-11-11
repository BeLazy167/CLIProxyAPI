import {
  QUICK_FILTERS,
  isErrorLogLine,
  matchesQuickFilter,
  type ParsedLogLine,
  type QuickFilter,
} from './logTypes';

/** Counts for the quick-filter segment, over the lines the segment would narrow. */
export function countQuickFilters(
  lines: readonly Pick<ParsedLogLine, 'level' | 'statusCode'>[]
): Record<QuickFilter, number> {
  const counts = Object.fromEntries(QUICK_FILTERS.map((key) => [key, 0])) as Record<
    QuickFilter,
    number
  >;
  for (const line of lines) {
    for (const key of QUICK_FILTERS) {
      if (matchesQuickFilter(line, key)) counts[key] += 1;
    }
  }
  return counts;
}

export interface LogBufferSummary {
  lines: number;
  requests: number;
  errors: number;
  serverErrors: number;
}

export const isRequestLogLine = (line: Pick<ParsedLogLine, 'method' | 'statusCode'>): boolean =>
  Boolean(line.method) || typeof line.statusCode === 'number';

/** Header meta line: what is in the whole cached buffer, before any filter. */
export function summarizeLogEntries(
  lines: readonly Pick<ParsedLogLine, 'level' | 'statusCode' | 'method'>[]
): LogBufferSummary {
  const summary: LogBufferSummary = {
    lines: lines.length,
    requests: 0,
    errors: 0,
    serverErrors: 0,
  };
  for (const line of lines) {
    if (isRequestLogLine(line)) summary.requests += 1;
    if (isErrorLogLine(line)) summary.errors += 1;
    if (typeof line.statusCode === 'number' && line.statusCode >= 500) summary.serverErrors += 1;
  }
  return summary;
}

const TIMESTAMP_PARTS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?$/;

/** `2026-06-08 12:34:56.123` -> day for separator rows, `HH:mm:ss` for the row itself. */
export function splitLogTimestamp(timestamp?: string): { day?: string; time?: string } {
  if (!timestamp) return {};
  const match = timestamp.match(TIMESTAMP_PARTS);
  if (!match) return { time: timestamp };
  return { day: match[1], time: match[2] };
}

export interface TextSegment {
  text: string;
  match: boolean;
}

/** Case-insensitive split for search highlighting; one segment when nothing matches. */
export function splitSearchMatches(text: string, needle: string): TextSegment[] {
  const query = needle.trim().toLowerCase();
  if (!text || !query) return [{ text, match: false }];
  const lowered = text.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;
  let index = lowered.indexOf(query);
  while (index >= 0) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + query.length), match: true });
    cursor = index + query.length;
    index = lowered.indexOf(query, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
