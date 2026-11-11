import { expect, test } from 'bun:test';

// The gateway answers the two management routes by fetching from GitHub, and its api-call proxy would
// fetch the GitHub API for the panel, so this panel build asks for none of them.
const GITHUB_BACKED_ROUTES = [
  '/server/latest-version',
  '/plugins/store',
  "'https://api.github.com'",
];

test('no panel source calls a gateway route that fetches from GitHub', async () => {
  const offenders: string[] = [];
  for await (const path of new Bun.Glob('src/**/*.{ts,tsx}').scan('.')) {
    const source = await Bun.file(path).text();
    for (const route of GITHUB_BACKED_ROUTES) {
      if (source.includes(route)) offenders.push(`${path}: ${route}`);
    }
  }
  expect(offenders).toEqual([]);
});
