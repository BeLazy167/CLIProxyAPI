/**
 * 连通性探测的纯函数部分:构造一次最小真实请求并返回结果。
 * 表单 hook(useConnectivityTest)与行级测试(providerTestStore)共用。
 */

import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  buildCodexResponsesEndpoint,
  buildClaudeMessagesEndpoint,
  buildGeminiGenerateContentEndpoint,
  buildInteractionsEndpoint,
  buildInteractionsProbePayload,
  INTERACTIONS_API_REVISION,
  buildOpenAIChatCompletionsEndpoint,
} from '@/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ModelEntryInput, ProviderBrand } from '../../types';

export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export interface ConnectivityErrorMessages {
  baseUrlRequired: string;
  endpointInvalid: string;
  apiKeyRequired: string;
  modelRequired: string;
  timeout: (seconds: number) => string;
  requestFailed: string;
}

export type ProbeResult =
  { ok: true; latencyMs: number; model: string } | { ok: false; message: string; model: string };

export interface ProbeInput {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  testModel?: string;
  models: ModelEntryInput[];
  formHeaders: Array<{ key: string; value: string }>;
  /** 显式密钥(表单输入或已保存值) */
  apiKey?: string;
  authIndex?: string;
}

export const PROBE_BRANDS: ReadonlyArray<ProviderBrand> = [
  'codex',
  'meta',
  'xai',
  'gemini',
  'interactions',
  'claude',
  'openaiCompatibility',
];

export const isProbeBrand = (brand: ProviderBrand): boolean => PROBE_BRANDS.includes(brand);

const requestFailureMessage = (err: unknown, messages: ConnectivityErrorMessages): string => {
  const raw = getErrorMessage(err);
  const isTimeout =
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      String((err as { code?: string }).code) === 'ECONNABORTED') ||
    raw.toLowerCase().includes('timeout');

  return isTimeout ? messages.timeout(DEFAULT_TIMEOUT_MS / 1000) : raw || messages.requestFailed;
};

export const pickModel = (testModel: string | undefined, models: ModelEntryInput[]): string => {
  const trimmed = (testModel ?? '').trim();
  if (trimmed) return trimmed;
  for (const m of models) {
    const name = (m.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

const resolveBearerToken = (headers: Record<string, string>): string => {
  const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  if (!auth) return '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

interface PreparedRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
  model: string;
  authIndex?: string;
}

type Prepared = { ok: true; request: PreparedRequest } | { ok: false; message: string };

const fail = (message: string): Prepared => ({ ok: false, message });

function prepare(input: ProbeInput, messages: ConnectivityErrorMessages): Prepared {
  const { brand } = input;
  const customHeaders = buildHeaderObject(input.formHeaders);
  const resolvedKey = (input.apiKey ?? '').trim();
  const resolvedAuthIndex = (input.authIndex ?? '').trim() || undefined;
  const trimmedBase = input.baseUrl.trim();
  const model = pickModel(input.testModel, input.models);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...customHeaders };

  if (brand === 'openaiCompatibility' || brand === 'codex' || brand === 'meta' || brand === 'xai') {
    if (!trimmedBase) return fail(messages.baseUrlRequired);
    const endpoint =
      brand === 'openaiCompatibility'
        ? buildOpenAIChatCompletionsEndpoint(trimmedBase)
        : buildCodexResponsesEndpoint(trimmedBase);
    if (!endpoint) return fail(messages.endpointInvalid);
    if (!model) return fail(messages.modelRequired);
    const hasAuthorization = hasHeader(customHeaders, 'authorization');
    if (!resolvedKey && !hasAuthorization && !resolvedAuthIndex)
      return fail(messages.apiKeyRequired);
    if (!hasAuthorization) {
      headers.Authorization = resolvedKey ? `Bearer ${resolvedKey}` : 'Bearer $TOKEN$';
    }
    const body =
      brand === 'openaiCompatibility'
        ? { model, messages: [{ role: 'user', content: 'Hi' }], stream: false, max_tokens: 5 }
        : { model, input: 'Hi', stream: false };
    return { ok: true, request: { endpoint, headers, body, model, authIndex: resolvedAuthIndex } };
  }

  if (brand === 'gemini' || brand === 'interactions') {
    if (!model) return fail(messages.modelRequired);
    const endpoint =
      brand === 'interactions'
        ? buildInteractionsEndpoint(trimmedBase)
        : buildGeminiGenerateContentEndpoint(trimmedBase, model);
    if (!endpoint) return fail(messages.endpointInvalid);
    const hasApiKeyHeader = hasHeader(customHeaders, 'x-goog-api-key');
    if (!resolvedKey && !hasApiKeyHeader && !resolvedAuthIndex)
      return fail(messages.apiKeyRequired);
    if (!hasApiKeyHeader) {
      headers['x-goog-api-key'] = resolvedKey || '$TOKEN$';
    }
    if (brand === 'interactions' && !hasHeader(headers, 'api-revision')) {
      headers['Api-Revision'] = INTERACTIONS_API_REVISION;
    }
    const body =
      brand === 'interactions'
        ? buildInteractionsProbePayload(model)
        : { contents: [{ parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 8 } };
    return { ok: true, request: { endpoint, headers, body, model, authIndex: resolvedAuthIndex } };
  }

  if (brand === 'claude') {
    const endpoint = buildClaudeMessagesEndpoint(trimmedBase);
    if (!endpoint) return fail(messages.endpointInvalid);
    if (!model) return fail(messages.modelRequired);
    const hasApiKeyHeader = hasHeader(customHeaders, 'x-api-key');
    const key = resolvedKey || resolveBearerToken(customHeaders);
    if (!key && !hasApiKeyHeader && !resolvedAuthIndex) return fail(messages.apiKeyRequired);
    if (!hasHeader(headers, 'anthropic-version')) {
      headers['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }
    if (!hasApiKeyHeader) {
      headers['x-api-key'] = key || '$TOKEN$';
    }
    const body = { model, max_tokens: 8, messages: [{ role: 'user', content: 'Hi' }] };
    return { ok: true, request: { endpoint, headers, body, model, authIndex: resolvedAuthIndex } };
  }

  return fail(messages.endpointInvalid);
}

/** 发送一次最小真实补全请求;失败原因已本地化。 */
export async function runProbe(
  input: ProbeInput,
  messages: ConnectivityErrorMessages
): Promise<ProbeResult> {
  const prepared = prepare(input, messages);
  if (!prepared.ok) {
    return {
      ok: false,
      message: prepared.message,
      model: pickModel(input.testModel, input.models),
    };
  }
  const { request } = prepared;
  const startedAt = performance.now();
  try {
    const result = await apiCallApi.request(
      {
        authIndex: request.authIndex,
        proxy_url: input.proxyUrl?.trim() || undefined,
        method: 'POST',
        url: request.endpoint,
        header: request.headers,
        data: JSON.stringify(request.body),
      },
      { timeout: DEFAULT_TIMEOUT_MS }
    );
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(getApiCallErrorMessage(result));
    }
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), model: request.model };
  } catch (err) {
    return { ok: false, message: requestFailureMessage(err, messages), model: request.model };
  }
}

/** 以固定并发度跑任务;顺序与结果无关,调用方自行写状态。 */
export async function runWithConcurrency(
  tasks: ReadonlyArray<() => Promise<void>>,
  limit: number
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
