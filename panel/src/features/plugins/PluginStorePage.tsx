import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  IconDownload,
  IconGithub,
  IconInfo,
  IconRefreshCw,
  IconSettings,
  IconShield,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useRevealGroup } from '@/hooks/motion';
import { pluginStoreApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginStoreEntry, PluginStoreResponse } from '@/types';
import {
  buildRepositoryURL,
  isDefaultPluginStoreSource,
  isOfficialPlugin,
  notifyPluginResourcesChanged,
  resolvePluginAssetURL,
} from './pluginResources';
import { waitForPluginStoreState } from './pluginPolling';
import { usePluginRestartStore } from './pluginRestartStore';
import { formatPluginVersion, pluginVersionMatches } from './pluginVersion';
import { PluginInstallGateModal } from './components/PluginInstallGateModal';
import { PluginInstallOptionsModal } from './components/PluginInstallOptionsModal';
import { PluginLogo } from './components/PluginLogo';
import { PluginNotice } from './components/PluginNotice';
import { PluginStoreDetailsSheet } from './components/PluginStoreDetailsSheet';
import { PluginSummaryCards, type PluginSummaryCard } from './components/PluginSummaryCards';
import styles from './PluginStorePage.module.scss';

type StoreStatusFilter = 'all' | 'installed' | 'notInstalled' | 'updates';
type StoreSort = 'name' | 'installed' | 'updates';

interface StoreLoadError {
  kind: 'unsupported' | 'registry' | 'generic';
  message: string;
}

const STATUS_FILTERS: StoreStatusFilter[] = ['all', 'installed', 'notInstalled', 'updates'];
const SORT_OPTIONS: StoreSort[] = ['name', 'installed', 'updates'];
const SKELETON_CARDS = 6;
const SECURITY_NOTE_STORAGE_KEY = 'cli-proxy-plugin-store-security-note';

const parseStatusFilter = (value: string | null): StoreStatusFilter =>
  value && (STATUS_FILTERS as string[]).includes(value) ? (value as StoreStatusFilter) : 'all';

const getErrorStatus = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

const getErrorDetailMessage = (error: unknown): string => {
  if (!isRecord(error) || !isRecord(error.details)) return '';
  const message = error.details.message;
  return typeof message === 'string' ? message.trim() : '';
};

const getStoreEntryTitle = (entry: PluginStoreEntry) => entry.name || entry.id;
const getStoreEntryKey = (entry: PluginStoreEntry) => entry.storeId || entry.id;

const matchesStatusFilter = (entry: PluginStoreEntry, filter: StoreStatusFilter) => {
  switch (filter) {
    case 'installed':
      return entry.installed;
    case 'notInstalled':
      return !entry.installed;
    case 'updates':
      return entry.installed && entry.updateAvailable;
    default:
      return true;
  }
};

