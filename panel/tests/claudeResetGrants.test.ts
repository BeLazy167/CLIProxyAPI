import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  anthropicResetGrantBlocker,
  claimClaudeResetGrant,
  parseAnthropicResetGrantStatus,
} from '../src/services/api/claudeResetGrants';
import { apiCallApi } from '../src/services/api/apiCall';
import { apiClient } from '../src/services/api/client';

const grant = { id: 'test-grant', resets_total: 2, resets_left: 2, usable_now: true };
const block = { eligible: true, at_limit: true, grants: [grant] };
const status = () => parseAnthropicResetGrantStatus(block)!;
const originalRequest = apiCallApi.request;
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  apiCallApi.request = originalRequest;
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

describe('Claude reset grant fail-closed parsing', () => {
  test('valid block and refusing defaults', () => {
    expect(status().grants[0].useRequiresLimit).toBe(true);
    expect(anthropicResetGrantBlocker(status(), grant.id)).toBeNull();
    expect(anthropicResetGrantBlocker({ ...status(), atLimit: false }, grant.id)).toBe(
      'not_limited'
    );
    expect(anthropicResetGrantBlocker({ ...status(), eligible: false }, grant.id)).toBe(
      'ineligible'
    );
    const missing = parseAnthropicResetGrantStatus({
      ...block,
      grants: [{ ...grant, usable_now: undefined }],
    })!;
    expect(anthropicResetGrantBlocker(missing, grant.id)).toBe('not_usable');
  });
  test('rejects malformed blocks and grants', () => {
    for (const value of [
      undefined,
      {},
      { ...block, eligible: 1 },
      { ...block, grants: {} },
      { ...block, grants: [grant, grant] },
      { ...block, cooldown_until: 'bad' },
    ]) {
      expect(parseAnthropicResetGrantStatus(value)).toBeNull();
    }
    for (const fields of [
      { id: '../bad' },
      { resets_left: -1 },
      { resets_left: 3 },
      { resets_total: 1.5 },
      { paused: 'false' },
      { starts_at: 'bad' },
      { clears: {} },
    ]) {
      expect(
        parseAnthropicResetGrantStatus({ ...block, grants: [{ ...grant, ...fields }] })
      ).toBeNull();
    }
  });
});

describe('the ⚡ claim goes through the claude-quota plugin', () => {
  const route = 'https://gw.example.test/v0/management/plugins/claude-quota/claim';
  const plugin = (answer: () => Promise<unknown>) => {
    apiCallApi.request = async () => {
      throw new Error('the panel must not call Anthropic to claim');
    };
    const post = spyOn(apiClient, 'post').mockImplementation(answer as never);
    spies.push(post);
    return post;
  };
  const refusal = (status: number, data: unknown) =>
    Object.assign(new Error('refused'), { name: 'ApiError', status, data });

  test('posts the auth index and grant to the plugin route, outside the v8 base', async () => {
    const post = plugin(async () => ({
      message: 'Reset claimed. Resets left: 1.',
      offer_id: 'o1',
      state: 'DONE',
    }));
    expect(await claimClaudeResetGrant('https://gw.example.test/', 'idx-1', grant.id)).toEqual({
      ok: true,
      message: 'Reset claimed. Resets left: 1.',
      state: 'DONE',
    });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0] as unknown as [
      string,
      unknown,
      { timeout: number },
    ];
    expect(url).toBe(route);
    expect(body).toEqual({ auth_index: 'idx-1', grant_id: grant.id });
    expect(config.timeout).toBeGreaterThan(90_000);
  });

  test("a refusal shows the plugin's own message and offer state", async () => {
    plugin(async () => {
      throw refusal(409, {
        message: 'An earlier claim on this account has an unknown outcome. Nothing was claimed.',
        offer_id: '',
        state: 'UNKNOWN',
      });
    });
    expect(await claimClaudeResetGrant('https://gw.example.test', 'idx-1', grant.id)).toEqual({
      ok: false,
      message: 'An earlier claim on this account has an unknown outcome. Nothing was claimed.',
      state: 'UNKNOWN',
    });
    plugin(async () => {
      throw refusal(503, { message: 'This plugin build cannot claim (shadow mode).' });
    });
    expect(await claimClaudeResetGrant('https://gw.example.test', 'idx-1', grant.id)).toEqual({
      ok: false,
      message: 'This plugin build cannot claim (shadow mode).',
      state: '',
    });
  });

  test('no answer from the plugin rejects, since it may still have sent the claim', async () => {
    for (const failure of [
      refusal(404, undefined),
      refusal(502, '<html>bad gateway</html>'),
      new Error('timeout of 120000ms exceeded'),
    ]) {
      plugin(async () => {
        throw failure;
      });
      await expect(
        claimClaudeResetGrant('https://gw.example.test', 'idx-1', grant.id)
      ).rejects.toThrow();
    }
  });
});

test('the browser never claims, reads the organization, or clears a cooldown on its own', async () => {
  const sources = await Promise.all(
    [
      'src/services/api/claudeResetGrants.ts',
      'src/features/quota/providers/claude/ClaudeResetGrants.tsx',
      'src/features/quota/providers/claude/resetGrantGroups.ts',
    ].map((path) => Bun.file(path).text())
  );
  for (const source of sources) {
    for (const call of ['reset_rate_limits', '/api/oauth/profile', 'resetCooldown']) {
      expect(source).not.toContain(call);
    }
  }
  expect(
    await Bun.file('src/features/quota/providers/claude/resetGrantOperations.ts').exists()
  ).toBe(false);
});

test('all grant messages and confirmation are translated in every locale', async () => {
  const locales = await Promise.all(
    ['en', 'zh-CN', 'zh-TW', 'ru', 'vi'].map(
      async (locale) => (await Bun.file(`src/i18n/locales/${locale}.json`).json()).claude_reset
    )
  );
  for (const locale of locales) {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(locales[0]).sort());
    expect(locale.confirm_text).toContain('{{name}}');
    expect(locale.answer).toContain('{{message}}');
    expect(locale.answer).toContain('{{state}}');
    expect(typeof locale.unknown).toBe('string');
  }
});

test('Claude card and ledger share the grouped reset list and the shared confirmation', async () => {
  const card = await Bun.file('src/features/quota/components/QuotaCard.tsx').text();
  const ledger = await Bun.file('src/features/quota/components/QuotaLedger.tsx').text();
  const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
  expect(card).toContain('<ClaudeResetGroups');
  expect(ledger).toContain('<ClaudeResetGroups');
  expect(hook).toContain('showConfirmation({');
  expect(hook).toContain('claimClaudeResetGrant(');
  expect(hook).not.toContain('<Modal');
});
