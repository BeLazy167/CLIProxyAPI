import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useConfigStore } from '@/stores';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import { getErrorMessage } from '@/utils/helpers';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestUsageEntry,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import type { Config } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import {
  TRAFFIC_BUCKET_MINUTES,
  type CredentialHealth,
  type DashboardCounts,
  type ProviderTraffic,
  type SourceState,
  type TrafficWindow,
} from '../types';

const EMPTY_TRAFFIC: TrafficWindow = {
  buckets: [],
  totalSuccess: 0,
  totalFailure: 0,
  total: 0,
  successRate: null,
  peakTotal: 0,
  peakIndex: -1,
  windowMinutes: 0,
};

const IDLE_SOURCE: SourceState = { loading: false, error: null };

/** `api-key-usage` 的键形如 `<baseUrl>|<apiKey>`，取第一个分隔符之后的部分 */
const apiKeyFromCompositeKey = (compositeKey: string): string => {
  const separatorIndex = compositeKey.indexOf('|');
  return separatorIndex < 0 ? '' : compositeKey.slice(separatorIndex + 1).trim();
};

const providerIdOfAuthFile = (file: AuthFileItem): string => {
  const candidate = String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase();
  return candidate && candidate !== 'empty' ? candidate : 'unknown';
};

const buildTrafficWindow = (bucketGroups: RecentRequestBucket[][]): TrafficWindow => {
  const buckets = mergeRecentRequestBucketGroups(bucketGroups);
  if (buckets.length === 0) {
    return EMPTY_TRAFFIC;
  }

  let totalSuccess = 0;
  let totalFailure = 0;
  let peakTotal = 0;
  let peakIndex = -1;

  buckets.forEach((bucket, index) => {
    const bucketTotal = bucket.success + bucket.failed;
    totalSuccess += bucket.success;
    totalFailure += bucket.failed;
    if (bucketTotal > peakTotal) {
      peakTotal = bucketTotal;
      peakIndex = index;
    }
  });

  const total = totalSuccess + totalFailure;

  return {
    buckets,
    totalSuccess,
    totalFailure,
    total,
    successRate: total > 0 ? (totalSuccess / total) * 100 : null,
    peakTotal,
    peakIndex,
    windowMinutes: buckets.length * TRAFFIC_BUCKET_MINUTES,
  };
};

interface ProviderAccumulator {
  credentials: number;
  /** 至少有一个凭证来自配置内联的 API Key（而非 auth 文件） */
  hasApiKeys: boolean;
  success: number;
  failure: number;
  bucketGroups: RecentRequestBucket[][];
}

const createAccumulator = (): ProviderAccumulator => ({
  credentials: 0,
  hasApiKeys: false,
  success: 0,
  failure: 0,
  bucketGroups: [],
});

export const getProviderKeyCounts = (config: Config) => ({
  gemini: config.geminiApiKeys?.length ?? 0,
  interactions: config.interactionsApiKeys?.length ?? 0,
  codex: config.codexApiKeys?.length ?? 0,
  meta: config.metaApiKeys?.length ?? 0,
  xai: config.xaiApiKeys?.length ?? 0,
  claude: config.claudeApiKeys?.length ?? 0,
  vertex: config.vertexApiKeys?.length ?? 0,
  openai: config.openaiCompatibility?.length ?? 0,
});

/**
 * 汇总仪表盘所需的全部数据。
 *
 * 流量数据有两个互不重叠的来源：`api-key-usage`（配置内联的 API Key 凭证）
 * 与 `auth-files`（文件/运行时凭证）。后端对二者的判定条件互斥，但插件提供的
 * 凭证理论上可同时命中，因此这里按 `account_type` + `account` 做一次防御性去重。
 *
 * 每个来源各自暴露 loading/error：失败的加载不得伪装成「空数据」。
 */
