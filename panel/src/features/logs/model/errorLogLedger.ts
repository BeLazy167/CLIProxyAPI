import type { ErrorLogFile } from '@/services/api/logs';

const HEX_TOKEN = /^[0-9a-f]{8}$/i;

/** Backend request ids are eight hex chars; skip all-digit tokens, which are usually dates. */
export function extractRequestIdFromFileName(name: string): string | undefined {
  const stem = name.replace(/\.[^.]+$/, '');
  const tokens = stem.split(/[^0-9a-z]+/i).filter((token) => HEX_TOKEN.test(token));
  return tokens.reverse().find((token) => /[a-f]/i.test(token));
}

export function sortErrorLogFilesNewestFirst(files: readonly ErrorLogFile[]): ErrorLogFile[] {
  return [...files].sort(
    (a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name)
  );
}

export function filterErrorLogFiles(files: readonly ErrorLogFile[], query: string): ErrorLogFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...files];
  return files.filter(
    (file) =>
      file.name.toLowerCase().includes(needle) ||
      (extractRequestIdFromFileName(file.name)?.toLowerCase().includes(needle) ?? false)
  );
}

export function summarizeErrorLogFiles(files: readonly ErrorLogFile[]): {
  count: number;
  totalSize: number;
  newest?: number;
} {
  let totalSize = 0;
  let newest: number | undefined;
  for (const file of files) {
    totalSize += file.size ?? 0;
    if (file.modified && (newest === undefined || file.modified > newest)) newest = file.modified;
  }
  return { count: files.length, totalSize, newest };
}
