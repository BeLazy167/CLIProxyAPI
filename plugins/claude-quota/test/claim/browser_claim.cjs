// Open an offer page in headless Chromium and tap Claim, like the phone does.
// Usage: node browser_claim.cjs <offer url>
// Env: PLAYWRIGHT_CORE (module path), CHROME_BIN (browser binary).
const { execSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/bh-render/node_modules/playwright-core');

(async () => {
  const exe = process.env.CHROME_BIN || execSync(
    'ls -d ' + process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/*/chrome-headless-shell').toString().trim();
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  page.on('request', r => {
    if (r.method() === 'POST') console.log('POST', new URL(r.url()).pathname.replace(/offer\/[^/]+/, 'offer/<token>'), 'Origin:', r.headers()['origin']);
  });
  await page.goto(process.argv[2]);
  await page.click('button[type=submit]');
  await page.waitForLoadState('load');
  console.log('RESULT', (await page.innerText('body')).slice(0, 300).replace(/\n+/g, ' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
