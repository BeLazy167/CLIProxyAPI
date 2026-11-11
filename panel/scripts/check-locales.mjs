// Fails when any locale's key set drifts from en.json. Run: bun run check:locales
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const locales = ['zh-CN', 'zh-TW', 'ru', 'vi'];

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );

const load = (name) => JSON.parse(readFileSync(join(root, `${name}.json`), 'utf8'));
const enKeys = new Set(flatten(load('en')));
let failed = false;

for (const locale of locales) {
  const keys = new Set(flatten(load(locale)));
  const missing = [...enKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !enKeys.has(key));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`[${locale}] missing ${missing.length}, extra ${extra.length}`);
    for (const key of missing) console.error(`  - missing: ${key}`);
    for (const key of extra) console.error(`  - extra:   ${key}`);
  }
}

if (failed) process.exit(1);
console.log('locales in sync with en.json');
