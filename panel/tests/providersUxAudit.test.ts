import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiCallApi } from '../src/services/api/apiCall';
import { runWithConcurrency } from '../src/features/providers/sheets/forms/connectivityProbe';
import {
  TEST_ALL_CONCURRENCY,
  canTestResource,
  useProviderTestStore,
} from '../src/features/providers/providerTestStore';
import type { ProviderResource } from '../src/features/providers/types';
import type { ConnectivityErrorMessages } from '../src/features/providers/sheets/forms/useConnectivityTest';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi'];
const messages: ConnectivityErrorMessages = {
  baseUrlRequired: 'base required',
  endpointInvalid: 'invalid endpoint',
  apiKeyRequired: 'key required',
  modelRequired: 'model required',
  timeout: () => 'timeout',
  requestFailed: 'failed',
};

const codexResource = (id: string, disabled = false): ProviderResource =>
  ({
    id,
    brand: 'codex',
    identifier: id,
    name: null,
    apiKey: `key-${id}`,
    apiKeyPreview: 'key-…',
    baseUrl: 'https://upstream.example/v1',
    prefix: null,
    priority: null,
    weight: null,
    disabled,
    raw: {
      apiKey: `key-${id}`,
      baseUrl: 'https://upstream.example/v1',
      models: [{ name: 'gpt-test' }],
    },
  }) as unknown as ProviderResource;

let requestSpy: ReturnType<typeof spyOn<typeof apiCallApi, 'request'>> | undefined;
afterEach(() => {
  requestSpy?.mockRestore();
  useProviderTestStore.setState({ results: {}, inFlight: 0 });
});

describe('providers: connectivity test store', () => {
  test('runWithConcurrency never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
    });
    await runWithConcurrency(tasks, 3);
    expect(peak).toBe(3);
    expect(TEST_ALL_CONCURRENCY).toBe(3);
  });

  test('Test all skips disabled entries and records latency and model per row', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: {},
    });
    const resources = [codexResource('a'), codexResource('b', true), codexResource('c')];
    await useProviderTestStore.getState().runTestAll(resources, messages);
    const { results, inFlight } = useProviderTestStore.getState();
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(inFlight).toBe(0);
    expect(results.b).toBeUndefined();
    expect(results.a.state).toBe('success');
    expect(results.a.model).toBe('gpt-test');
    expect(results.a.latencyMs).toBeNumber();
    expect(results.c.state).toBe('success');
  });

  test('failed probes keep the localized error text', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 401,
      header: {},
      bodyText: 'nope',
      body: {},
    });
    await useProviderTestStore.getState().runTest(codexResource('x'), messages);
    const result = useProviderTestStore.getState().results.x;
    expect(result.state).toBe('error');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.latencyMs).toBeNull();
  });

  test('sponsor and vertex rows are not testable', () => {
    expect(canTestResource({ ...codexResource('v'), brand: 'vertex' } as ProviderResource)).toBe(
      false
    );
    expect(canTestResource(codexResource('c'))).toBe(true);
  });
});

