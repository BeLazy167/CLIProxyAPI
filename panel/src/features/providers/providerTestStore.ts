/**
 * 行级连通性测试的会话状态(不持久化)。按资源 id 记录最近一次结果。
 */

import { create } from 'zustand';
import type { ApiKeyEntry, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { PROVIDER_DESCRIPTORS } from './descriptors';
import type { ProviderResource } from './types';
import {
  isProbeBrand,
  runProbe,
  runWithConcurrency,
  type ConnectivityErrorMessages,
  type ProbeInput,
} from './sheets/forms/connectivityProbe';

export const TEST_ALL_CONCURRENCY = 3;

export type ProviderTestState = 'loading' | 'success' | 'error';

export interface ProviderTestResult {
  state: ProviderTestState;
  message: string;
  latencyMs: number | null;
  model: string;
  testedAt: number;
}

interface ProviderTestStore {
  results: Record<string, ProviderTestResult>;
  /** 当前进行中的测试数量 */
  inFlight: number;
  runTest: (resource: ProviderResource, messages: ConnectivityErrorMessages) => Promise<void>;
  runTestAll: (resources: ProviderResource[], messages: ConnectivityErrorMessages) => Promise<void>;
  clear: (id: string) => void;
}

/** 该资源能否在列表行里直接发起测试(sponsor/vertex 不支持) */
export const canTestResource = (resource: ProviderResource): boolean =>
  PROVIDER_DESCRIPTORS[resource.brand].supportsTestModel && isProbeBrand(resource.brand);

const headerList = (headers?: Record<string, string>) =>
  Object.entries(headers ?? {}).map(([key, value]) => ({ key, value }));

export function buildProbeInput(resource: ProviderResource): ProbeInput {
  if (resource.brand === 'openaiCompatibility') {
    const cfg = resource.raw as OpenAIProviderConfig;
    const first: ApiKeyEntry | undefined = cfg.apiKeyEntries?.[0];
    return {
      brand: resource.brand,
      baseUrl: cfg.baseUrl ?? '',
      proxyUrl: first?.proxyUrl,
      testModel: cfg.testModel,
      models: (cfg.models ?? []).map((m) => ({ name: m.name, alias: m.alias })),
      formHeaders: headerList(cfg.headers),
      apiKey: first?.apiKey,
      authIndex: first?.authIndex || cfg.authIndex,
    };
  }
  const cfg = resource.raw as ProviderKeyConfig;
  return {
    brand: resource.brand,
    baseUrl: cfg.baseUrl ?? '',
    proxyUrl: cfg.proxyUrl,
    models: (cfg.models ?? []).map((m) => ({ name: m.name, alias: m.alias })),
    formHeaders: headerList(cfg.headers),
    apiKey: cfg.apiKey,
    authIndex: cfg.authIndex,
  };
}

export const useProviderTestStore = create<ProviderTestStore>((set, get) => ({
  results: {},
  inFlight: 0,
  runTest: async (resource, messages) => {
    if (!canTestResource(resource)) return;
    if (get().results[resource.id]?.state === 'loading') return;
    const id = resource.id;
    set((s) => ({
      inFlight: s.inFlight + 1,
      results: {
        ...s.results,
        [id]: { state: 'loading', message: '', latencyMs: null, model: '', testedAt: Date.now() },
      },
    }));
    const result = await runProbe(buildProbeInput(resource), messages);
    set((s) => ({
      inFlight: s.inFlight - 1,
      results: {
        ...s.results,
        [id]: result.ok
          ? {
              state: 'success',
              message: '',
              latencyMs: result.latencyMs,
              model: result.model,
              testedAt: Date.now(),
            }
          : {
              state: 'error',
              message: result.message,
              latencyMs: null,
              model: result.model,
              testedAt: Date.now(),
            },
      },
    }));
  },
  runTestAll: async (resources, messages) => {
    const { runTest } = get();
    const tasks = resources
      .filter((r) => canTestResource(r) && !r.disabled)
      .map((r) => () => runTest(r, messages));
    await runWithConcurrency(tasks, TEST_ALL_CONCURRENCY);
  },
  clear: (id) =>
    set((s) => {
      if (!(id in s.results)) return s;
      const next = { ...s.results };
      delete next[id];
      return { results: next };
    }),
}));
