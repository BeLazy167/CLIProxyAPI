export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** One-click failure filters. `errors` = level error/fatal or any status >= 400. */
export const QUICK_FILTERS = ['all', 'errors', '4xx', '5xx'] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogState = {
  buffer: string[];
  visibleFrom: number;
};

export type ParsedLogLine = {
  raw: string;
  timestamp?: string;
  level?: LogLevel;
  source?: string;
  requestId?: string;
  statusCode?: number;
  latency?: string;
  ip?: string;
  method?: HttpMethod;
  path?: string;
  message: string;
};

export const isErrorLogLine = (line: Pick<ParsedLogLine, 'level' | 'statusCode'>): boolean =>
  line.level === 'error' ||
  line.level === 'fatal' ||
  (typeof line.statusCode === 'number' && line.statusCode >= 400);

export const matchesQuickFilter = (
  line: Pick<ParsedLogLine, 'level' | 'statusCode'>,
  filter: QuickFilter
): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'errors':
      return isErrorLogLine(line);
    case '4xx':
      return typeof line.statusCode === 'number' && line.statusCode >= 400 && line.statusCode < 500;
    case '5xx':
      return typeof line.statusCode === 'number' && line.statusCode >= 500 && line.statusCode < 600;
  }
};
