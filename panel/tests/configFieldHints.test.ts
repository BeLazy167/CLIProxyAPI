// Finding 1 守卫：搜索索引里的每个字段都必须有 hintKey，且在 en.json 中解析为非空字符串。
// 新增字段忘记写提示时此测试失败。

import { describe, expect, test } from 'bun:test';
import en from '@/i18n/locales/en.json';
import {
  CONFIG_FIELD_SEARCH_INDEX,
  RESTART_REQUIRED_FIELD_IDS,
} from '@/features/config/searchIndex';

function resolve(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, en);
}

describe('config field hints', () => {
  test('every indexed field declares a hintKey', () => {
    const missing = CONFIG_FIELD_SEARCH_INDEX.filter((entry) => !entry.hintKey).map(
      (entry) => entry.fieldId
    );
    expect(missing).toEqual([]);
  });

  test('every hintKey and labelKey resolves to a non-empty English string', () => {
    const broken: string[] = [];
    for (const entry of CONFIG_FIELD_SEARCH_INDEX) {
      for (const key of [entry.labelKey, entry.hintKey, entry.qualifierKey]) {
        if (!key) continue;
        const value = resolve(key);
        if (typeof value !== 'string' || value.trim() === '') broken.push(`${entry.fieldId}:${key}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('restart-required flags are data-driven from the index', () => {
    expect(RESTART_REQUIRED_FIELD_IDS.has('commercialMode')).toBe(true);
    expect(RESTART_REQUIRED_FIELD_IDS.has('trustedProxies')).toBe(true);
    expect(RESTART_REQUIRED_FIELD_IDS.has('port')).toBe(false);
  });
});