export function useDashboardOverview() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const connected = connectionStatus === 'connected';

  const {
    usageByProvider,
    isLoading: usageLoading,
    refreshRecentRequests,
  } = useProviderRecentRequests({ enabled: connected });

  const [authFiles, setAuthFiles] = useState<AuthFileItem[] | null>(null);
  const [authFilesSource, setAuthFilesSource] = useState<SourceState>(IDLE_SOURCE);
  const [configSource, setConfigSource] = useState<SourceState>(IDLE_SOURCE);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadAuthFiles = useCallback(async () => {
    if (!connected) return;
    setAuthFilesSource({ loading: true, error: null });
    try {
      const response = await authFilesApi.list();
      setAuthFiles(response.files);
      setAuthFilesSource(IDLE_SOURCE);
    } catch (err) {
      setAuthFilesSource({ loading: false, error: getErrorMessage(err) });
    }
  }, [connected]);

  const loadConfig = useCallback(
    async (force = false) => {
      if (!connected) return;
      setConfigSource({ loading: true, error: null });
      try {
        await fetchConfig(force);
        setConfigSource(IDLE_SOURCE);
      } catch (err) {
        setConfigSource({ loading: false, error: getErrorMessage(err) });
      }
    },
    [connected, fetchConfig]
  );

  useEffect(() => {
    if (!connected) return;
    void loadConfig();
    void loadAuthFiles();
  }, [connected, loadConfig, loadAuthFiles]);

  // 流量轮询由 useProviderRecentRequests 内部定时触发；这里只记录最近一次落地时间。
  // 首次渲染时请求尚未发出（loading 仍为 false），所以要等「loading 回落」或缓存已有数据。
  const wasLoading = useRef(false);
  useEffect(() => {
    if (usageLoading) {
      wasLoading.current = true;
      return;
    }
    if (wasLoading.current || usageByProvider.size > 0) {
      wasLoading.current = false;
      setUpdatedAt(Date.now());
    }
  }, [usageLoading, usageByProvider]);

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([loadConfig(true), loadAuthFiles(), refreshRecentRequests()]);
    setUpdatedAt(Date.now());
  }, [connected, loadConfig, loadAuthFiles, refreshRecentRequests]);

  const providerKeyCounts = useMemo(() => (config ? getProviderKeyCounts(config) : null), [config]);

  const { traffic, providers } = useMemo(() => {
    const accumulators = new Map<string, ProviderAccumulator>();
    const allBucketGroups: RecentRequestBucket[][] = [];
    const apiKeysFromUsage = new Set<string>();

    const accumulatorFor = (providerId: string): ProviderAccumulator => {
      const existing = accumulators.get(providerId);
      if (existing) return existing;
      const created = createAccumulator();
      accumulators.set(providerId, created);
      return created;
    };

    usageByProvider.forEach((entriesByKey, providerId) => {
      const accumulator = accumulatorFor(providerId);
      accumulator.hasApiKeys = true;
      entriesByKey.forEach((entry, compositeKey) => {
        const apiKey = apiKeyFromCompositeKey(compositeKey);
        if (apiKey) {
          apiKeysFromUsage.add(apiKey);
        }
        accumulator.credentials += 1;
        accumulator.success += entry.success;
        accumulator.failure += entry.failed;
        if (entry.recentRequests.length > 0) {
          accumulator.bucketGroups.push(entry.recentRequests);
          allBucketGroups.push(entry.recentRequests);
        }
      });
    });

    (authFiles ?? []).forEach((file) => {
      const accountType = String(file.account_type ?? '')
        .trim()
        .toLowerCase();
      const account = String(file.account ?? '').trim();
      // 已经由 api-key-usage 统计过的凭证不再重复计入
      if (accountType === 'api_key' && account && apiKeysFromUsage.has(account)) {
        return;
      }

      const accumulator = accumulatorFor(providerIdOfAuthFile(file));
      const entry = normalizeRecentRequestUsageEntry(file);
      accumulator.credentials += 1;
      accumulator.success += entry.success;
      accumulator.failure += entry.failed;
      if (entry.recentRequests.length > 0) {
        accumulator.bucketGroups.push(entry.recentRequests);
        allBucketGroups.push(entry.recentRequests);
      }
    });

    const providerRows: ProviderTraffic[] = Array.from(accumulators.entries())
      .map(([id, accumulator]) => {
        const total = accumulator.success + accumulator.failure;
        return {
          id,
          credentials: accumulator.credentials,
          hasApiKeys: accumulator.hasApiKeys,
          success: accumulator.success,
          failure: accumulator.failure,
          total,
          successRate: total > 0 ? (accumulator.success / total) * 100 : null,
          buckets: mergeRecentRequestBucketGroups(accumulator.bucketGroups),
        };
      })
      .sort(
        (a, b) => b.total - a.total || b.credentials - a.credentials || a.id.localeCompare(b.id)
      );

    return {
      traffic: buildTrafficWindow(allBucketGroups),
      providers: providerRows,
    };
  }, [usageByProvider, authFiles]);

  const credentials = useMemo<CredentialHealth | null>(() => {
    if (!authFiles) return null;

    let disabled = 0;
    let unavailable = 0;

    authFiles.forEach((file) => {
      if (file.disabled) {
        disabled += 1;
      } else if (file.unavailable) {
        unavailable += 1;
      }
    });

    return {
      total: authFiles.length,
      active: authFiles.length - disabled - unavailable,
      disabled,
      unavailable,
    };
  }, [authFiles]);

  const counts = useMemo<DashboardCounts>(
    () => ({
      managementKeys: config ? (config.apiKeys?.length ?? 0) : null,
      providerKeys: providerKeyCounts
        ? Object.values(providerKeyCounts).reduce((sum, count) => sum + count, 0)
        : null,
    }),
    [config, providerKeyCounts]
  );

  return {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    credentials,
    updatedAt,
    sources: {
      traffic: { loading: usageLoading && updatedAt === null, error: null },
      authFiles: authFilesSource,
      config: configSource,
    },
    retryAuthFiles: loadAuthFiles,
    retryConfig: () => void loadConfig(true),
    refresh,
  };
}
