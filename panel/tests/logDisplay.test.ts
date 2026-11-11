import { describe, expect, test } from 'bun:test';
import {
  countQuickFilters,
  splitLogTimestamp,
  splitSearchMatches,
  summarizeLogEntries,
} from '../src/features/logs/model/logDisplay';
import {
  extractRequestIdFromFileName,
  filterErrorLogFiles,
  sortErrorLogFilesNewestFirst,
  summarizeErrorLogFiles,
} from '../src/features/logs/model/errorLogLedger';
import { parseLogLine } from '../src/features/logs/model/logParsing';

const access = (status: number) =>
  `[2026-06-15 10:00:00] [abcd1234] [info ] [gin_logger.go:1] ${status} | 1ms | ::1 | POST "/v1/x"`;

describe('log display helpers', () => {
  test('quick-filter counts treat 4xx/5xx and error levels as errors', () => {
    const lines = [
      parseLogLine(access(200)),
      parseLogLine(access(404)),
      parseLogLine(access(502)),
      parseLogLine('[2026-06-15 10:00:01] [error] boom'),
      parseLogLine('[2026-06-15 10:00:02] [info ] connection refused'),
    ];
    expect(countQuickFilters(lines)).toEqual({ all: 5, errors: 3, '4xx': 1, '5xx': 1 });
    expect(summarizeLogEntries(lines)).toEqual({
      lines: 5,
      requests: 3,
      errors: 3,
      serverErrors: 1,
    });
  });

  test('timestamps split into day separators and HH:mm:ss', () => {
    expect(splitLogTimestamp('2026-06-15 10:00:00.123')).toEqual({
      day: '2026-06-15',
      time: '10:00:00',
    });
    expect(splitLogTimestamp('odd')).toEqual({ time: 'odd' });
    expect(splitLogTimestamp()).toEqual({});
  });

  test('search highlighting is case-insensitive and keeps the original text', () => {
    expect(splitSearchMatches('GET /Foo/foo', 'foo')).toEqual([
      { text: 'GET /', match: false },
      { text: 'Foo', match: true },
      { text: '/', match: false },
      { text: 'foo', match: true },
    ]);
    expect(splitSearchMatches('plain', '')).toEqual([{ text: 'plain', match: false }]);
  });
});

describe('error log ledger helpers', () => {
  const files = [
    { name: 'error-20260615-abcd1234.log', size: 2048, modified: 100 },
    { name: 'error-20260616-00ff00aa.log', size: 1024, modified: 300 },
    { name: 'error-20260614-12345678.log', modified: 200 },
  ];

  test('extracts hex request ids but not date-like tokens', () => {
    expect(extractRequestIdFromFileName(files[0].name)).toBe('abcd1234');
    expect(extractRequestIdFromFileName(files[2].name)).toBeUndefined();
  });

  test('sorts newest first, filters by name or request id, and summarises', () => {
    expect(sortErrorLogFilesNewestFirst(files).map((file) => file.modified)).toEqual([
      300, 200, 100,
    ]);
    expect(filterErrorLogFiles(files, 'ABCD').map((file) => file.name)).toEqual([files[0].name]);
    expect(filterErrorLogFiles(files, '20260614')).toHaveLength(1);
    expect(summarizeErrorLogFiles(files)).toEqual({ count: 3, totalSize: 3072, newest: 300 });
  });
});
