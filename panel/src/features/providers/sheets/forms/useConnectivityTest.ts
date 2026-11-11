import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiKeyEntryInput, ModelEntryInput, ProviderBrand } from '../../types';
import { runProbe, type ConnectivityErrorMessages } from './connectivityProbe';

export type { ConnectivityErrorMessages } from './connectivityProbe';

export type ConnectivityState = 'idle' | 'loading' | 'success' | 'error';

export interface ConnectivityStatus {
  state: ConnectivityState;
  message: string;
  /** 成功时的往返耗时与实际探测模型 */
  latencyMs?: number;
  model?: string;
}

const IDLE: ConnectivityStatus = { state: 'idle', message: '' };

export interface UseConnectivityTestArgs {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  testModel?: string;
  models: ModelEntryInput[];
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
}

export interface UseConnectivityTestResult {
  openaiStatuses: ConnectivityStatus[];
  codexStatus: ConnectivityStatus;
  geminiStatus: ConnectivityStatus;
  claudeStatus: ConnectivityStatus;
  isTestingAny: boolean;
  runOpenAIKey: (idx: number) => Promise<boolean>;
  runOpenAIAllKeys: () => Promise<void>;
  runCodex: () => Promise<void>;
  runGemini: () => Promise<void>;
  runClaude: () => Promise<void>;
}

const toStatus = (result: Awaited<ReturnType<typeof runProbe>>): ConnectivityStatus =>
  result.ok
    ? { state: 'success', message: '', latencyMs: result.latencyMs, model: result.model }
    : { state: 'error', message: result.message };

export function useConnectivityTest(
  args: UseConnectivityTestArgs,
  messages: ConnectivityErrorMessages
): UseConnectivityTestResult {
  const {
    brand,
    baseUrl,
    proxyUrl,
    testModel,
    models,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
  } = args;

  const entriesCount = apiKeyEntries?.length ?? 0;

  const [openaiStatuses, setOpenaiStatuses] = useState<ConnectivityStatus[]>(() =>
    Array.from({ length: entriesCount }, () => IDLE)
  );
  const [codexStatus, setCodexStatus] = useState<ConnectivityStatus>(IDLE);
  const [geminiStatus, setGeminiStatus] = useState<ConnectivityStatus>(IDLE);
  const [claudeStatus, setClaudeStatus] = useState<ConnectivityStatus>(IDLE);
  const [inFlight, setInFlight] = useState(0);

  const entrySignatures = useMemo(
    () =>
      (apiKeyEntries ?? []).map((entry) =>
        [
          entry.apiKey ?? '',
          entry.existingApiKey ?? '',
          entry.authIndex ?? '',
          entry.proxyUrl ?? '',
        ].join('||')
      ),
    [apiKeyEntries]
  );

  const lastEntrySignaturesRef = useRef<string[]>(entrySignatures);
  useEffect(() => {
    const prev = lastEntrySignaturesRef.current;
    const curr = entrySignatures;
    lastEntrySignaturesRef.current = curr;

    setOpenaiStatuses((statuses) => {
      const nextLen = curr.length;
      let mutated = statuses.length !== nextLen;
      const next = statuses.slice(0, nextLen);
      while (next.length < nextLen) next.push(IDLE);
      for (let i = 0; i < nextLen; i++) {
        if (prev[i] !== undefined && prev[i] !== curr[i] && next[i].state !== 'idle') {
          next[i] = IDLE;
          mutated = true;
        }
      }
      return mutated ? next : statuses;
    });
  }, [entrySignatures]);

  const signature = useMemo(() => {
    const h = formHeaders.map((it) => `${it.key}:${it.value}`).join('|');
    const m = models.map((it) => `${it.name}:${it.alias ?? ''}`).join('|');
    return [
      baseUrl,
      proxyUrl ?? '',
      (testModel ?? '').trim(),
      apiKey ?? '',
      fallbackApiKey ?? '',
      authIndex ?? '',
      h,
      m,
    ].join('||');
  }, [apiKey, authIndex, baseUrl, proxyUrl, fallbackApiKey, testModel, formHeaders, models]);

  const lastSignatureRef = useRef(signature);
  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    setOpenaiStatuses((prev) => prev.map(() => IDLE));
    setCodexStatus(IDLE);
    setGeminiStatus(IDLE);
    setClaudeStatus(IDLE);
  }, [signature]);

  const updateOpenaiStatus = useCallback((idx: number, value: ConnectivityStatus) => {
    setOpenaiStatuses((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const resolvedKey = useMemo(
    () => (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim(),
    [apiKey, fallbackApiKey]
  );

  const runOpenAIKey = useCallback(
    async (idx: number): Promise<boolean> => {
      if (brand !== 'openaiCompatibility') return false;
      const entry = apiKeyEntries?.[idx];
      const entryKey = (entry?.apiKey ?? '').trim() || (entry?.existingApiKey ?? '').trim();
      const entryAuthIndex = (entry?.authIndex ?? '').trim() || (authIndex ?? '').trim();

      updateOpenaiStatus(idx, { state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const result = await runProbe(
          {
            brand,
            baseUrl,
            proxyUrl: entry?.proxyUrl,
            testModel,
            models,
            formHeaders,
            apiKey: entryKey,
            authIndex: entryAuthIndex,
          },
          messages
        );
        updateOpenaiStatus(idx, toStatus(result));
        return result.ok;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      formHeaders,
      messages,
      models,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runOpenAIAllKeys = useCallback(async (): Promise<void> => {
    if (brand !== 'openaiCompatibility') return;
    const entries = apiKeyEntries ?? [];
    if (!entries.length) return;
    await Promise.all(entries.map((_, idx) => runOpenAIKey(idx)));
  }, [apiKeyEntries, brand, runOpenAIKey]);

  const runSingle = useCallback(
    async (setStatus: (value: ConnectivityStatus) => void) => {
      setStatus({ state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const result = await runProbe(
          {
            brand,
            baseUrl,
            proxyUrl,
            testModel,
            models,
            formHeaders,
            apiKey: resolvedKey,
            authIndex,
          },
          messages
        );
        setStatus(toStatus(result));
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [authIndex, baseUrl, brand, formHeaders, messages, models, proxyUrl, resolvedKey, testModel]
  );

  const runCodex = useCallback(async (): Promise<void> => {
    if (brand !== 'codex' && brand !== 'meta' && brand !== 'xai') return;
    await runSingle(setCodexStatus);
  }, [brand, runSingle]);

  const runGemini = useCallback(async (): Promise<void> => {
    if (brand !== 'gemini' && brand !== 'interactions') return;
    await runSingle(setGeminiStatus);
  }, [brand, runSingle]);

  const runClaude = useCallback(async (): Promise<void> => {
    if (brand !== 'claude') return;
    await runSingle(setClaudeStatus);
  }, [brand, runSingle]);

  return {
    openaiStatuses,
    codexStatus,
    geminiStatus,
    claudeStatus,
    isTestingAny: inFlight > 0,
    runOpenAIKey,
    runOpenAIAllKeys,
    runCodex,
    runGemini,
    runClaude,
  };
}
