import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup } from '@/hooks/motion';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { Meter } from './components/Meter';
import { Sparkline } from './components/Sparkline';
import { ThroughputChart } from './components/ThroughputChart';
import {
  MIN_SAMPLE_REQUESTS,
  providerLabel,
  splitWindowMinutes,
  toneForSuccessRate,
  type MeterTone,
} from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';

/** KPI 卡左上角色签：有语义色调的卡用状态色，其余保持中性 */
const TILE_ACCENTS: Record<MeterTone, string> = {
  good: 'var(--viz-success)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure)',
  idle: 'var(--text-tertiary)',
};

/** 大数字：六位以内用千分位，再往上压缩，避免撑破排版 */
const formatHeadline = (value: number): string =>
  value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

type FleetSort = 'traffic' | 'rate';

interface StatTileProps {
  label: string;
  value: string;
  hint: ReactNode;
  tone?: MeterTone;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
}

function StatTile({ label, value, hint, tone, loading, error, onRetry, children }: StatTileProps) {
  const { t } = useTranslation();
  return (
    <article
      className={styles.statTile}
      style={
        {
          '--tile-accent': tone ? TILE_ACCENTS[tone] : 'var(--border-hover)',
        } as React.CSSProperties
      }
    >
      <span className={styles.statLabel}>{label}</span>
      {loading ? (
        <>
          <Skeleton height={30} width="55%" />
          <Skeleton height={12} width="80%" />
        </>
      ) : (
        <>
          <strong className={styles.statValue}>{error ? DASH : value}</strong>
          {!error && children}
          {error ? (
            <span className={styles.statError}>
              {error}
              {onRetry && (
                <Button variant="ghost" size="xs" shape="pill" onClick={onRetry}>
                  {t('common.retry')}
                </Button>
              )}
            </span>
          ) : (
            <span className={styles.statHint}>{hint}</span>
          )}
        </>
      )}
    </article>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);

  const {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    credentials,
    updatedAt,
    sources,
    retryAuthFiles,
    retryConfig,
    refresh,
  } = useDashboardOverview();

  const [refreshing, setRefreshing] = useState(false);
  const [fleetSort, setFleetSort] = useState<FleetSort>('traffic');
  const headerRef = useRevealGroup<HTMLElement>();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
  useHeaderRefresh(handleRefresh, connected);

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return DASH;
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const sparkPoints = useMemo(
    () => traffic.buckets.map((bucket) => bucket.success + bucket.failed),
    [traffic.buckets]
  );

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    if (raw === 'expiring-first') return t('basic_settings.routing_strategy_expiring_first');
    return raw;
  }, [config?.routingStrategy, t]);

  const unknownProviderLabel = t('dashboard.provider_unknown');
  const successRateTone = toneForSuccessRate(traffic.successRate, traffic.total);
  const lowVolume = traffic.total > 0 && traffic.total < MIN_SAMPLE_REQUESTS;

  const sortedProviders = useMemo(() => {
    if (fleetSort === 'traffic') return providers;
    return [...providers].sort(
      (a, b) => (a.successRate ?? 101) - (b.successRate ?? 101) || b.total - a.total
    );
  }, [providers, fleetSort]);

  /* ---------- 页头 meta ---------- */
  const connectionTone: PageHeaderMetaSegment['tone'] =
    connectionStatus === 'connected'
      ? 'ok'
      : connectionStatus === 'connecting'
        ? 'warning'
        : 'attention';
  const meta: PageHeaderMetaSegment[] = [];
  if (serverVersion) {
    meta.push({ key: 'version', text: `v${serverVersion.trim().replace(/^[vV]+/, '')}` });
  }
  meta.push({
    key: 'connection',
    tone: connectionTone,
    text: t(
      connectionStatus === 'connected'
        ? 'common.connected'
        : connectionStatus === 'connecting'
          ? 'common.connecting'
          : 'common.disconnected'
    ),
  });
  if (connected && updatedAt !== null) {
    meta.push({
      key: 'updated',
      tone: 'quiet',
      text: t('dashboard.meta_updated', {
        time: new Date(updatedAt).toLocaleTimeString(i18n.language, { hour12: false }),
      }),
    });
    meta.push({ key: 'live', tone: 'ok', text: t('dashboard.meta_live') });
  }

  /* ---------- 关注条 / 首次使用卡 ---------- */
  const firstRun =
    connected && credentials !== null && credentials.total === 0 && counts.providerKeys === 0;

  const attentionItems: Array<{ key: string; text: string; to: string }> = [];
  if (!connected) {
    attentionItems.push({
      key: 'offline',
      text: t('dashboard.attention_disconnected'),
      to: '/system',
    });
  }
  if (credentials && credentials.unavailable > 0) {
    attentionItems.push({
      key: 'unavailable',
      text: t('dashboard.attention_unavailable', { count: credentials.unavailable }),
      to: '/auth-files',
    });
  }
  providers.forEach((provider) => {
    const tone = toneForSuccessRate(provider.successRate, provider.total);
    if (tone !== 'warning' && tone !== 'critical') return;
    attentionItems.push({
      key: `provider:${provider.id}`,
      text: t('dashboard.attention_provider_rate', {
        provider: providerLabel(provider.id, unknownProviderLabel),
        rate: formatPercent(provider.successRate ?? 0),
      }),
      to: '/logs',
    });
  });

  /* ---------- 运行参数 ---------- */
  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.runtime_access_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];

  const runtimeToggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  const offlineNote = <p className={styles.emptyNote}>{t('dashboard.disconnected_note')}</p>;
  const trafficLoading = connected && sources.traffic.loading;
  const authFilesLoading = connected && sources.authFiles.loading && credentials === null;
  const configLoading = connected && sources.config.loading && !config;

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nav.dashboard')}
        meta={meta}
        revealRef={headerRef}
        actions={
          <>
            <Button
              variant="secondary"
              shape="pill"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={!connected || refreshing}
              aria-label={t('common.refresh')}
            >
              <IconRefreshCw size={14} className={refreshing ? 'spinning' : undefined} />
              {t('common.refresh')}
            </Button>
            <Button shape="pill" onClick={() => navigate('/ai-providers')}>
              {t('dashboard.cta_manage_providers')}
            </Button>
          </>
        }
      />

      {/* ---------- 关注条 / 首次使用 ---------- */}
      {firstRun ? (
        <section className={styles.firstRun} aria-label={t('dashboard.first_run_title')}>
          <strong className={styles.firstRunTitle}>{t('dashboard.first_run_title')}</strong>
          <span className={styles.firstRunHint}>{t('dashboard.first_run_hint')}</span>
          <div className={styles.firstRunLinks}>
            <Link to="/quick-start" className={styles.firstRunLink}>
              {t('nav.quick_start')} →
            </Link>
            <Link to="/ai-providers" className={styles.firstRunLink}>
              {t('nav.ai_providers')} →
            </Link>
            <Link to="/auth-files" className={styles.firstRunLink}>
              {t('nav.auth_files')} →
            </Link>
          </div>
        </section>
      ) : attentionItems.length > 0 ? (
        <ul className={styles.attention} aria-label={t('dashboard.attention_aria')}>
          {attentionItems.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className={styles.attentionItem}>
                {item.text} →
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---------- KPI ---------- */}
      <section className={styles.statsRow} aria-label={t('dashboard.stats_aria')}>
        <StatTile
          label={t('dashboard.stat_requests')}
          value={connected ? formatHeadline(traffic.total) : DASH}
          loading={trafficLoading}
          hint={
            connected
              ? t('dashboard.stat_requests_hint', {
                  success: traffic.totalSuccess.toLocaleString(),
                  failed: traffic.totalFailure.toLocaleString(),
                  window: windowLabel,
                })
              : t('dashboard.disconnected_hint')
          }
        >
          {connected && traffic.total > 0 && (
            <>
              <div className={styles.splitBar} aria-hidden="true">
                {traffic.totalSuccess > 0 && (
                  <span
                    className={`${styles.splitSegment} ${styles.splitSuccess}`}
                    style={{ flexGrow: traffic.totalSuccess }}
                  />
                )}
                {traffic.totalFailure > 0 && (
                  <span
                    className={`${styles.splitSegment} ${styles.splitFailure}`}
                    style={{ flexGrow: traffic.totalFailure }}
                  />
                )}
              </div>
              <Sparkline
                points={sparkPoints}
                color="var(--viz-success)"
                ariaLabel={t('dashboard.stat_requests_spark_label', { window: windowLabel })}
                className={styles.statSpark}
              />
            </>
          )}
        </StatTile>

        <StatTile
          label={t('dashboard.success_rate')}
          value={
            connected && traffic.successRate !== null ? formatPercent(traffic.successRate) : DASH
          }
          tone={connected ? successRateTone : undefined}
          loading={trafficLoading}
          hint={
            !connected
              ? t('dashboard.disconnected_hint')
              : lowVolume
                ? t('dashboard.stat_success_low_volume', { total: traffic.total.toLocaleString() })
                : t('dashboard.stat_success_hint', { total: traffic.total.toLocaleString() })
          }
        >
          {connected && traffic.successRate !== null && (
            <Meter
              value={traffic.successRate}
              tone={successRateTone}
              ariaLabel={t('dashboard.success_rate')}
              className={styles.statMeter}
            />
          )}
        </StatTile>

        <StatTile
          label={t('dashboard.stat_auth_files')}
          value={connected && credentials ? credentials.total.toLocaleString() : DASH}
          loading={authFilesLoading}
          error={connected && sources.authFiles.error ? t('dashboard.stat_auth_files_error') : null}
          onRetry={() => void retryAuthFiles()}
          hint={
            !connected
              ? t('dashboard.disconnected_hint')
              : credentials && credentials.total > 0
                ? t('dashboard.stat_auth_files_hint', {
                    active: credentials.active,
                    unavailable: credentials.unavailable,
                    disabled: credentials.disabled,
                  })
                : t('dashboard.stat_auth_files_empty')
          }
        >
          {connected && credentials && credentials.total > 0 && (
            <div className={styles.healthBar} aria-hidden="true">
              {credentials.active > 0 && (
                <span
                  className={`${styles.healthSegment} ${styles.healthActive}`}
                  style={{ flexGrow: credentials.active }}
                />
              )}
              {credentials.unavailable > 0 && (
                <span
                  className={`${styles.healthSegment} ${styles.healthUnavailable}`}
                  style={{ flexGrow: credentials.unavailable }}
                />
              )}
              {credentials.disabled > 0 && (
                <span
                  className={`${styles.healthSegment} ${styles.healthDisabled}`}
                  style={{ flexGrow: credentials.disabled }}
                />
              )}
            </div>
          )}
        </StatTile>

        <StatTile
          label={t('dashboard.stat_provider_keys')}
          value={
            connected && counts.providerKeys !== null ? counts.providerKeys.toLocaleString() : DASH
          }
          loading={configLoading}
          error={connected && sources.config.error ? t('dashboard.runtime_error') : null}
          onRetry={retryConfig}
          hint={
            connected ? t('dashboard.stat_provider_keys_hint') : t('dashboard.disconnected_hint')
          }
        />
      </section>

      {/* ---------- Traffic ---------- */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('dashboard.traffic_title')}</h2>
          <p className={styles.sectionDescription}>
            {t('dashboard.traffic_description', { window: windowLabel })}
          </p>
        </header>
        <div className={styles.panel}>
          {!connected ? (
            offlineNote
          ) : trafficLoading ? (
            <Skeleton height={208} />
          ) : (
            <ThroughputChart traffic={traffic} />
          )}
        </div>
      </section>

      {/* ---------- Providers ---------- */}
      <section className={styles.section}>
        <header className={`${styles.sectionHead} ${styles.sectionHeadRow}`}>
          <div>
            <h2 className={styles.sectionTitle}>{t('dashboard.fleet_title')}</h2>
            <p className={styles.sectionDescription}>{t('dashboard.fleet_description')}</p>
          </div>
          {connected && providers.length > 1 && (
            <div
              className={styles.sortToggle}
              role="group"
              aria-label={t('dashboard.fleet_sort_label')}
            >
              {(['traffic', 'rate'] as const).map((option) => (
                <Button
                  key={option}
                  variant={fleetSort === option ? 'secondary' : 'ghost'}
                  size="xs"
                  shape="pill"
                  aria-pressed={fleetSort === option}
                  onClick={() => setFleetSort(option)}
                >
                  {t(
                    option === 'traffic'
                      ? 'dashboard.fleet_sort_traffic'
                      : 'dashboard.fleet_sort_rate'
                  )}
                </Button>
              ))}
            </div>
          )}
        </header>
        <div className={styles.panel}>
          {!connected ? (
            offlineNote
          ) : trafficLoading || authFilesLoading ? (
            <div className={styles.skeletonRows}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : providers.length === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.fleet_empty')}</p>
          ) : (
            <ul className={styles.fleetList}>
              {sortedProviders.map((provider) => {
                const name = providerLabel(provider.id, unknownProviderLabel);
                const tone = toneForSuccessRate(provider.successRate, provider.total);
                return (
                  <li key={provider.id}>
                    <Link
                      to={provider.hasApiKeys ? '/ai-providers' : '/quota'}
                      className={styles.fleetRow}
                    >
                      <div className={styles.fleetIdentity}>
                        <span className={styles.fleetName}>{name}</span>
                        <span className={styles.fleetMeta}>
                          {t('dashboard.fleet_credentials', { value: provider.credentials })}
                        </span>
                      </div>
                      <Sparkline
                        points={provider.buckets.map((bucket) => bucket.success + bucket.failed)}
                        ariaLabel={t('dashboard.fleet_spark_label', { provider: name })}
                        className={styles.fleetSpark}
                      />
                      <div className={styles.fleetCounts}>
                        <span className={styles.fleetOk}>
                          {t('dashboard.fleet_ok', { count: provider.success })}
                        </span>
                        <span
                          className={provider.failure > 0 ? styles.fleetFailed : styles.fleetOk}
                        >
                          {t('dashboard.fleet_failed', { count: provider.failure })}
                        </span>
                      </div>
                      <div className={styles.fleetRate}>
                        <span className={styles.fleetRateValue}>
                          {provider.successRate === null
                            ? DASH
                            : formatPercent(provider.successRate)}
                        </span>
                        <Meter
                          value={provider.successRate}
                          tone={tone}
                          ariaLabel={t('dashboard.success_rate')}
                          className={styles.fleetMeter}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- Runtime ---------- */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('dashboard.runtime_title')}</h2>
          <p className={styles.sectionDescription}>{t('dashboard.runtime_description')}</p>
        </header>
        <div className={styles.panel}>
          {!connected ? (
            offlineNote
          ) : sources.config.error ? (
            <ErrorBanner message={t('dashboard.runtime_error')} onRetry={retryConfig} />
          ) : configLoading ? (
            <div className={styles.skeletonRows}>
              <Skeleton height={18} />
              <Skeleton height={18} />
              <Skeleton height={18} />
            </div>
          ) : (
            <>
              <dl className={styles.specList}>
                {runtimeRows.map((row) => (
                  <div key={row.label} className={styles.specRow}>
                    <dt className={styles.specLabel}>{row.label}</dt>
                    <dd className={`${styles.specValue} ${row.mono ? styles.specMono : ''}`}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {runtimeToggles.length > 0 && (
                <ul className={styles.toggleList}>
                  {runtimeToggles.map((toggle) => (
                    <li
                      key={toggle.label}
                      className={`${styles.togglePill} ${toggle.on ? styles.toggleOn : styles.toggleOff}`}
                    >
                      {toggle.label}
                      <b>{toggle.on ? t('common.yes') : t('common.no')}</b>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/config" className={styles.panelLink}>
                {t('dashboard.runtime_link')} →
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
