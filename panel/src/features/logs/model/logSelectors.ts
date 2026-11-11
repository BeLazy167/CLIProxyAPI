import { parseLogLine } from '@/features/logs/model/logParsing';
import {
  matchesQuickFilter,
  type HttpMethod,
  type ParsedLogLine,
  type QuickFilter,
} from '@/features/logs/model/logTypes';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import type { LogBuffer } from './logBuffer';

export type LogEntry = ParsedLogLine & { id: number };

/** Cache only the current buffer. Repeated text remains separate records. */
export function createLogParserCache() {
  let cache = new Map<number, LogEntry>();
  return (buffer: LogBuffer): LogEntry[] => {
    const next = new Map<number, LogEntry>();
    const entries = buffer.buffer.map((raw, index) => {
      const id = buffer.bufferStart + index;
      const previous = cache.get(id);
      const entry = previous?.raw === raw ? previous : { ...parseLogLine(raw), id };
      next.set(id, entry);
      return entry;
    });
    cache = next;
    return entries;
  };
}

export function searchLogEntries(
  entries: LogEntry[],
  query: string,
  hideManagement: boolean
): LogEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const path = entry.path?.split('?')[0];
    if (
      hideManagement &&
      path &&
      (path === MANAGEMENT_API_PREFIX || path.startsWith(`${MANAGEMENT_API_PREFIX}/`))
    )
      return false;
    return !needle || entry.raw.toLowerCase().includes(needle);
  });
}

export interface LogEntryFilters {
  methods: Set<HttpMethod>;
  paths: Set<string>;
  level: string;
  requestId?: string;
  quick?: QuickFilter;
}

export function filterLogEntries(entries: LogEntry[], filters: LogEntryFilters): LogEntry[] {
  return entries.filter((entry) => {
    if (filters.level && entry.level !== filters.level) return false;
    if (filters.requestId && entry.requestId !== filters.requestId) return false;
    if (filters.quick && !matchesQuickFilter(entry, filters.quick)) return false;
    if (filters.methods.size && (!entry.method || !filters.methods.has(entry.method))) return false;
    return !filters.paths.size || Boolean(entry.path && filters.paths.has(entry.path));
  });
}