describe('providers: ledger and panel contracts', () => {
  const ledger = read('src/features/providers/components/ProviderResourceLedger.tsx');
  const panel = read('src/features/providers/components/ProviderResourcePanel.tsx');
  const toolbar = read('src/features/providers/components/ProviderResourceToolbar.tsx');
  const page = read('src/features/providers/ProvidersWorkbenchPage.tsx');
  const icon = read('src/features/providers/sheets/forms/ConnectivityStatusIcon.tsx');

  test('row opens detail, test results announce politely, icons are labelled', () => {
    expect(ledger).toContain('onOpen(resource)');
    expect(ledger).toContain('aria-live="polite"');
    expect(ledger).toContain("providersPage.connectivity.ok'");
    expect(ledger).toContain('providersPage.actions.enableNamed');
    expect(icon).toContain('role="img"');
    expect(icon).toContain('aria-label');
  });

  test('panel renders three distinct empty states and a test hint', () => {
    expect(panel).toContain('providersPage.table.emptyTitle');
    expect(panel).toContain('providersPage.table.noMatchTitle');
    expect(panel).toContain("t('common.clear_search')");
    expect(panel).toContain('providersPage.connectivity.testHint');
    expect(panel).toContain('providersPage.connectivity.testAll');
    expect(page).toContain('<ErrorBanner');
    expect(page).toContain('ProviderResourceLedgerSkeleton');
  });

  test('model filter is a labelled dialog with search', () => {
    expect(toolbar).toContain('aria-haspopup="dialog"');
    expect(toolbar).toContain('role="dialog"');
    expect(toolbar).toContain('providersPage.toolbar.filter.searchPlaceholder');
  });

  test('ledger stacks into cards below 900px', () => {
    const scss = read('src/features/providers/components/ProviderResourceLedger.module.scss');
    expect(scss).toContain('$stack-breakpoint: 900px');
    expect(scss).toContain('grid-template-areas');
  });
});

describe('providers: form reorganisation', () => {
  const form = read('src/features/providers/sheets/forms/BaseProviderForm.tsx');
  const detail = read('src/features/providers/sheets/ResourceDetailView.tsx');
  const sheet = read('src/features/providers/sheets/ProviderSheet.tsx');

  test('groups fields into Connection, Routing, Models and Advanced', () => {
    for (const section of ['connection', 'routing', 'models', 'advanced']) {
      expect(form).toContain(`providersPage.form.sections.${section}`);
    }
    expect(form).toContain('defaultOpen={existingModelNames.size > 0}');
    expect(form).toContain('providersPage.form.priorityHint');
  });

  test('validation surfaces at the top, marks the field and focuses it', () => {
    expect(form).toContain('role="alert"');
    expect(form).toContain("'aria-invalid': true");
    expect(form).toContain("'aria-describedby': errorId");
    expect(form).toContain('target?.focus()');
    expect(form).toContain("required={mode === 'create'}");
  });

  test('cloak mode is a Select, not free text', () => {
    expect(form).not.toContain('placeholder="auto / always / never"');
    expect(form).toContain('providersPage.form.cloakModeAuto');
  });

  test('detail view masks secrets with reveal and copy; sheet copy is fixed', () => {
    expect(detail).toContain('maskApiKey');
    expect(detail).toContain('copyToClipboard');
    expect(detail).toContain('providersPage.form.weight');
    expect(sheet).toContain("t('common.close')");
    expect(sheet).toContain('providersPage.sheet.description');
    expect(sheet).not.toContain('providersPage.table.description');
  });
});

describe('providers: locale coverage', () => {
  const required = [
    'connectivity.ok',
    'connectivity.testHint',
    'connectivity.testAllHint',
    'connectivity.stateSuccess',
    'table.emptyTitle',
    'table.noMatchTitle',
    'table.healthSummary',
    'form.sections.connection',
    'form.sections.advanced',
    'form.configuredCount',
    'form.cloakModeAuto',
    'toolbar.filter.dialogLabel',
    'header.attention',
    'categories.attention',
    'detail.copied',
    'sheet.description',
  ];
  const lookup = (obj: Record<string, unknown>, path: string) =>
    path.split('.').reduce<unknown>((cur, key) => (cur as Record<string, unknown>)?.[key], obj);

  test('every new providersPage key exists in all locales and toasts carry the name', () => {
    for (const locale of LOCALES) {
      const page = JSON.parse(read(`src/i18n/locales/${locale}.json`)).providersPage;
      for (const key of required) {
        expect(typeof lookup(page, key)).toBe('string');
      }
      for (const key of ['created', 'updated', 'deleted', 'enabled', 'disabled']) {
        expect(page.toast[key]).toContain('{{name}}');
      }
      expect(page.table.description).toBeUndefined();
      expect(page.categories.quickFill).toBeUndefined();
    }
  });
});