export function PluginStorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const restartRequiredIDs = usePluginRestartStore((state) => state.ids);
  const markRestartRequired = usePluginRestartStore((state) => state.markRestartRequired);
  const clearRestartRequired = usePluginRestartStore((state) => state.clearRestartRequired);
  const headerRef = useRevealGroup<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<PluginStoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StoreLoadError | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StoreStatusFilter>(() =>
    parseStatusFilter(searchParams.get('filter'))
  );
  const [sort, setSort] = useState<StoreSort>('name');
  const [sourceFilter, setSourceFilter] = useState('');
  const [installingKey, setInstallingKey] = useState('');
  const [securityNoteDismissed, setSecurityNoteDismissed] = useLocalStorage(
    SECURITY_NOTE_STORAGE_KEY,
    false
  );
  const [securityNoteExpanded, setSecurityNoteExpanded] = useState(false);
  const [detailsEntry, setDetailsEntry] = useState<PluginStoreEntry | null>(null);

  const [gateOpen, setGateOpen] = useState(false);
  const [gateEntry, setGateEntry] = useState<PluginStoreEntry | null>(null);
  const [gateIsUpdate, setGateIsUpdate] = useState(false);
  const [gateRequestedVersion, setGateRequestedVersion] = useState('');

  const [installOptionsEntry, setInstallOptionsEntry] = useState<PluginStoreEntry | null>(null);
  const [installOptionsIsUpdate, setInstallOptionsIsUpdate] = useState(false);
  const [installVersion, setInstallVersion] = useState('');

  const connected = connectionStatus === 'connected';

  const loadStore = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError({ kind: 'generic', message: t('notification.connection_required') });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const store = await pluginStoreApi.list();
      setData(store);
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      if (status === 404) {
        setError({ kind: 'unsupported', message: t('plugin_store.unsupported_backend') });
      } else if (status === 502) {
        const detail = getErrorDetailMessage(err);
        setError({
          kind: 'registry',
          message: detail
            ? `${t('plugin_store.registry_failed')}: ${detail}`
            : t('plugin_store.registry_failed'),
        });
      } else {
        setError({
          kind: 'generic',
          message: getErrorMessage(err, t('plugin_store.load_failed')),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(loadStore, connected);

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const plugins = useMemo(() => data?.plugins ?? [], [data?.plugins]);

  const stats = useMemo(() => {
    const installed = plugins.filter((plugin) => plugin.installed).length;
    const updates = plugins.filter((plugin) => plugin.installed && plugin.updateAvailable).length;
    return { total: plugins.length, installed, notInstalled: plugins.length - installed, updates };
  }, [plugins]);

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    plugins.forEach((entry) => {
      const id = entry.sourceId || '';
      if (map.has(id)) return;
      map.set(
        id,
        isDefaultPluginStoreSource(entry)
          ? t('plugin_store.cli_proxy_api_source')
          : entry.sourceName || entry.sourceUrl || id
      );
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [plugins, t]);

  const visiblePlugins = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const list = plugins.filter((entry) => {
      if (!matchesStatusFilter(entry, statusFilter)) return false;
      if (sourceFilter && (entry.sourceId || '') !== sourceFilter) return false;
      if (!query) return true;
      const haystack = [
        entry.id,
        entry.name,
        entry.description,
        entry.author,
        entry.repository,
        entry.sourceName,
        ...entry.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
    const byName = (a: PluginStoreEntry, b: PluginStoreEntry) =>
      getStoreEntryTitle(a).localeCompare(getStoreEntryTitle(b));
    if (sort === 'installed') {
      return list.sort((a, b) => Number(b.installed) - Number(a.installed) || byName(a, b));
    }
    if (sort === 'updates') {
      return list.sort(
        (a, b) =>
          Number(b.installed && b.updateAvailable) - Number(a.installed && a.updateAvailable) ||
          byName(a, b)
      );
    }
    return list.sort(byName);
  }, [filter, plugins, sort, sourceFilter, statusFilter]);

  const restartNames = restartRequiredIDs.map((id) => {
    const entry = plugins.find((item) => item.id === id);
    return entry ? getStoreEntryTitle(entry) : id;
  });

  /* ---------- install flow ---------- */

  const runInstall = useCallback(
    async (entry: PluginStoreEntry, isUpdate: boolean, requestedVersion = '') => {
      const entryKey = getStoreEntryKey(entry);
      const failedKey = isUpdate ? 'plugin_store.update_failed' : 'plugin_store.install_failed';
      const successKey = isUpdate ? 'plugin_store.update_success' : 'plugin_store.install_success';
      const version = requestedVersion.trim();
      setInstallingKey(entryKey);
      try {
        const result = await pluginStoreApi.install(entry.id, {
          sourceId: entry.sourceId || undefined,
          version: version || undefined,
        });
        clearConfigCache();
        const sourceId = result.sourceId || entry.sourceId;
        const installedState = await waitForPluginStoreState(
          entry.id,
          sourceId,
          (plugin) =>
            plugin.installed &&
            plugin.configured &&
            (!version || pluginVersionMatches(plugin.installedVersion, version))
        );
        setData(installedState.response);
        if (
          installedState.timedOut ||
          !installedState.plugin?.installed ||
          !installedState.plugin.configured
        ) {
          showNotification(t('plugin_store.status_pending'), 'warning');
          return;
        }

        if (result.restartRequired) {
          markRestartRequired(entry.id);
          showNotification(t(successKey), 'success');
          showNotification(t('plugin_store.restart_required_notice'), 'warning');
          return;
        }

        if (!installedState.response.pluginsEnabled) {
          showNotification(t(successKey), 'success');
          showNotification(t('plugin_store.global_disabled_hint'), 'warning');
          return;
        }

        if (installedState.plugin.enabled) {
          const registeredState = await waitForPluginStoreState(
            entry.id,
            sourceId,
            (plugin) => plugin.registered && plugin.effectiveEnabled
          );
          setData(registeredState.response);
          if (
            registeredState.timedOut ||
            !registeredState.plugin?.registered ||
            !registeredState.plugin.effectiveEnabled
          ) {
            showNotification(t('plugin_store.registration_pending'), 'warning');
            return;
          }
          notifyPluginResourcesChanged();
        }

        showNotification(t(successKey), 'success');
      } catch (err: unknown) {
        showNotification(`${t(failedKey)}: ${getErrorMessage(err, t(failedKey))}`, 'error');
        throw err;
      } finally {
        setInstallingKey('');
      }
    },
    [clearConfigCache, markRestartRequired, showNotification, t]
  );

  const handleInstall = (entry: PluginStoreEntry) => {
    setInstallOptionsEntry(entry);
    setInstallOptionsIsUpdate(entry.installed && entry.updateAvailable);
    setInstallVersion('');
  };

  const handleInstallOptionsClose = useCallback(() => {
    if (installingKey) return;
    setInstallOptionsEntry(null);
    setInstallVersion('');
  }, [installingKey]);

  const handleInstallOptionsConfirm = useCallback(async () => {
    if (!installOptionsEntry) return;
    const requestedVersion = installVersion.trim();

    // Third-party plugins go through the risk gate first.
    if (!isOfficialPlugin(installOptionsEntry)) {
      setGateEntry(installOptionsEntry);
      setGateIsUpdate(installOptionsIsUpdate);
      setGateRequestedVersion(requestedVersion);
      setGateOpen(true);
      setInstallOptionsEntry(null);
      setInstallVersion('');
      return;
    }

    try {
      await runInstall(installOptionsEntry, installOptionsIsUpdate, requestedVersion);
      setInstallOptionsEntry(null);
      setInstallVersion('');
    } catch {
      // runInstall already surfaced a notification; keep the modal open for correction.
    }
  }, [installOptionsEntry, installOptionsIsUpdate, installVersion, runInstall]);

  const handleGateConfirm = useCallback(async () => {
    if (!gateEntry) return;
    await runInstall(gateEntry, gateIsUpdate, gateRequestedVersion);
    setGateOpen(false);
    setGateRequestedVersion('');
  }, [gateEntry, gateIsUpdate, gateRequestedVersion, runInstall]);

  const handleGateClose = useCallback(() => {
    setGateOpen(false);
    setGateRequestedVersion('');
  }, []);

  const gateTargetVersion = gateEntry
    ? formatPluginVersion(gateRequestedVersion || gateEntry.version)
    : '';

  /* ---------- view ---------- */

  const meta: PageHeaderMetaSegment[] = data
    ? [
        { key: 'available', text: t('plugin_store.meta_available', { count: stats.total }) },
        {
          key: 'installed',
          text: t('plugin_store.meta_installed', { count: stats.installed }),
          tone: stats.installed > 0 ? 'ok' : 'quiet',
        },
      ]
    : [];
  if (data && stats.updates > 0) {
    meta.push({
      key: 'updates',
      text: t('plugin_store.meta_updates', { count: stats.updates }),
      tone: 'warning',
    });
  }

  const toggleStatusFilter = (next: StoreStatusFilter) =>
    setStatusFilter((current) => (current === next && next !== 'all' ? 'all' : next));

  const filterCounts: Record<StoreStatusFilter, number> = {
    all: stats.total,
    installed: stats.installed,
    notInstalled: stats.notInstalled,
    updates: stats.updates,
  };

  const summaryCards: PluginSummaryCard[] = [
    {
      key: 'all',
      label: t('plugin_store.filter_all'),
      count: stats.total,
      tone: 'accent',
      active: statusFilter === 'all',
      onClick: () => toggleStatusFilter('all'),
    },
    {
      key: 'installed',
      label: t('plugin_store.filter_installed'),
      count: stats.installed,
      tone: 'ok',
      active: statusFilter === 'installed',
      onClick: () => toggleStatusFilter('installed'),
    },
    {
      key: 'notInstalled',
      label: t('plugin_store.filter_not_installed'),
      count: stats.notInstalled,
      tone: 'muted',
      active: statusFilter === 'notInstalled',
      onClick: () => toggleStatusFilter('notInstalled'),
    },
    {
      key: 'updates',
      label: t('plugin_store.filter_updates'),
      count: stats.updates,
      tone: stats.updates > 0 ? 'warning' : 'muted',
      active: statusFilter === 'updates',
      onClick: () => toggleStatusFilter('updates'),
    },
  ];

  const hasActiveFilters =
    Boolean(filter.trim()) || statusFilter !== 'all' || Boolean(sourceFilter);
  const showAlerts =
    Boolean(error) ||
    Boolean(data?.sourceErrors.length) ||
    (data ? !data.pluginsEnabled : false) ||
    restartNames.length > 0;

  const renderCard = (entry: PluginStoreEntry) => {
    const entryKey = getStoreEntryKey(entry);
    const title = getStoreEntryTitle(entry);
    const logo = resolvePluginAssetURL(entry.logo, apiBase);
    const repositoryURL = buildRepositoryURL(entry.repository);
    const isUpdate = entry.installed && entry.updateAvailable;
    const isOfficial = isOfficialPlugin(entry);
    const isInstalling = installingKey === entryKey;
    const missingAuth = entry.authRequired && !entry.authConfigured;
    const actionDisabled = !connected || missingAuth || (Boolean(installingKey) && !isInstalling);
    const versionText = isUpdate
      ? t('plugin_store.version_arrow', {
          from: entry.installedVersion.replace(/^v/i, ''),
          to: entry.version.replace(/^v/i, ''),
        })
      : entry.installed && entry.installedVersion
        ? formatPluginVersion(entry.installedVersion)
        : entry.version
          ? formatPluginVersion(entry.version)
          : '';

    return (
      <article key={entryKey} className={styles.card}>
        <div className={styles.cardHead}>
          <PluginLogo src={logo} size={36} />
          <div className={styles.cardTitleBlock}>
            <div className={styles.cardTitleLine}>
              <h2 className={styles.cardTitle}>{title}</h2>
              {isOfficial ? (
                <span className={styles.badgeOfficial}>
                  <IconShield size={11} aria-hidden="true" />
                  {t('plugin_store.badge_official')}
                </span>
              ) : (
                <span className={styles.badgeThirdParty}>{t('plugin_store.badge_untrusted')}</span>
              )}
            </div>
            <div className={styles.cardMeta}>
              {versionText ? <span>{versionText}</span> : null}
              {entry.author ? <span>{entry.author}</span> : null}
            </div>
          </div>
          {isUpdate ? (
            <span className={`${styles.stateChip} ${styles.stateUpdate}`}>
              {t('plugin_store.badge_update')}
            </span>
          ) : entry.installed ? (
            <span className={`${styles.stateChip} ${styles.stateInstalled}`}>
              {t('plugin_store.badge_installed')}
            </span>
          ) : null}
        </div>

        {entry.description ? <p className={styles.cardDesc}>{entry.description}</p> : null}

        {missingAuth ? (
          <p className={styles.authLine}>{t('plugin_store.auth_required_hint')}</p>
        ) : null}

        <div className={styles.cardFooter}>
          <div className={styles.cardActions}>
            {!entry.installed || isUpdate ? (
              <Button
                size="sm"
                onClick={() => handleInstall(entry)}
                disabled={actionDisabled}
                loading={isInstalling}
                aria-label={t(isUpdate ? 'plugin_store.update_aria' : 'plugin_store.install_aria', {
                  name: title,
                })}
              >
                {isUpdate ? <IconRefreshCw size={14} /> : <IconDownload size={14} />}
                {t(isUpdate ? 'plugin_store.update' : 'plugin_store.install')}
              </Button>
            ) : null}
            {entry.installed ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/plugins?focus=${encodeURIComponent(entry.id)}`)}
                aria-label={t('plugin_store.manage_aria', { name: title })}
              >
                <IconSettings size={14} />
                {t('plugin_store.manage')}
              </Button>
            ) : null}
          </div>
          <div className={styles.cardLinks}>
            <button
              type="button"
              className={styles.iconLink}
              onClick={() => setDetailsEntry(entry)}
              title={t('plugin_store.details_action')}
              aria-label={t('plugin_store.details_aria', { name: title })}
            >
              <IconInfo size={15} />
            </button>
            {repositoryURL ? (
              <a
                className={styles.iconLink}
                href={repositoryURL}
                target="_blank"
                rel="noreferrer"
                title={t('plugin_store.open_repository')}
                aria-label={t('plugin_store.open_repository_aria', { name: title })}
              >
                <IconGithub size={15} />
              </a>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader
        revealRef={headerRef}
        title={t('plugin_store.title')}
        meta={meta}
        description={data ? undefined : t('plugin_store.description')}
        actions={
          <Button shape="pill" onClick={loadStore} disabled={!connected || loading}>
            <IconRefreshCw size={14} className={loading ? 'spinning' : undefined} />
            {t('plugin_store.refresh')}
          </Button>
        }
      />

      {!securityNoteDismissed ? (
        <PluginNotice
          tone="info"
          className={styles.securityNote}
          action={
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSecurityNoteExpanded((value) => !value)}
                aria-expanded={securityNoteExpanded}
              >
                {t(
                  securityNoteExpanded ? 'plugin_store.security_less' : 'plugin_store.security_more'
                )}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setSecurityNoteDismissed(true)}>
                {t('plugin_store.security_dismiss')}
              </Button>
            </>
          }
        >
          <strong>{t('plugin_store.security_banner_title')}</strong>
          {securityNoteExpanded ? <p>{t('plugin_store.security_banner_text')}</p> : null}
        </PluginNotice>
      ) : null}

      {showAlerts ? (
        <div className={styles.alerts}>
          {error ? (
            <ErrorBanner
              message={error.message}
              onRetry={error.kind !== 'unsupported' && connected ? loadStore : undefined}
              retryLabel={t('plugin_store.retry')}
              retrying={loading}
            />
          ) : null}
          {data?.sourceErrors.length ? (
            <PluginNotice>
              <details>
                <summary>
                  {t('plugin_store.source_errors_summary', { count: data.sourceErrors.length })}
                </summary>
                <ul>
                  {data.sourceErrors.map((sourceError, index) => (
                    <li key={`${sourceError.sourceId}-${sourceError.sourceUrl}-${index}`}>
                      <span>
                        {sourceError.sourceName || sourceError.sourceUrl || sourceError.sourceId}
                      </span>
                      {sourceError.message ? <small>{sourceError.message}</small> : null}
                    </li>
                  ))}
                </ul>
              </details>
            </PluginNotice>
          ) : null}
          {data && !data.pluginsEnabled ? (
            <PluginNotice>{t('plugin_store.global_disabled_hint')}</PluginNotice>
          ) : null}
          {restartNames.length > 0 ? (
            <PluginNotice
              action={
                <Button variant="ghost" size="xs" onClick={clearRestartRequired}>
                  {t('plugin_store.restart_dismiss')}
                </Button>
              }
            >
              {t('plugin_store.restart_required_banner', { plugins: restartNames.join(', ') })}
            </PluginNotice>
          ) : null}
        </div>
      ) : null}

      {data ? (
        <PluginSummaryCards cards={summaryCards} ariaLabel={t('plugin_store.summary_label')} />
      ) : null}

      <div className={styles.toolbar}>
        <SearchField
          ref={searchInputRef}
          value={filter}
          onChange={setFilter}
          placeholder={t('plugin_store.search_placeholder')}
          ariaLabel={t('plugin_store.search_label')}
          disabled={loading && !data}
        />
        <Select
          value={sort}
          options={SORT_OPTIONS.map((value) => ({
            value,
            label: t(`plugin_store.sort_${value}`),
          }))}
          onChange={(value) => setSort(value as StoreSort)}
          ariaLabel={t('plugin_store.sort_label')}
          size="sm"
          variant="quiet"
          fullWidth={false}
        />
        {sources.length > 1 ? (
          <Select
            value={sourceFilter}
            options={[{ value: '', label: t('plugin_store.source_all') }, ...sources]}
            onChange={setSourceFilter}
            ariaLabel={t('plugin_store.source_label')}
            size="sm"
            variant="quiet"
            fullWidth={false}
          />
        ) : null}
        <div
          className={styles.filterChips}
          role="group"
          aria-label={t('plugin_store.filter_label')}
        >
          {STATUS_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.filterChip} ${statusFilter === key ? styles.filterChipActive : ''}`}
              onClick={() => setStatusFilter(key)}
              aria-pressed={statusFilter === key}
            >
              {t(
                key === 'notInstalled'
                  ? 'plugin_store.filter_not_installed'
                  : `plugin_store.filter_${key}`
              )}
              <span className={styles.filterChipCount}>{filterCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className={styles.cardGrid} aria-busy="true">
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <div key={index} className={styles.skeletonCard}>
              <div className={styles.skeletonHead}>
                <Skeleton width={36} height={36} rounded={10} />
                <div className={styles.skeletonText}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="35%" height={10} />
                </div>
              </div>
              <Skeleton height={12} />
              <Skeleton width="80%" height={12} />
            </div>
          ))}
        </div>
      ) : visiblePlugins.length === 0 ? (
        error ? null : stats.total === 0 ? (
          <EmptyState
            title={t('plugin_store.no_plugins')}
            description={t('plugin_store.no_plugins_desc')}
            action={
              <Button variant="secondary" size="sm" onClick={loadStore} disabled={!connected}>
                <IconRefreshCw size={16} />
                {t('plugin_store.refresh')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('plugin_store.no_matches')}
            description={t('plugin_store.no_matches_desc')}
            action={
              hasActiveFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFilter('');
                    setStatusFilter('all');
                    setSourceFilter('');
                    searchInputRef.current?.focus();
                  }}
                >
                  {t('plugin_store.clear_filters')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className={styles.cardGrid}>{visiblePlugins.map(renderCard)}</div>
      )}

      {data ? (
        <p className={styles.footerLine}>
          {t('plugin_store.plugins_dir')}: <code>{data.pluginsDir || 'plugins'}</code>
        </p>
      ) : null}

      <PluginStoreDetailsSheet entry={detailsEntry} onClose={() => setDetailsEntry(null)} />

      <PluginInstallGateModal
        open={gateOpen}
        entry={gateEntry}
        isUpdate={gateIsUpdate}
        targetVersion={gateTargetVersion}
        installing={gateEntry ? installingKey === getStoreEntryKey(gateEntry) : false}
        onClose={handleGateClose}
        onConfirm={handleGateConfirm}
      />
      {installOptionsEntry ? (
        <PluginInstallOptionsModal
          key={getStoreEntryKey(installOptionsEntry)}
          entry={installOptionsEntry}
          isUpdate={installOptionsIsUpdate}
          version={installVersion}
          installing={installingKey === getStoreEntryKey(installOptionsEntry)}
          onVersionChange={setInstallVersion}
          onClose={handleInstallOptionsClose}
          onConfirm={handleInstallOptionsConfirm}
        />
      ) : null}
    </div>
  );
}
