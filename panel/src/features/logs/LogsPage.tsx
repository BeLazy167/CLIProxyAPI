import {
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Modal } from '@/components/ui/Modal';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader/PageHeader';
import { SearchField } from '@/components/ui/SearchField/SearchField';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';
import {
  IconDownload,
  IconEye,
  IconMaximize2,
  IconMinimize2,
  IconRefreshCw,
  IconSlidersHorizontal,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { logsApi, responseDataToText, type ErrorLogFile } from '@/services/api/logs';
import { INITIAL_VISIBLE_LINES } from './model/logBuffer';
import { useLogStream } from './hooks/useLogStream';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import { downloadBlob } from '@/utils/download';
import {
  createLogParserCache,
  searchLogEntries,
  filterLogEntries,
} from '@/features/logs/model/logSelectors';
import { formatFileSize, formatUnixTimestamp } from '@/utils/format';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import {
  HTTP_METHODS,
  QUICK_FILTERS,
  matchesQuickFilter,
  type LogState,
  type QuickFilter,
} from './model/logTypes';
import { countQuickFilters, splitLogTimestamp, summarizeLogEntries } from './model/logDisplay';
import { createLogRequestGuard } from './model/logRequests';
import { errorLogViewerReducer } from './model/errorLogViewer';
import { shouldExitLogFullscreen } from './model/logFullscreen';
import { useLogFilters } from './hooks/useLogFilters';
import { hasSelectionInside, isNearBottom, useLogScroller } from './hooks/useLogScroller';
import { ErrorLogLedger } from './components/ErrorLogLedger';
import { LogRow } from './components/LogRow';
import { ToolbarPopover } from './components/ToolbarPopover';
import styles from './LogsPage.module.scss';

const INITIAL_DISPLAY_LINES = INITIAL_VISIBLE_LINES;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const TAB_IDS = ['logs', 'errors'] as const;

type TabType = (typeof TAB_IDS)[number];
type LiveState = 'live' | 'paused' | 'retrying' | 'catching_up';

const QUICK_FILTER_LABEL_KEYS: Record<QuickFilter, string> = {
  all: 'logs.quick_all',
  errors: 'logs.quick_errors',
  '4xx': 'logs.filter_status_4xx',
  '5xx': 'logs.filter_status_5xx',
};

const LIVE_STATE_CLASS: Record<LiveState, string> = {
  live: styles.liveLive,
  paused: styles.livePaused,
  retrying: styles.liveRetrying,
  catching_up: styles.liveCatchingUp,
};

const LIVE_STATE_KEYS: Record<LiveState, string> = {
  live: 'logs.read_status_live',
  paused: 'logs.read_status_paused',
  retrying: 'logs.read_status_retrying_short',
  catching_up: 'logs.read_status_catching_up',
};

const isNarrowViewport = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.getAttribute('role') === 'combobox'
  );
};

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

function DismissibleNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.notice} role="status">
      <span>{text}</span>
      <button
        type="button"
        className={styles.noticeClose}
        onClick={onDismiss}
        aria-label={t('common.close')}
        title={t('common.close')}
      >
        <IconX size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function LogsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const requestLogEnabled = config?.requestLog ?? false;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: TabType = searchParams.get('tab') === 'errors' ? 'errors' : 'logs';
  const setActiveTab = (tab: TabType) => {
    if (tab === 'errors') setFullscreenLogs(false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'errors') next.set('tab', 'errors');
        else next.delete('tab');
        return next;
      },
      { replace: true }
    );
  };
  const tabRefs = useRef<Partial<Record<TabType, HTMLButtonElement | null>>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [hideManagementLogs, setHideManagementLogs] = useLocalStorage(
    'logsPage.hideManagementLogs',
    true
  );
  const [showRawLogs, setShowRawLogs] = useLocalStorage('logsPage.showRawLogs', false);
  const [wrapLogs, setWrapLogs] = useLocalStorage('logsPage.wrapLogs', isNarrowViewport());
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [requestIdFilter, setRequestIdFilter] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState('');
  const [errorLogs, setErrorLogs] = useState<ErrorLogFile[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [errorLogsError, setErrorLogsError] = useState('');
  const [downloadingErrorLog, setDownloadingErrorLog] = useState<string | null>(null);
  const [errorLogViewer, dispatchErrorLogViewer] = useReducer(errorLogViewerReducer, {
    status: 'closed',
  });
  const selectedErrorLog = errorLogViewer.status === 'closed' ? null : errorLogViewer.item;
  const [viewerRequestId, setViewerRequestId] = useState<string | null>(null);
  const [requestLogDownloading, setRequestLogDownloading] = useState(false);
  const [fullscreenLogs, setFullscreenLogs] = useState(false);

  const [requests] = useState(() => ({
    session: createLogRequestGuard(),
    errors: createLogRequestGuard(),
    viewer: createLogRequestGuard(),
  }));

  const {
    logBuffer,
    visibleCount,
    setVisibleCount,
    lastUpdated,
    catchingUp,
    wasReset,
    dismissReset,
    retryAt,
    loading,
    clearingLogs,
    error,
    autoRefresh,
    setAutoRefresh,
    cpaNeedsFileLogging,
    showFileLoggingRequired,
    loadLogs,
    clearLogs,
  } = useLogStream({
    active: activeTab === 'logs',
    isFollowing: () =>
      isNearBottom(logViewerRef.current) && !hasSelectionInside(logViewerRef.current),
    onFollow: () => requestScrollToBottom(),
  });

  const disableControls = connectionStatus !== 'connected';
  const refreshDisabled = disableControls || loading || clearingLogs || cpaNeedsFileLogging;
  const autoRefreshDisabled = disableControls || showFileLoggingRequired;
  const clearDisabled = disableControls || clearingLogs || showFileLoggingRequired;

  const liveState: LiveState =
    autoRefreshDisabled || !autoRefresh
      ? 'paused'
      : error
        ? 'retrying'
        : catchingUp
          ? 'catching_up'
          : 'live';

  // The countdown re-renders once a second only while a retry is scheduled.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (liveState !== 'retrying' || !retryAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveState, retryAt]);
  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  const downloadLines = (lines: string[]) => {
    const text = lines.join('\n');
    downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) });
    showNotification(t('logs.download_success'), 'success');
  };

  const loadErrorLogs = async () => {
    if (useAuthStore.getState().connectionStatus !== 'connected') {
      setLoadingErrors(false);
      return;
    }
    const request = requests.errors.invalidate();
    setLoadingErrors(true);
    setErrorLogsError('');
    try {
      const res = await logsApi.fetchErrorLogs();
      if (!requests.errors.isCurrent(request)) return;
      // API 返回 { files: [...] }
      setErrorLogs(Array.isArray(res.files) ? res.files : []);
    } catch (err: unknown) {
      if (!requests.errors.isCurrent(request)) return;
      console.error('Failed to load error logs:', err);
      setErrorLogs([]);
      const message = getErrorMessage(err);
      setErrorLogsError(
        message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error')
      );
    } finally {
      if (requests.errors.isCurrent(request)) setLoadingErrors(false);
    }
  };

  useHeaderRefresh(() => (activeTab === 'errors' ? loadErrorLogs() : loadLogs(false)));

  const downloadErrorLog = async (name: string) => {
    const session = requests.session.capture();
    setDownloadingErrorLog(name);
    try {
      const response = await logsApi.downloadErrorLog(name);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({ filename: name, blob: new Blob([response.data], { type: 'text/plain' }) });
      showNotification(t('logs.error_log_download_success'), 'success');
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      if (requests.session.isCurrent(session)) setDownloadingErrorLog(null);
    }
  };

  const openErrorLog = async (item: ErrorLogFile, byRequestId?: string) => {
    setViewerRequestId(byRequestId ?? null);
    const requestId = requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'open', item });

    try {
      if (item.size && item.size > 2 * 1024 * 1024) throw new Error(t('logs.preview_too_large'));
      const response = byRequestId
        ? await logsApi.downloadRequestLogById(byRequestId)
        : await logsApi.downloadErrorLog(item.name);
      if (response.data instanceof Blob && response.data.size > 2 * 1024 * 1024) {
        throw new Error(t('logs.preview_too_large'));
      }
      const text = await responseDataToText(response.data);
      if (!requests.viewer.isCurrent(requestId)) return;
      dispatchErrorLogViewer({ type: 'ready', text });
    } catch (err: unknown) {
      if (!requests.viewer.isCurrent(requestId)) return;
      const message =
        byRequestId &&
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        err.status === 404
          ? t('logs.request_log_missing')
          : getErrorMessage(err);
      dispatchErrorLogViewer({
        type: 'error',
        message: message
          ? `${t('logs.error_log_open_failed')}: ${message}`
          : t('logs.error_log_open_failed'),
      });
    }
  };

  const closeErrorLogViewer = () => {
    requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'close' });
  };

  const copySelectedErrorLog = async () => {
    if (errorLogViewer.status !== 'ready' || !errorLogViewer.text) return;
    const session = requests.session.capture();
    const ok = await copyToClipboard(errorLogViewer.text);
    if (!requests.session.isCurrent(session)) return;
    showNotification(
      ok ? t('logs.error_log_copy_success') : t('logs.copy_failed'),
      ok ? 'success' : 'error'
    );
  };

  useEffect(() => {
    const resetErrors = () => {
      requests.errors.invalidate();
      setErrorLogs([]);
      setLoadingErrors(false);
      setErrorLogsError('');
    };
    const invalidateSession = () => {
      requests.session.invalidate();
      requests.errors.invalidate();
      requests.viewer.invalidate();
    };

    // Store subscriptions invalidate synchronously, before a response can beat effect cleanup.
    const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
      if (
        next.apiBase === previous.apiBase &&
        next.managementKey === previous.managementKey &&
        next.connectionStatus === previous.connectionStatus &&
        next.isAuthenticated === previous.isAuthenticated
      )
        return;
      invalidateSession();
      resetErrors();
      dispatchErrorLogViewer({ type: 'close' });
      setViewerRequestId(null);
      setRequestLogDownloading(false);
      setDownloadingErrorLog(null);
    });
    const unsubscribeConfig = useConfigStore.subscribe((next, previous) => {
      if (next.config?.requestLog !== previous.config?.requestLog) resetErrors();
    });
    return () => {
      unsubscribeAuth();
      unsubscribeConfig();
      invalidateSession();
    };
  }, [requests]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    if (connectionStatus !== 'connected') return;
    void loadErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connectionStatus, apiBase, managementKey, requestLogEnabled]);

  const [parseEntries] = useState(createLogParserCache);
  const entries = useMemo(() => parseEntries(logBuffer), [logBuffer, parseEntries]);
  const summary = useMemo(() => summarizeLogEntries(entries), [entries]);
  const trimmedSearchQuery = deferredSearchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;
  const parsedSearchLines = useMemo(
    () => searchLogEntries(entries, trimmedSearchQuery, hideManagementLogs),
    [entries, trimmedSearchQuery, hideManagementLogs]
  );

  const filters = useLogFilters({ parsedLines: parsedSearchLines });
  const structuredFilterCount =
    filters.methodFilters.length + filters.pathFilters.length + (levelFilter ? 1 : 0);

  // Quick-filter counts describe what each segment would narrow the current result to.
  const scopedLines = useMemo(
    () =>
      filterLogEntries(parsedSearchLines, {
        methods: filters.methodFilterSet,
        paths: filters.pathFilterSet,
        level: levelFilter,
        requestId: requestIdFilter ?? undefined,
      }),
    [
      parsedSearchLines,
      filters.methodFilterSet,
      filters.pathFilterSet,
      levelFilter,
      requestIdFilter,
    ]
  );
  const quickCounts = useMemo(() => countQuickFilters(scopedLines), [scopedLines]);
  const filteredParsedLines = useMemo(
    () =>
      quickFilter === 'all'
        ? scopedLines
        : scopedLines.filter((line) => matchesQuickFilter(line, quickFilter)),
    [scopedLines, quickFilter]
  );
  const filteredLines = useMemo(
    () => filteredParsedLines.map((line) => line.raw),
    [filteredParsedLines]
  );
  const logState = useMemo<LogState>(
    () => ({
      buffer: filteredLines,
      visibleFrom: Math.max(0, filteredLines.length - visibleCount),
    }),
    [filteredLines, visibleCount]
  );
  const setLogState: Dispatch<SetStateAction<LogState>> = (update) => {
    const next = typeof update === 'function' ? update(logState) : update;
    setVisibleCount(next.buffer.length - next.visibleFrom);
  };
  useEffect(() => {
    setVisibleCount(INITIAL_DISPLAY_LINES);
  }, [
    setVisibleCount,
    trimmedSearchQuery,
    hideManagementLogs,
    levelFilter,
    quickFilter,
    requestIdFilter,
    filters.methodFilterSet,
    filters.pathFilterSet,
  ]);
  const parsedVisibleLines = filteredParsedLines.slice(logState.visibleFrom);

  const {
    canLoadMore,
    handleLogScroll,
    logViewerRef,
    requestScrollToBottom,
    isFollowing,
    resumeFollowing,
    pendingLines,
    historyEvicted,
    dismissHistoryEvicted,
  } = useLogScroller({
    logState,
    setLogState,
    bufferStart: logBuffer.bufferStart,
    loading,
    isSearching,
    filteredLineCount: filteredLines.length,
    hasStructuredFilters:
      filters.hasStructuredFilters || quickFilter !== 'all' || !!requestIdFilter,
    showRawLogs,
    wrapLogs,
  });

  // `/` focuses search and `End` resumes following; both ignore typing contexts.
  useEffect(() => {
    if (activeTab !== 'logs') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        resumeFollowing();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, resumeFollowing]);

  const copyText = async (text: string) => {
    const ok = await copyToClipboard(text);
    showNotification(ok ? t('logs.copy_success') : t('logs.copy_failed'), ok ? 'success' : 'error');
  };

  const downloadRequestLog = async (id: string) => {
    const session = requests.session.capture();
    setRequestLogDownloading(true);
    try {
      const response = await logsApi.downloadRequestLogById(id);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({
        filename: `request-${id}.log`,
        blob: new Blob([response.data], { type: 'text/plain' }),
      });
      showNotification(t('logs.request_log_download_success'), 'success');
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      if (requests.session.isCurrent(session)) setRequestLogDownloading(false);
    }
  };

  useEffect(() => {
    if (!fullscreenLogs) return;

    document.body.classList.add('logs-fullscreen-active');
    lockScroll();

    const handleEscape = (event: KeyboardEvent) => {
      if (!shouldExitLogFullscreen(event, !!document.querySelector('.modal-overlay'))) return;
      setFullscreenLogs(false);
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('logs-fullscreen-active');
      unlockScroll();
    };
  }, [fullscreenLogs]);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = TAB_IDS.indexOf(activeTab);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TAB_IDS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TAB_IDS.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = TAB_IDS[nextIndex];
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  const applyQuickFilterFromMeta = (filter: QuickFilter) => {
    setActiveTab('logs');
    setQuickFilter(filter);
  };

  const chips: FilterChip[] = [];
  if (quickFilter !== 'all') {
    chips.push({
      key: 'quick',
      label: t(QUICK_FILTER_LABEL_KEYS[quickFilter]),
      onRemove: () => setQuickFilter('all'),
    });
  }
  if (levelFilter) {
    chips.push({
      key: 'level',
      label: t('logs.chip_level', { level: levelFilter.toUpperCase() }),
      onRemove: () => setLevelFilter(''),
    });
  }
  filters.methodFilters.forEach((method) =>
    chips.push({
      key: `method-${method}`,
      label: method,
      onRemove: () => filters.toggleMethodFilter(method),
    })
  );
  filters.pathFilters.forEach((path) =>
    chips.push({ key: `path-${path}`, label: path, onRemove: () => filters.togglePathFilter(path) })
  );
  if (requestIdFilter) {
    chips.push({
      key: 'request',
      label: t('logs.chip_request_id', { id: requestIdFilter }),
      onRemove: () => setRequestIdFilter(null),
    });
  }
  if (trimmedSearchQuery) {
    chips.push({
      key: 'search',
      label: t('logs.chip_search', { query: trimmedSearchQuery }),
      onRemove: () => setSearchQuery(''),
    });
  }
  const clearableChipCount = chips.length;
  if (hideManagementLogs) {
    chips.push({
      key: 'hide-management',
      label: t('logs.chip_hide_management', { prefix: MANAGEMENT_API_PREFIX }),
      onRemove: () => setHideManagementLogs(false),
    });
  }
  const clearAllFilters = () => {
    setQuickFilter('all');
    setLevelFilter('');
    filters.clearStructuredFilters();
    setRequestIdFilter(null);
    setSearchQuery('');
  };

  const liveLabel =
    liveState === 'retrying'
      ? t('logs.read_status_retrying', { seconds: retrySeconds })
      : t(LIVE_STATE_KEYS[liveState]);

  const meta: PageHeaderMetaSegment[] = [
    { key: 'lines', text: t('logs.meta_lines', { count: summary.lines }) },
    {
      key: 'requests',
      tone: 'quiet',
      text: (
        <button
          type="button"
          className={styles.metaButton}
          onClick={() => applyQuickFilterFromMeta('all')}
        >
          {t('logs.meta_requests', { count: summary.requests })}
        </button>
      ),
    },
    {
      key: 'errors',
      tone: summary.errors > 0 ? 'attention' : 'quiet',
      text: (
        <button
          type="button"
          className={styles.metaButton}
          onClick={() => applyQuickFilterFromMeta('errors')}
        >
          {t('logs.meta_errors', { count: summary.errors })}
        </button>
      ),
    },
  ];
  if (summary.serverErrors > 0) {
    meta.push({
      key: '5xx',
      tone: 'attention',
      text: (
        <button
          type="button"
          className={styles.metaButton}
          onClick={() => applyQuickFilterFromMeta('5xx')}
        >
          {t('logs.meta_5xx', { count: summary.serverErrors })}
        </button>
      ),
    });
  }

  let viewer: ReactNode;
  if (disableControls && logBuffer.buffer.length === 0) {
    viewer = (
      <EmptyState
        title={t('logs.not_connected_title')}
        description={t('logs.not_connected_desc')}
        action={
          <Button variant="secondary" size="sm" shape="pill" onClick={() => navigate('/login')}>
            {t('common.login')}
          </Button>
        }
      />
    );
  } else if (loading && logBuffer.buffer.length === 0) {
    viewer = (
      <div className={styles.skeletonRows} aria-busy="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} height={16} />
        ))}
      </div>
    );
  } else if (showFileLoggingRequired && logBuffer.buffer.length === 0) {
    viewer = (
      <EmptyState
        title={t(
          cpaNeedsFileLogging
            ? 'logs.cpa_file_logging_required_title'
            : 'logs.file_logging_required_title'
        )}
        description={t(
          cpaNeedsFileLogging
            ? 'logs.cpa_file_logging_required_desc'
            : 'logs.file_logging_required_desc'
        )}
      />
    );
  } else if (logBuffer.buffer.length === 0) {
    viewer = <EmptyState title={t('logs.empty_title')} description={t('logs.empty_desc')} />;
  } else if (filteredLines.length === 0) {
    viewer = (
      <EmptyState
        title={t('logs.search_empty_title')}
        description={
          clearableChipCount > 0
            ? t('logs.search_empty_filters', {
                filters: chips.map((chip) => chip.label).join(', '),
              })
            : t('logs.search_empty_desc')
        }
        action={
          chips.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              shape="pill"
              onClick={() => {
                clearAllFilters();
                setHideManagementLogs(false);
              }}
            >
              {t('logs.clear_filters')}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    const rows: ReactNode[] = [];
    let lastDay: string | undefined;
    for (const line of parsedVisibleLines) {
      const { day } = splitLogTimestamp(line.timestamp);
      if (day && day !== lastDay) {
        rows.push(
          <div key={`day-${line.id}`} className={styles.daySeparator} role="separator">
            {day}
          </div>
        );
        lastDay = day;
      }
      rows.push(
        <LogRow
          key={line.id}
          line={line}
          needle={trimmedSearchQuery}
          onCopyLine={(raw) => void copyText(raw)}
          onFilterRequestId={setRequestIdFilter}
          onOpenRequestLog={(id) => void openErrorLog({ name: `request-${id}.log` }, id)}
          onCopyRequestId={(id) => void copyText(id)}
        />
      );
    }
    viewer = (
      <div
        ref={logViewerRef}
        className={[styles.logPanel, wrapLogs ? styles.wrapped : ''].filter(Boolean).join(' ')}
        onScroll={handleLogScroll}
        tabIndex={0}
        role="region"
        aria-label={t('logs.tab_live')}
        aria-busy={loading}
      >
        {canLoadMore && (
          <div className={styles.loadMoreBanner}>
            <Button
              variant="secondary"
              size="xs"
              shape="pill"
              onClick={() =>
                setVisibleCount((count) => Math.min(filteredLines.length, count + 200))
              }
            >
              {t('logs.filter_load_more')}
            </Button>
            <span className={styles.loadMoreStats}>
              {t('logs.showing_window', {
                shown: parsedVisibleLines.length,
                total: filteredLines.length,
              })}
            </span>
          </div>
        )}
        {showRawLogs ? (
          <pre className={styles.rawLog} spellCheck={false}>
            {parsedVisibleLines.map((line) => (
              <span key={line.id} data-log-id={line.id} className={styles.rawLine}>
                {line.raw || ' '}
              </span>
            ))}
          </pre>
        ) : (
          <div className={styles.logList}>{rows}</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader title={t('logs.title')} meta={meta} />

      <div className={styles.tabs} role="tablist" aria-label={t('logs.title')}>
        {TAB_IDS.map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              type="button"
              role="tab"
              id={`logs-tab-${tab}`}
              className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
              aria-selected={active}
              aria-controls={`logs-panel-${tab}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={handleTabKeyDown}
            >
              {tab === 'logs'
                ? t('logs.tab_live')
                : t('logs.tab_errors', { count: errorLogs.length })}
            </button>
          );
        })}
      </div>

      <div className={styles.content}>
        {/* The live viewer stays mounted while hidden so its scroll position survives tab switches. */}
        <div
          role="tabpanel"
          id="logs-panel-logs"
          aria-labelledby="logs-tab-logs"
          className={[styles.panel, activeTab !== 'logs' ? styles.panelHidden : '']
            .filter(Boolean)
            .join(' ')}
          inert={activeTab !== 'logs'}
        >
          <Card
            className={[styles.logCard, fullscreenLogs ? styles.logCardFullscreen : '']
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.toolbar}>
              <div className={styles.searchGroup}>
                <SearchField
                  ref={searchRef}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={t('logs.search_placeholder')}
                  ariaLabel={t('logs.search_placeholder')}
                  clearLabel={t('logs.clear_search')}
                  className={styles.search}
                />
                {isSearching && (
                  <span className={styles.matchCount}>
                    {t('logs.search_matches', { count: parsedSearchLines.length })}
                  </span>
                )}
              </div>

              <div className={styles.segment} role="group" aria-label={t('logs.filter_status')}>
                {QUICK_FILTERS.map((filter) => {
                  const active = quickFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      className={[styles.segmentItem, active ? styles.segmentActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={active}
                      onClick={() => setQuickFilter(filter)}
                    >
                      {t(QUICK_FILTER_LABEL_KEYS[filter])}
                      {filter !== 'all' && (
                        <span className={styles.segmentCount}>{quickCounts[filter]}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <ToolbarPopover
                label={t('logs.filter_panel_title')}
                icon={<IconSlidersHorizontal size={14} aria-hidden="true" />}
                badge={
                  structuredFilterCount > 0 ? (
                    <span className={styles.popoverBadge}>{structuredFilterCount}</span>
                  ) : undefined
                }
              >
                <div className={styles.filterGroup}>
                  <span className={styles.filterLabel}>{t('logs.level_filter')}</span>
                  <Select
                    size="sm"
                    fullWidth={false}
                    value={levelFilter}
                    onChange={setLevelFilter}
                    ariaLabel={t('logs.level_filter')}
                    options={[
                      { value: '', label: t('logs.all_levels') },
                      ...LOG_LEVELS.map((level) => ({ value: level, label: level.toUpperCase() })),
                    ]}
                  />
                </div>
                <div className={styles.filterGroup}>
                  <span className={styles.filterLabel}>{t('logs.filter_method')}</span>
                  <div className={styles.filterChipList}>
                    {HTTP_METHODS.map((method) => {
                      const active = filters.methodFilters.includes(method);
                      const count = filters.methodCounts[method] ?? 0;
                      return (
                        <button
                          key={method}
                          type="button"
                          className={[styles.filterChip, active ? styles.filterChipActive : '']
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => filters.toggleMethodFilter(method)}
                          disabled={count === 0 && !active}
                          aria-pressed={active}
                        >
                          {method} <span className={styles.filterChipCount}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className={styles.filterGroup}>
                  <span className={styles.filterLabel}>{t('logs.filter_path')}</span>
                  <div className={styles.filterChipList}>
                    {filters.pathOptions.length === 0 ? (
                      <span className={styles.filterHint}>{t('logs.filter_path_empty')}</span>
                    ) : (
                      filters.pathOptions.map(({ path, count }) => {
                        const active = filters.pathFilters.includes(path);
                        return (
                          <button
                            key={path}
                            type="button"
                            className={[styles.filterChip, active ? styles.filterChipActive : '']
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => filters.togglePathFilter(path)}
                            aria-pressed={active}
                            title={path}
                          >
                            <span className={styles.filterChipPath}>{path}</span>{' '}
                            <span className={styles.filterChipCount}>{count}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  shape="pill"
                  onClick={() => {
                    filters.clearStructuredFilters();
                    setLevelFilter('');
                  }}
                  disabled={structuredFilterCount === 0}
                >
                  {t('logs.clear_filters')}
                </Button>
              </ToolbarPopover>

              <ToolbarPopover
                label={t('logs.view_menu_title')}
                icon={<IconEye size={14} aria-hidden="true" />}
              >
                <div className={styles.viewOptions}>
                  <ToggleSwitch
                    checked={wrapLogs}
                    onChange={setWrapLogs}
                    label={t('logs.wrap_lines')}
                  />
                  <ToggleSwitch
                    checked={hideManagementLogs}
                    onChange={setHideManagementLogs}
                    label={t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
                  />
                  <ToggleSwitch
                    checked={showRawLogs}
                    onChange={setShowRawLogs}
                    label={
                      <span title={t('logs.show_raw_logs_hint')}>{t('logs.show_raw_logs')}</span>
                    }
                  />
                </div>
              </ToolbarPopover>

              <div className={styles.toolbarSpacer} />

              <button
                type="button"
                className={[styles.livePill, LIVE_STATE_CLASS[liveState]].join(' ')}
                aria-pressed={autoRefresh}
                aria-label={t('logs.reading_enabled')}
                title={t('logs.reading_enabled')}
                onClick={() => setAutoRefresh(!autoRefresh)}
                disabled={autoRefreshDisabled}
              >
                <span className={styles.liveDot} aria-hidden="true" />
                {liveLabel}
              </button>
              <span className={styles.srOnly} role="status">
                {t(LIVE_STATE_KEYS[liveState])}
              </span>

              <Button
                variant="secondary"
                size="sm"
                shape="pill"
                iconOnly
                onClick={() => loadLogs(false)}
                disabled={refreshDisabled}
                title={t('logs.refresh_button')}
                aria-label={t('logs.refresh_button')}
              >
                <IconRefreshCw size={15} aria-hidden="true" />
              </Button>

              <ToolbarPopover label={t('logs.more_menu_title')} role="menu" align="end">
                {(close) => (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      disabled={filteredLines.length === 0}
                      onClick={() => {
                        close();
                        downloadLines(filteredLines);
                      }}
                    >
                      <IconDownload size={14} aria-hidden="true" />
                      {t('logs.download_visible')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      disabled={logBuffer.buffer.length === 0}
                      onClick={() => {
                        close();
                        downloadLines(logBuffer.buffer);
                      }}
                    >
                      <IconDownload size={14} aria-hidden="true" />
                      {t('logs.download_cached')}
                    </button>
                    <div className={styles.menuSeparator} role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className={[styles.menuItem, styles.menuItemDanger].join(' ')}
                      disabled={clearDisabled}
                      onClick={() => {
                        close();
                        void clearLogs();
                      }}
                    >
                      <IconTrash2 size={14} aria-hidden="true" />
                      {t('logs.clear_button')}
                    </button>
                  </>
                )}
              </ToolbarPopover>

              <Button
                variant="secondary"
                size="sm"
                shape="pill"
                iconOnly
                onClick={() => setFullscreenLogs((prev) => !prev)}
                aria-pressed={fullscreenLogs}
                aria-label={
                  fullscreenLogs ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')
                }
                title={
                  fullscreenLogs ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')
                }
              >
                {fullscreenLogs ? (
                  <IconMinimize2 size={15} aria-hidden="true" />
                ) : (
                  <IconMaximize2 size={15} aria-hidden="true" />
                )}
              </Button>
            </div>

            {chips.length > 0 && (
              <div className={styles.chipRow} aria-label={t('logs.active_filters')}>
                {chips.map((chip) => (
                  <span key={chip.key} className={styles.chip}>
                    <span className={styles.chipLabel} title={chip.label}>
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      onClick={chip.onRemove}
                      aria-label={t('logs.remove_filter', { label: chip.label })}
                      title={t('logs.remove_filter', { label: chip.label })}
                    >
                      <IconX size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {clearableChipCount > 0 && (
                  <button type="button" className={styles.chipClearAll} onClick={clearAllFilters}>
                    {t('logs.clear_all_filters')}
                  </button>
                )}
              </div>
            )}

            <div className={styles.viewerArea}>
              <div className={styles.overlays}>
                {error && (
                  <ErrorBanner
                    message={
                      <>
                        {error}
                        {liveState === 'retrying' && retrySeconds > 0 && (
                          <span className={styles.retryHint}>
                            {' · '}
                            {t('logs.read_status_retrying', { seconds: retrySeconds })}
                          </span>
                        )}
                      </>
                    }
                    onRetry={() => void loadLogs(false)}
                    retryLabel={t('logs.retry_now')}
                    retrying={loading}
                  />
                )}
                {wasReset && (
                  <DismissibleNotice
                    text={t('logs.cursor_reset_notice')}
                    onDismiss={dismissReset}
                  />
                )}
                {historyEvicted && (
                  <DismissibleNotice
                    text={t('logs.history_evicted')}
                    onDismiss={dismissHistoryEvicted}
                  />
                )}
              </div>
              {viewer}
              {!isFollowing && (
                <Button
                  className={styles.followButton}
                  variant="secondary"
                  size="sm"
                  shape="pill"
                  onClick={resumeFollowing}
                >
                  {pendingLines > 0
                    ? t('logs.resume_following', { count: pendingLines })
                    : t('logs.jump_to_latest')}
                </Button>
              )}
            </div>

            <footer className={styles.statusBar}>
              <span>
                {t('logs.buffer_scope', {
                  count: logBuffer.buffer.length,
                  matched: filteredLines.length,
                })}
              </span>
              {logBuffer.evicted > 0 && (
                <span>{t('logs.evicted_note', { count: logBuffer.evicted })}</span>
              )}
              {lastUpdated && (
                <span>
                  {t('logs.last_updated', { time: new Date(lastUpdated).toLocaleTimeString() })}
                </span>
              )}
            </footer>
          </Card>
        </div>

        {activeTab === 'errors' && (
          <div
            role="tabpanel"
            id="logs-panel-errors"
            aria-labelledby="logs-tab-errors"
            className={styles.panel}
          >
            <Card className={styles.errorCard}>
              <div className={styles.errorPanel}>
                <ErrorLogLedger
                  files={errorLogs}
                  loading={loadingErrors}
                  error={errorLogsError}
                  requestLogEnabled={requestLogEnabled}
                  disconnected={disableControls}
                  downloadingName={downloadingErrorLog}
                  onRefresh={() => void loadErrorLogs()}
                  onReconnect={() => navigate('/login')}
                  onOpen={(file) => void openErrorLog(file)}
                  onDownload={(file) => void downloadErrorLog(file.name)}
                />
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal
        open={errorLogViewer.status !== 'closed'}
        onClose={closeErrorLogViewer}
        title={selectedErrorLog?.name ?? t('logs.error_log_view_title')}
        width={960}
        footer={
          <>
            <Button variant="secondary" onClick={closeErrorLogViewer}>
              {t('common.close')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void copySelectedErrorLog();
              }}
              disabled={errorLogViewer.status !== 'ready' || !errorLogViewer.text}
            >
              {t('common.copy')}
            </Button>
            <Button
              onClick={() => {
                if (viewerRequestId) void downloadRequestLog(viewerRequestId);
                else if (selectedErrorLog) void downloadErrorLog(selectedErrorLog.name);
              }}
              loading={requestLogDownloading || downloadingErrorLog === selectedErrorLog?.name}
              disabled={errorLogViewer.status === 'closed' || errorLogViewer.status === 'loading'}
            >
              {t('logs.error_logs_download')}
            </Button>
          </>
        }
      >
        <div className={styles.errorLogViewer}>
          {selectedErrorLog && (
            <div className={styles.errorLogViewerMeta}>
              <span>
                {t('logs.error_logs_size')}:{' '}
                {typeof selectedErrorLog.size === 'number'
                  ? formatFileSize(selectedErrorLog.size)
                  : '-'}
              </span>
              <span>
                {t('logs.error_logs_modified')}:{' '}
                {selectedErrorLog.modified ? formatUnixTimestamp(selectedErrorLog.modified) : '-'}
              </span>
            </div>
          )}
          {errorLogViewer.status === 'error' && <ErrorBanner message={errorLogViewer.message} />}
          {errorLogViewer.status === 'loading' && (
            <div className={styles.skeletonRows} aria-busy="true">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} height={14} />
              ))}
            </div>
          )}
          {errorLogViewer.status === 'ready' &&
            (errorLogViewer.text ? (
              <pre className={styles.errorLogContent} spellCheck={false}>
                {errorLogViewer.text}
              </pre>
            ) : (
              <div className="hint">{t('logs.error_log_empty_content')}</div>
            ))}
        </div>
      </Modal>
    </div>
  );
}
