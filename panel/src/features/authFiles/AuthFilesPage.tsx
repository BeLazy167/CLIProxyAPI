import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealOnScroll } from '@/hooks/motion';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { copyToClipboard } from '@/utils/clipboard';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { displayNameTransform } from '@/features/quota/maskIdentity';
import { readShowEmailsPreference, writeShowEmailsPreference } from '@/features/quota/uiState';
import {
  QUOTA_PROVIDER_TYPES,
  countAuthFileStatuses,
  getAuthFileStatusKind,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileDeleteConfirmModal } from '@/features/authFiles/components/AuthFileDeleteConfirmModal';
import { AuthFileDetailsSheet } from '@/features/authFiles/components/AuthFileDetailsSheet';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { AuthFileRefreshResults } from '@/features/authFiles/components/AuthFileRefreshResults';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  AuthFilesLedger,
  AuthFilesLedgerSkeleton,
  type AuthFilesLedgerGroup,
} from '@/features/authFiles/components/AuthFilesLedger';
import { AuthFilesToolbar } from '@/features/authFiles/components/AuthFilesToolbar';
import { BatchActionBar } from '@/features/authFiles/components/BatchActionBar';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { RoutingRulesSection } from '@/features/authFiles/components/RoutingRulesSection';
import { VaultHeader } from '@/features/authFiles/components/VaultHeader';
import { VaultSummary } from '@/features/authFiles/components/VaultSummary';
import { invalidateAuthFileDerivedCaches } from '@/features/authFiles/cacheInvalidation';
import {
  buildWildcardSearch,
  matchesAuthFileSearch,
  sortAuthFiles,
} from '@/features/authFiles/logic';
import { resolveQuotaProviderType, worstQuotaPercent } from '@/features/authFiles/quotaSummary';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  isAuthFilesViewMode,
  normalizePersistedStatusFilterMode,
  readAuthFilesUiState,
  writeAuthFilesUiState,
  type AuthFilesStatusFilterMode,
  type AuthFilesSortMode,
  type AuthFilesViewMode,
} from '@/features/authFiles/uiState';
import type { AuthFileItem } from '@/types';
import { useAuthStore, useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import styles from './AuthFilesPage.module.scss';

const CARD_PAGE_SIZE = 12;
const SKELETON_CARD_COUNT = 6;
/** 首屏卡片级联入场总预算，与 useRevealGroup 同一 360ms 语汇。 */
const CARD_ENTRANCE_BUDGET_MS = 360;

const providerKeyOf = (file: AuthFileItem) =>
  normalizeProviderKey(String(file.type ?? file.provider ?? ''));

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();
  const now = useNow(isCurrentLayer);

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilterMode, setStatusFilterMode] = useState<AuthFilesStatusFilterMode>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<AuthFilesViewMode>('rows');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [routingRulesOpen, setRoutingRulesOpen] = useState(false);
  const [aliasViewMode, setAliasViewMode] = useState<'diagram' | 'list'>('list');
  const [showEmails, setShowEmails] = useState(() => readShowEmailsPreference() ?? false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);

  const displayNameFor = useMemo(() => displayNameTransform(showEmails), [showEmails]);
  const handleToggleEmails = useCallback(() => {
    setShowEmails((prev) => {
      const next = !prev;
      writeShowEmailsPreference(next);
      return next;
    });
  }, []);

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  } = useAuthFilesModels();

  const invalidateDerivedCaches = useCallback(
    (names?: string[]) => invalidateAuthFileDerivedCaches(invalidateModels, names),
    [invalidateModels]
  );

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    manualRefreshing,
    refreshingAllCredentials,
    refreshResults,
    closeRefreshResults,
    handleRefreshAllCredentials,
    cooldownResetting,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    deleteRequest,
    cancelDeleteRequest,
    confirmDeleteRequest,
    handleDownload,
    handleManualRefresh,
    handleCooldownReset,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({ onFilesMutated: invalidateDerivedCaches });

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode: aliasViewMode, files });

  const disableControls = connectionStatus !== 'connected' || refreshingAllCredentials;

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls,
    loadFiles,
    onFilesMutated: invalidateDerivedCaches,
  });

  /* ---------- 额度：订阅共享 store，行内只画最差窗口 ---------- */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);
  const quotaMaps = useMemo(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        xai: xaiQuota,
      }) as Record<QuotaProviderType, Record<string, QuotaCardState | undefined>>,
    [antigravityQuota, claudeQuota, codexQuota, devinQuota, kimiQuota, metaQuota, xaiQuota]
  );
  const quotaFor = useCallback(
    (file: AuthFileItem): QuotaCardState | undefined => {
      const type = resolveQuotaProviderType(file);
      return type ? quotaMaps[type][getQuotaCacheKey(file)] : undefined;
    },
    [quotaMaps]
  );
  const { batchLoading: quotaLoading, loadQuota } = useQuotaBatchLoader();
  const { refreshQuota } = useQuotaActions(disableControls);
  const handleLoadGroupQuota = useCallback(
    (groupFiles: AuthFileItem[]) => {
      const entries = groupFiles.flatMap((file) => {
        const type = resolveQuotaProviderType(file);
        return type ? [{ file, type }] : [];
      });
      void loadQuota(entries);
    },
    [loadQuota]
  );
  const handleRefreshQuota = useCallback(
    (file: AuthFileItem) => {
      const type = resolveQuotaProviderType(file);
      if (type) void refreshQuota(file, QUOTA_ADAPTERS[type]);
    },
    [refreshQuota]
  );

  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const activeQuotaFilter: AuthFileQuotaFilter =
    normalizedFilter === 'all' ? 'all' : quotaFilterType;

  /* ---------- uiState 水合与持久化 ---------- */

  useEffect(() => {
    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      const persistedStatusFilterMode = normalizePersistedStatusFilterMode(
        persisted.statusFilterMode
      );
      if (persistedStatusFilterMode) setStatusFilterMode(persistedStatusFilterMode);
      if (typeof persisted.search === 'string') setSearch(persisted.search);
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      if (isAuthFilesSortMode(persisted.sortMode)) setSortMode(persisted.sortMode);
      if (isAuthFilesViewMode(persisted.viewMode)) setViewMode(persisted.viewMode);
      if (typeof persisted.routingRulesOpen === 'boolean') {
        setRoutingRulesOpen(persisted.routingRulesOpen);
      }
    }
    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;
    writeAuthFilesUiState({
      filter,
      statusFilterMode,
      search,
      page,
      sortMode,
      viewMode,
      routingRulesOpen,
    });
  }, [
    filter,
    page,
    routingRulesOpen,
    search,
    sortMode,
    statusFilterMode,
    uiStateHydrated,
    viewMode,
  ]);

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
    },
    [sortMode]
  );

  const handleStatusFilterModeChange = useCallback((nextMode: AuthFilesStatusFilterMode) => {
    setStatusFilterMode(nextMode);
    setPage(1);
  }, []);

  /* ---------- 数据加载：首载前台（骨架屏），此后一律后台（不清空列表） ---------- */

  const initialLoadDoneRef = useRef(false);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles({ background: true }), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadFiles(initialLoadDoneRef.current ? { background: true } : undefined);
    initialLoadDoneRef.current = true;
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles({ background: true }).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  /* ---------- 过滤 / 排序 / 分组 / 分页 ---------- */

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      const type = providerKeyOf(file);
      if (type) types.add(type);
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingStatus = useMemo(
    () =>
      statusFilterMode === 'all'
        ? files
        : files.filter((file) => getAuthFileStatusKind(file, now) === statusFilterMode),
    [files, now, statusFilterMode]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatus.length };
    filesMatchingStatus.forEach((file) => {
      const type = providerKeyOf(file);
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatus]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  /** Provider + search scope, before the status filter: what the summary chips count. */
  const scopeFiles = useMemo(
    () =>
      files.filter((item) => {
        const matchType = normalizedFilter === 'all' || providerKeyOf(item) === normalizedFilter;
        return matchType && matchesAuthFileSearch(item, normalizedSearch, wildcardSearch);
      }),
    [files, normalizedFilter, normalizedSearch, wildcardSearch]
  );

  const statusCounts = useMemo(() => countAuthFileStatuses(scopeFiles, now), [now, scopeFiles]);

  const filtered = useMemo(
    () =>
      statusFilterMode === 'all'
        ? scopeFiles
        : scopeFiles.filter((file) => getAuthFileStatusKind(file, now) === statusFilterMode),
    [now, scopeFiles, statusFilterMode]
  );

  const sorted = useMemo(
    () =>
      sortAuthFiles(filtered, sortMode, {
        nowMs: now,
        quotaPercentFor: (file) => worstQuotaPercent(file, quotaFor(file)),
      }),
    [filtered, now, quotaFor, sortMode]
  );

  const groups = useMemo<AuthFilesLedgerGroup[]>(() => {
    const byProvider = new Map<string, AuthFileItem[]>();
    sorted.forEach((file) => {
      const key = providerKeyOf(file) || 'unknown';
      const bucket = byProvider.get(key);
      if (bucket) bucket.push(file);
      else byProvider.set(key, [file]);
    });
    return Array.from(byProvider, ([provider, groupFiles]) => ({ provider, files: groupFiles }));
  }, [sorted]);

  const isRowsView = viewMode === 'rows';
  const totalPages = Math.max(1, Math.ceil(sorted.length / CARD_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * CARD_PAGE_SIZE;
  const pageItems = useMemo(() => sorted.slice(start, start + CARD_PAGE_SIZE), [sorted, start]);
  const visibleItems = isRowsView ? sorted : pageItems;
  const selectableVisibleItems = useMemo(
    () => visibleItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [visibleItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () =>
      files.some(
        (file) =>
          selectedFiles.has(file.name) && statusUpdating[getAuthFileRefreshKey(file)] === true
      ),
    [files, selectedFiles, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const handleBatchDisable = useCallback(() => {
    showConfirmation({
      title: t('auth_files.batch_disable_confirm_title'),
      message: t('auth_files.batch_disable_confirm', { count: selectedNames.length }),
      variant: 'primary',
      confirmText: t('auth_files.batch_disable'),
      onConfirm: () => batchSetStatus(selectedNames, false),
    });
  }, [batchSetStatus, selectedNames, showConfirmation, t]);

  /* ---------- 头部计数 ---------- */

  const headerCounts = useMemo(() => countAuthFileStatuses(files, now), [files, now]);

  /* ---------- 首屏卡片一次性级联入场（仅卡片视图） ---------- */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance =
    !cardsAnimated && isCurrentLayer && !loading && !isRowsView && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) {
      setCardsAnimated(true);
    }
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 杂项 ---------- */

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const clearFilters = useCallback(() => {
    setFilter('all');
    setStatusFilterMode('all');
    setSearch('');
    setPage(1);
  }, []);

  const statusFilterOptions = useMemo(
    () =>
      [
        { value: 'all', label: t('auth_files.problem_filter_all') },
        { value: 'active', label: t('auth_files.problem_filter_active') },
        { value: 'problem', label: t('auth_files.problem_filter_problem') },
        { value: 'cooling', label: t('auth_files.problem_filter_cooling') },
        { value: 'disabled', label: t('auth_files.problem_filter_disabled') },
      ] satisfies Array<{ value: AuthFilesStatusFilterMode; label: string }>,
    [t]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
      { value: 'problems', label: t('auth_files.sort_problems') },
      { value: 'mostUsed', label: t('auth_files.sort_most_used') },
      { value: 'lowestQuota', label: t('auth_files.sort_lowest_quota') },
    ],
    [t]
  );

  const toolbarMenuItems = useMemo(
    () => [
      {
        key: 'delete-shown',
        label: t('auth_files.delete_shown_button', { count: selectableFilteredItems.length }),
        onSelect: () => handleDeleteAll(selectableFilteredItems),
        danger: true,
        disabled: disableControls || loading || deletingAll || selectableFilteredItems.length === 0,
        loading: deletingAll,
      },
    ],
    [deletingAll, disableControls, handleDeleteAll, loading, selectableFilteredItems, t]
  );

  const oauthSectionRef = useRevealOnScroll<HTMLDivElement>();

  const isFirstRunEmpty = !loading && files.length === 0 && !error;
  const isNoResults = !loading && files.length > 0 && visibleItems.length === 0;

  const gridClasses = [styles.grid, activeQuotaFilter ? styles.gridQuota : '']
    .filter(Boolean)
    .join(' ');

  const listBody = (() => {
    if (loading) {
      return isRowsView ? (
        <AuthFilesLedgerSkeleton rows={SKELETON_CARD_COUNT} />
      ) : (
        <div className={gridClasses} aria-hidden="true">
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
            <Skeleton key={index} height={206} rounded={14} />
          ))}
        </div>
      );
    }
    if (isFirstRunEmpty) {
      return (
        <EmptyState
          title={t('auth_files.empty_title')}
          description={t('auth_files.empty_desc')}
          action={
            <div className={styles.emptyActions}>
              <Button size="sm" onClick={handleUploadClick} disabled={disableControls || uploading}>
                {t('auth_files.upload_button')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/oauth')}>
                {t('auth_files.empty_oauth_link')}
              </Button>
            </div>
          }
        />
      );
    }
    if (isNoResults) {
      return (
        <EmptyState
          title={t('auth_files.search_empty_title')}
          description={t('auth_files.search_empty_desc')}
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {t('auth_files.no_results_clear')}
            </Button>
          }
        />
      );
    }
    if (isRowsView) {
      return (
        <AuthFilesLedger
          groups={groups}
          now={now}
          resolvedTheme={resolvedTheme}
          displayNameFor={displayNameFor}
          selectedFiles={selectedFiles}
          disableControls={disableControls}
          deleting={deleting}
          statusUpdating={statusUpdating}
          manualRefreshing={manualRefreshing}
          cooldownResetting={cooldownResetting}
          quotaFor={quotaFor}
          quotaLoading={quotaLoading}
          onLoadGroupQuota={handleLoadGroupQuota}
          onRefreshQuota={handleRefreshQuota}
          onShowModels={showModels}
          onDownload={handleDownload}
          onManualRefresh={handleManualRefresh}
          onCooldownReset={handleCooldownReset}
          onOpenDetails={openPrefixProxyEditor}
          onDelete={handleDelete}
          onToggleStatus={handleStatusToggle}
          onToggleSelect={toggleSelect}
        />
      );
    }
    return (
      <>
        <div className={gridClasses}>
          {pageItems.map((file, index) => (
            <AuthFileCard
              key={getQuotaCacheKey(file)}
              file={file}
              selected={selectedFiles.has(file.name)}
              resolvedTheme={resolvedTheme}
              disableControls={disableControls}
              deleting={deleting}
              statusUpdating={statusUpdating}
              manualRefreshing={manualRefreshing}
              cooldownResetting={cooldownResetting}
              quotaFilterType={activeQuotaFilter}
              statusBarCache={statusBarCache}
              displayNameFor={displayNameFor}
              entranceDelayMs={cardEntranceDelay(index)}
              onShowModels={showModels}
              onDownload={handleDownload}
              onManualRefresh={handleManualRefresh}
              onCooldownReset={handleCooldownReset}
              onOpenPrefixProxyEditor={openPrefixProxyEditor}
              onDelete={handleDelete}
              onToggleStatus={handleStatusToggle}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={sorted.length}
          onChange={setPage}
        />
      </>
    );
  })();

  return (
    <div className={styles.page}>
      <VaultHeader
        totalCount={headerCounts.total}
        activeCount={headerCounts.active}
        problemCount={headerCounts.problem}
        loading={loading}
        refreshing={refreshing}
        uploading={uploading}
        disableControls={disableControls}
        showEmails={showEmails}
        onToggleEmails={handleToggleEmails}
        onUpload={handleUploadClick}
        onRefresh={() => void handleHeaderRefresh()}
        refreshingCredentials={refreshingAllCredentials}
        credentialRefreshDisabled={Object.keys(manualRefreshing).length > 0}
        onRefreshCredentials={handleRefreshAllCredentials}
      />
      <AuthFileRefreshResults results={refreshResults} onClose={closeRefreshResults} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <section className={styles.workbench} aria-label={t('auth_files.title_section')}>
        <ProviderTabs
          types={existingTypes}
          counts={typeCounts}
          active={normalizedFilter}
          resolvedTheme={resolvedTheme}
          onChange={(type) => {
            setFilter(type);
            setPage(1);
          }}
        />

        <VaultSummary
          counts={statusCounts}
          statusFilterMode={statusFilterMode}
          onChange={handleStatusFilterModeChange}
        />

        <AuthFilesToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          statusFilterMode={statusFilterMode}
          statusFilterOptions={statusFilterOptions}
          onStatusFilterChange={handleStatusFilterModeChange}
          sortMode={sortMode}
          sortOptions={sortOptions}
          onSortModeChange={handleSortModeChange}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          menuItems={toolbarMenuItems}
        />

        <ErrorBanner message={error} onRetry={() => void loadFiles()} retrying={refreshing} />

        {listBody}
      </section>

      <div ref={oauthSectionRef}>
        <RoutingRulesSection open={routingRulesOpen} onOpenChange={setRoutingRulesOpen}>
          <OAuthExcludedCard
            disableControls={disableControls}
            excludedError={excludedError}
            excluded={excluded}
            onRetry={loadExcluded}
            onAdd={() => openExcludedEditor()}
            onEdit={openExcludedEditor}
            onDelete={deleteExcluded}
          />

          <OAuthModelAliasCard
            disableControls={disableControls}
            viewMode={aliasViewMode}
            onViewModeChange={setAliasViewMode}
            onRetry={loadModelAlias}
            onAdd={() => openModelAliasEditor()}
            onEditProvider={openModelAliasEditor}
            onDeleteProvider={deleteModelAlias}
            modelAliasError={modelAliasError}
            modelAlias={modelAlias}
            allProviderModels={allProviderModels}
            onUpdate={handleMappingUpdate}
            onDeleteLink={handleDeleteLink}
            onToggleFork={handleToggleFork}
            onRenameAlias={handleRenameAlias}
            onDeleteAlias={handleDeleteAlias}
          />
        </RoutingRulesSection>
      </div>

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFileDetailsSheet
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <AuthFileDeleteConfirmModal
        files={deleteRequest?.files ?? null}
        displayNameFor={displayNameFor}
        onCancel={cancelDeleteRequest}
        onConfirm={confirmDeleteRequest}
      />

      <BatchActionBar
        selectionCount={selectionCount}
        selectablePageCount={selectableVisibleItems.length}
        selectableFilteredCount={selectableFilteredItems.length}
        showSelectPage={!isRowsView}
        disableControls={disableControls}
        batchStatusDisabled={batchStatusButtonsDisabled}
        onSelectPage={() => selectAllVisible(visibleItems)}
        onSelectFiltered={() => selectAllVisible(sorted)}
        onInvertPage={() => invertVisibleSelection(visibleItems)}
        onDeselectAll={deselectAll}
        onDownload={() => void batchDownload(selectedNames)}
        onEnable={() => batchSetStatus(selectedNames, true)}
        onDisable={handleBatchDisable}
        onDelete={() => batchDelete(selectedNames)}
      />
    </div>
  );
}
