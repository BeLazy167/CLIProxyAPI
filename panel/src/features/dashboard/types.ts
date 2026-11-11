import type { RecentRequestBucket } from '@/utils/recentRequests';

/** 每个统计桶覆盖的分钟数（后端固定为 10 分钟 × 20 桶） */
export const TRAFFIC_BUCKET_MINUTES = 10;

/** 聚合后的整体流量窗口 */
export interface TrafficWindow {
  buckets: RecentRequestBucket[];
  totalSuccess: number;
  totalFailure: number;
  total: number;
  /** 0–100；窗口内无请求时为 null */
  successRate: number | null;
  /** 单桶最大请求数，用于图表纵轴 */
  peakTotal: number;
  /** 峰值所在桶下标，-1 表示无数据 */
  peakIndex: number;
  /** 窗口跨度（分钟） */
  windowMinutes: number;
}

/** 单个供应商的流量切片 */
export interface ProviderTraffic {
  id: string;
  credentials: number;
  /** 有配置内联 API Key 时链到 AI Providers，否则链到额度页 */
  hasApiKeys: boolean;
  success: number;
  failure: number;
  total: number;
  successRate: number | null;
  buckets: RecentRequestBucket[];
}

/** 凭证健康度 */
export interface CredentialHealth {
  total: number;
  active: number;
  disabled: number;
  unavailable: number;
}

/** 顶部计数卡片的原始数值 */
export interface DashboardCounts {
  managementKeys: number | null;
  providerKeys: number | null;
}

/** 单个数据来源的加载状态；error 非空表示上次加载失败 */
export interface SourceState {
  loading: boolean;
  error: string | null;
}
