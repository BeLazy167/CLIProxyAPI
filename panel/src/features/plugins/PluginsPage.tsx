import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Input } from '@/components/ui/Input';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconEye,
  IconEyeOff,
  IconRefreshCw,
  IconSettings,
  IconSidebarStore,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup } from '@/hooks/motion';
import { pluginsApi, pluginStoreApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type {
  PluginConfigField,
  PluginListEntry,
  PluginListResponse,
  PluginStoreEntry,
} from '@/types';
import {
  buildPluginConfigDraft,
  buildPluginConfigPatch,
  getConfigFieldLabel,
  isPluginConfigDraftDirty,
  isSecretConfigField,
  normalizePluginConfigFieldType,
  type PluginConfigDraft,
} from './pluginConfigDraft';
import {
  buildPluginResourceRoute,
  getPluginTitle,
  notifyPluginResourcesChanged,
  resolvePluginAssetURL,
} from './pluginResources';
import { waitForPluginState } from './pluginPolling';
import { getPluginLogo } from './pluginLogo';
import {
  derivePluginStatus,
  isAttentionStatus,
  matchesPluginStatusFilter,
  type PluginStatusFilter,
  type PluginStatusKind,
} from './pluginStatus';
import { usePluginRestartStore } from './pluginRestartStore';
import { PluginLogo } from './components/PluginLogo';
import { PluginNotice } from './components/PluginNotice';
import { PluginOverflowMenu } from './components/PluginOverflowMenu';
import { PluginSummaryCards, type PluginSummaryCard } from './components/PluginSummaryCards';
import styles from './PluginsPage.module.scss';

type PluginRuntimeWaitStatus = 'ready' | 'globalDisabled' | 'timeout';

const SKELETON_ROWS = 4;
const FOCUS_HIGHLIGHT_MS = 2400;

const STATUS_CHIP_CLASS: Record<PluginStatusKind, string> = {
  running: styles.chipRunning,
  disabled: styles.chipDisabled,
  needsConfig: styles.chipAttention,
  restartNeeded: styles.chipAttention,
  error: styles.chipError,
};

const STATUS_LABEL_KEY: Record<PluginStatusKind, string> = {
  running: 'plugin_management.status_running',
  disabled: 'plugin_management.status_disabled',
  needsConfig: 'plugin_management.status_needs_config',
  restartNeeded: 'plugin_management.status_restart_needed',
  error: 'plugin_management.status_error',
};

const STATUS_FILTERS: PluginStatusFilter[] = ['all', 'running', 'disabled', 'attention'];

const hasStatus = (error: unknown, status: number) => isRecord(error) && error.status === status;

const hasRestartRequired = (value: unknown) => isRecord(value) && value.restart_required === true;

const hasRestartRequiredError = (error: unknown) =>
  isRecord(error) && (hasRestartRequired(error.details) || hasRestartRequired(error.data));

export function PluginsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const restartRequiredIDs = usePluginRestartStore((state) => state.ids);
  const markRestartRequired = usePluginRestartStore((state) => state.markRestartRequired);
  const clearRestartRequired = usePluginRestartStore((state) => state.clearRestartRequired);
  const headerRef = useRevealGroup<HTMLElement>();

  const [data, setData] = useState<PluginListResponse | null>(null);
  const [storeEntries, setStoreEntries] = useState<{
    apiBase: string;
    managementKey: string;
    entries: PluginStoreEntry[];
  } | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PluginStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPlugin, setEditingPlugin] = useState<PluginListEntry | null>(null);
  const [draft, setDraft] = useState<PluginConfigDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [sheetNotice, setSheetNotice] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [mutatingID, setMutatingID] = useState('');
  const [deletingID, setDeletingID] = useState('');
  const [highlightedID, setHighlightedID] = useState('');
  const configRequestSeq = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const connected = connectionStatus === 'connected';
  const focusID = searchParams.get('focus') ?? '';

  const loadPlugins = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const plugins = await pluginsApi.list();
      setData(plugins);
    } catch (err: unknown) {
      setError(
        hasStatus(err, 404)
          ? t('plugin_management.unsupported_backend')
          : getErrorMessage(err, t('plugin_management.load_failed'))
      );
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  const waitForPluginRuntimeState = useCallback(
    async (id: string, enabled: boolean): Promise<PluginRuntimeWaitStatus> => {
      const result = await waitForPluginState(id, (item, response) =>
        enabled
          ? !response.pluginsEnabled || (item.registered && item.effectiveEnabled)
          : !item.effectiveEnabled
      );
      setData(result.response);
      if (enabled && !result.response.pluginsEnabled) {
        return 'globalDisabled';
      }
      return result.timedOut ? 'timeout' : 'ready';
    },
    []
  );

  useHeaderRefresh(loadPlugins, connected);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  // Store metadata is optional (logos, update flags); its failure must not block management.
  useEffect(() => {
    setStoreEntries(null);
    if (!connected || !data) return;
    let cancelled = false;
    void pluginStoreApi.list().then(
      (response) => {
        if (!cancelled) {
          setStoreEntries({ apiBase, managementKey, entries: response.plugins });
        }
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [connected, apiBase, managementKey, data]);

  const storeEntryList =
    connected && storeEntries?.apiBase === apiBase && storeEntries.managementKey === managementKey
      ? storeEntries.entries
      : null;

  const plugins = useMemo(() => data?.plugins ?? [], [data?.plugins]);
  const pluginsEnabled = data?.pluginsEnabled ?? true;

  const statusByID = useMemo(
    () =>
      new Map(
        plugins.map((plugin) => [
          plugin.id,
          derivePluginStatus(plugin, pluginsEnabled, restartRequiredIDs.includes(plugin.id)),
        ])
      ),
    [plugins, pluginsEnabled, restartRequiredIDs]
  );

  const counts = useMemo(() => {
    let running = 0;
    let disabled = 0;
    let attention = 0;
    let pages = 0;
    plugins.forEach((plugin) => {
      const kind = statusByID.get(plugin.id)?.kind ?? 'error';
      if (kind === 'running') running += 1;
      else if (kind === 'disabled') disabled += 1;
      else if (isAttentionStatus(kind)) attention += 1;
      if (plugin.effectiveEnabled) pages += plugin.menus.filter((menu) => menu.path.trim()).length;
    });
    const installedIDs = new Set(plugins.map((plugin) => plugin.id));
    const updates = (storeEntryList ?? []).filter(
      (entry) => entry.installed && entry.updateAvailable && installedIDs.has(entry.id)
    ).length;
    return { running, disabled, attention, pages, updates };
  }, [plugins, statusByID, storeEntryList]);

  const visiblePlugins = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return plugins.filter((plugin) => {
      const kind = statusByID.get(plugin.id)?.kind ?? 'error';
      if (!matchesPluginStatusFilter(kind, statusFilter)) return false;
      if (!query) return true;
      const haystack = [
        plugin.id,
        plugin.path,
        plugin.metadata?.name,
        plugin.metadata?.author,
        plugin.metadata?.version,
        plugin.metadata?.githubRepository,
        ...plugin.menus.map((menu) => `${menu.menu} ${menu.path} ${menu.description}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, plugins, statusByID, statusFilter]);

  // `/plugins?focus=<id>` (from the Store's Manage button): scroll to and highlight the row once.
  useEffect(() => {
    if (loading || !focusID || !data) return;
    const exists = plugins.some((plugin) => plugin.id === focusID);
    if (exists) {
      setFilter('');
      setStatusFilter('all');
      setHighlightedID(focusID);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`plugin-row-${focusID}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      },
      { replace: true }
    );
  }, [data, focusID, loading, plugins, setSearchParams]);

  useEffect(() => {
    if (!highlightedID) return;
    const timer = window.setTimeout(() => setHighlightedID(''), FOCUS_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightedID]);

  const resolvePluginAsset = useCallback(
    (value: string) => resolvePluginAssetURL(value, apiBase),
    [apiBase]
  );

  /* ---------- config sheet ---------- */

  const loadDraft = useCallback(
    async (plugin: PluginListEntry) => {
      const requestSeq = configRequestSeq.current + 1;
      configRequestSeq.current = requestSeq;
      setDraftLoading(true);
      setDraftError('');
      try {
        const currentConfig = await pluginsApi.getConfig(plugin.id);
        if (configRequestSeq.current !== requestSeq) return;
        setDraft(buildPluginConfigDraft(plugin, currentConfig));
      } catch (err: unknown) {
        if (configRequestSeq.current !== requestSeq) return;
        setDraftError(
          hasStatus(err, 404)
            ? t('plugin_management.config_not_found')
            : `${t('plugin_management.config_load_failed')}: ${getErrorMessage(
                err,
                t('plugin_management.config_load_failed')
              )}`
        );
      } finally {
        if (configRequestSeq.current === requestSeq) setDraftLoading(false);
      }
    },
    [t]
  );

  const openConfigSheet = (plugin: PluginListEntry) => {
    if (mutatingID || deletingID) return;
    setEditingPlugin(plugin);
    setDraft(null);
    setSheetNotice('');
    setRevealedSecrets(new Set());
    void loadDraft(plugin);
  };

  const closeConfigSheet = useCallback(() => {
    configRequestSeq.current += 1;
    setEditingPlugin(null);
    setDraft(null);
    setDraftError('');
    setDraftLoading(false);
    setSheetNotice('');
  }, []);

  const draftDirty = Boolean(draft && isPluginConfigDraftDirty(draft));

  const confirmSheetClose = useCallback((): Promise<boolean> => {
    if (!draftDirty) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('common.unsaved_changes_title'),
        message: t('common.unsaved_changes_message'),
        variant: 'danger',
        confirmText: t('common.leave'),
        cancelText: t('common.stay'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [draftDirty, showConfirmation, t]);

  const updateDraft = (updater: (current: PluginConfigDraft) => PluginConfigDraft) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const savingConfig = Boolean(editingPlugin && mutatingID === editingPlugin.id);

  const handleSaveConfig = async () => {
    if (!editingPlugin || !draft || draftLoading || mutatingID || deletingID) return;
    const { patch, errors } = buildPluginConfigPatch(draft, editingPlugin.configFields, t);

    if (Object.keys(errors).length > 0) {
      setDraft({ ...draft, errors });
      showNotification(t('plugin_management.validation_failed'), 'warning');
      return;
    }

    if (Object.keys(patch).length === 0) {
      closeConfigSheet();
      showNotification(t('plugin_management.save_success'), 'success');
      return;
    }

    setMutatingID(editingPlugin.id);
    setSheetNotice('');
    try {
      await pluginsApi.patchConfig(editingPlugin.id, patch);
      clearConfigCache();
      const enabledChanged =
        typeof patch.enabled === 'boolean' && patch.enabled !== editingPlugin.enabled;
      const status = enabledChanged
        ? await waitForPluginRuntimeState(editingPlugin.id, patch.enabled === true)
        : await loadPlugins().then((): PluginRuntimeWaitStatus => 'ready');
      if (status === 'ready') {
        notifyPluginResourcesChanged();
        closeConfigSheet();
        showNotification(t('plugin_management.save_success'), 'success');
      } else {
        // Saved, but runtime state is unsettled: keep the sheet open with the warning inline.
        setSheetNotice(
          t(
            status === 'globalDisabled'
              ? 'plugin_management.global_disabled_hint'
              : 'plugin_management.runtime_pending'
          )
        );
        void loadDraft(editingPlugin);
      }
    } catch (err: unknown) {
      showNotification(
        `${t('plugin_management.save_failed')}: ${getErrorMessage(
          err,
          t('plugin_management.save_failed')
        )}`,
        'error'
      );
    } finally {
      setMutatingID('');
    }
  };

  /* ---------- row actions ---------- */

  const handleTogglePlugin = async (plugin: PluginListEntry, enabled: boolean) => {
    if (deletingID) return;
    setMutatingID(plugin.id);
    try {
      await pluginsApi.updateEnabled(plugin.id, enabled);
      clearConfigCache();
      const status = await waitForPluginRuntimeState(plugin.id, enabled);
      if (status === 'ready') {
        notifyPluginResourcesChanged();
        showNotification(t('plugin_management.toggle_success'), 'success');
      } else {
        showNotification(
          t(
            status === 'globalDisabled'
              ? 'plugin_management.global_disabled_hint'
              : 'plugin_management.runtime_pending'
          ),
          'warning'
        );
      }
    } catch (err: unknown) {
      showNotification(
        `${t('plugin_management.toggle_failed')}: ${getErrorMessage(
          err,
          t('plugin_management.toggle_failed')
        )}`,
        'error'
      );
    } finally {
      setMutatingID('');
    }
  };

  const handleDeletePlugin = (plugin: PluginListEntry) => {
    if (!connected || mutatingID || deletingID) return;

    const name = getPluginTitle(plugin);
    showConfirmation({
      title: t('plugin_management.delete_confirm_title'),
      message: t('plugin_management.delete_confirm_message', { name, id: plugin.id }),
      variant: 'danger',
      confirmText: t('plugin_management.delete_plugin'),
      onConfirm: async () => {
        setDeletingID(plugin.id);
        setMutatingID(plugin.id);
        try {
          const result = await pluginsApi.deletePlugin(plugin.id);
          clearConfigCache();
          if (editingPlugin?.id === plugin.id) closeConfigSheet();
          await loadPlugins();
          notifyPluginResourcesChanged();
          showNotification(t('plugin_management.delete_success'), 'success');
          if (result.restartRequired) {
            markRestartRequired(plugin.id);
            showNotification(t('plugin_management.delete_restart_required'), 'warning');
          }
        } catch (err: unknown) {
          const restartRequired = hasRestartRequiredError(err);
          const fallback = restartRequired
            ? t('plugin_management.delete_restart_required')
            : t('plugin_management.delete_failed');
          showNotification(
            `${t('plugin_management.delete_failed')}: ${getErrorMessage(err, fallback)}`,
            restartRequired ? 'warning' : 'error'
          );
        } finally {
          setDeletingID('');
          setMutatingID('');
        }
      },
    });
  };

  /* ---------- config field editors ---------- */

  const touchField = (fieldName: string, value: string | boolean) =>
    updateDraft((current) => ({
      ...current,
      values: { ...current.values, [fieldName]: value },
      errors: { ...current.errors, [fieldName]: '' },
      touchedFields: { ...current.touchedFields, [fieldName]: true },
    }));

  const handleFieldTextChange =
    (fieldName: string) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      touchField(fieldName, event.target.value);

  const handlePriorityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateDraft((current) => ({
      ...current,
      priority: value,
      errors: { ...current.errors, priority: '' },
      priorityTouched: true,
    }));
  };

  const toggleSecret = (fieldName: string) =>
    setRevealedSecrets((current) => {
      const next = new Set(current);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });

  const renderFieldEditor = (field: PluginConfigField) => {
    if (!draft) return null;
    const fieldType = normalizePluginConfigFieldType(field);
    const value = draft.values[field.name];
    const textValue = typeof value === 'string' ? value : '';
    const errorText = draft.errors[field.name];
    const label = getConfigFieldLabel(field);
    const showKey = label !== field.name;
    const hint = (
      <>
        {showKey ? <code className={styles.fieldKey}>{field.name}</code> : null}
        {field.description ? <span>{field.description}</span> : null}
      </>
    );
    const hasHint = showKey || Boolean(field.description);
    const inputId = `plugin-field-${field.name}`;

    if (fieldType === 'boolean') {
      return (
        <div key={field.name} className={styles.fieldRow}>
          <div className={styles.fieldText}>
            <div className={styles.fieldLabel}>{label}</div>
            {hasHint ? <div className={styles.fieldDescription}>{hint}</div> : null}
          </div>
          <ToggleSwitch
            checked={value === true}
            onChange={(nextValue) => touchField(field.name, nextValue)}
            ariaLabel={label}
          />
        </div>
      );
    }

    if (fieldType === 'enum' && field.enumValues.length > 0) {
      return (
        <div key={field.name} className={styles.formField}>
          <label htmlFor={inputId}>{label}</label>
          <Select
            id={inputId}
            value={textValue}
            options={field.enumValues.map((item) => ({ value: item, label: item }))}
            onChange={(nextValue) => touchField(field.name, nextValue)}
            placeholder={t('plugin_management.select_placeholder')}
          />
          {hasHint ? <div className={styles.fieldHint}>{hint}</div> : null}
          {errorText ? <div className={styles.fieldError}>{errorText}</div> : null}
        </div>
      );
    }

    if (fieldType === 'array' || fieldType === 'object') {
      return (
        <div key={field.name} className={styles.formField}>
          <label htmlFor={inputId}>{label}</label>
          <textarea
            id={inputId}
            className={styles.textarea}
            value={textValue}
            onChange={handleFieldTextChange(field.name)}
            placeholder={fieldType === 'array' ? '[]' : '{}'}
            spellCheck={false}
          />
          {hasHint ? <div className={styles.fieldHint}>{hint}</div> : null}
          {errorText ? <div className={styles.fieldError}>{errorText}</div> : null}
        </div>
      );
    }

    const secret = isSecretConfigField(field);
    const revealed = revealedSecrets.has(field.name);
    const secretLabel = t(
      revealed ? 'plugin_management.hide_secret' : 'plugin_management.show_secret',
      { field: label }
    );

    return (
      <Input
        key={field.name}
        id={inputId}
        label={label}
        type={secret && !revealed ? 'password' : 'text'}
        value={textValue}
        onChange={handleFieldTextChange(field.name)}
        inputMode={fieldType === 'integer' || fieldType === 'number' ? 'decimal' : undefined}
        autoComplete={secret ? 'off' : undefined}
        hint={hasHint ? hint : undefined}
        error={errorText || undefined}
        rightElement={
          secret ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => toggleSecret(field.name)}
              aria-label={secretLabel}
              title={secretLabel}
            >
              {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          ) : undefined
        }
      />
    );
  };

  /* ---------- derived view ---------- */

  const meta: PageHeaderMetaSegment[] = data
    ? [
        {
          key: 'discovered',
          text: t('plugin_management.meta_discovered', { count: plugins.length }),
        },
        {
          key: 'running',
          text: t('plugin_management.meta_running', { count: counts.running }),
          tone: counts.running > 0 ? 'ok' : 'quiet',
        },
      ]
    : [];
  if (data && counts.attention > 0) {
    meta.push({
      key: 'attention',
      text: t('plugin_management.meta_attention', { count: counts.attention }),
      tone: 'attention',
    });
  }
  if (data && counts.updates > 0) {
    meta.push({
      key: 'updates',
      text: t('plugin_management.meta_updates', { count: counts.updates }),
      tone: 'warning',
    });
  }

  const toggleStatusFilter = (next: PluginStatusFilter) =>
    setStatusFilter((current) => (current === next && next !== 'all' ? 'all' : next));

  const summaryCards: PluginSummaryCard[] = [
    {
      key: 'running',
      label: t('plugin_management.summary_running'),
      count: counts.running,
      tone: 'ok',
      active: statusFilter === 'running',
      onClick: () => toggleStatusFilter('running'),
    },
    {
      key: 'disabled',
      label: t('plugin_management.summary_disabled'),
      count: counts.disabled,
      tone: 'muted',
      active: statusFilter === 'disabled',
      onClick: () => toggleStatusFilter('disabled'),
    },
    {
      key: 'attention',
      label: t('plugin_management.summary_attention'),
      count: counts.attention,
      tone: counts.attention > 0 ? 'warning' : 'muted',
      active: statusFilter === 'attention',
      onClick: () => toggleStatusFilter('attention'),
    },
  ];
  if (storeEntryList) {
    summaryCards.push({
      key: 'updates',
      label: t('plugin_management.summary_updates'),
      count: counts.updates,
      tone: counts.updates > 0 ? 'accent' : 'muted',
      onClick: () => navigate('/plugin-store?filter=updates'),
    });
  }

  const filterCounts: Record<PluginStatusFilter, number> = {
    all: plugins.length,
    running: counts.running,
    disabled: counts.disabled,
    attention: counts.attention,
  };

  const restartNames = restartRequiredIDs.map((id) => {
    const plugin = plugins.find((item) => item.id === id);
    return plugin ? getPluginTitle(plugin) : id;
  });

  const hasActiveFilters = Boolean(filter.trim()) || statusFilter !== 'all';
  const actionBusy = Boolean(mutatingID || deletingID);

  const renderRow = (plugin: PluginListEntry) => {
    const title = getPluginTitle(plugin);
    const logo = resolvePluginAsset(getPluginLogo(plugin, storeEntryList ?? []));
    const github = plugin.metadata?.githubRepository.trim();
    const status = statusByID.get(plugin.id) ?? derivePluginStatus(plugin, pluginsEnabled);
    const version = plugin.metadata?.version;
    const author = plugin.metadata?.author;
    const pages = plugin.menus
      .map((menu, index) => ({ menu, index }))
      .filter(({ menu }) => menu.path.trim());
    const menuItems = [
      ...(github
        ? [
            {
              key: 'repository',
              label: t('plugin_management.open_repository'),
              onSelect: () => window.open(github, '_blank', 'noopener,noreferrer'),
            },
          ]
        : []),
      {
        key: 'delete',
        label: t('plugin_management.delete_plugin'),
        danger: true,
        disabled: !connected || actionBusy,
        loading: deletingID === plugin.id,
        onSelect: () => handleDeletePlugin(plugin),
      },
    ];

    return (
      <article
        key={plugin.id}
        id={`plugin-row-${plugin.id}`}
        className={`${styles.row} ${highlightedID === plugin.id ? styles.rowHighlighted : ''}`}
      >
        <PluginLogo src={logo} />

        <div className={styles.info}>
          <div className={styles.nameLine}>
            <h2>{title}</h2>
            <span className={`${styles.chip} ${STATUS_CHIP_CLASS[status.kind]}`}>
              {t(STATUS_LABEL_KEY[status.kind])}
            </span>
            {plugin.supportsOAuth ? (
              <span className={styles.tag}>{t('plugin_management.oauth')}</span>
            ) : null}
          </div>
          <div className={styles.metaLine}>
            <span className={styles.metaId}>{plugin.id}</span>
            {version ? <span>v{version.replace(/^v/i, '')}</span> : null}
            {author ? <span>{author}</span> : null}
          </div>
          {status.reasonKey ? (
            <div className={styles.reason}>
              <span>{t(status.reasonKey)}</span>
              {status.kind === 'needsConfig' ? (
                <button
                  type="button"
                  className={styles.reasonAction}
                  onClick={() => openConfigSheet(plugin)}
                  disabled={!connected || actionBusy}
                >
                  {t('plugin_management.configure')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          {pages.length > 0 ? (
            plugin.effectiveEnabled ? (
              <PluginOverflowMenu
                label={t('plugin_management.pages_menu_label', { name: title })}
                items={pages.map(({ menu, index }) => ({
                  key: `${plugin.id}-${index}`,
                  label: menu.menu.trim() || title,
                  onSelect: () => navigate(buildPluginResourceRoute(plugin.id, index)),
                }))}
              >
                {t('plugin_management.pages_count', { count: pages.length })}
              </PluginOverflowMenu>
            ) : (
              <span className={styles.pagesMuted}>
                {t('plugin_management.pages_count', { count: pages.length })}
              </span>
            )
          ) : null}
          <ToggleSwitch
            checked={plugin.enabled}
            onChange={(enabled) => handleTogglePlugin(plugin, enabled)}
            disabled={!connected || actionBusy}
            ariaLabel={t('plugin_management.toggle_aria', { name: title })}
          />
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            onClick={() => openConfigSheet(plugin)}
            disabled={!connected || actionBusy}
            aria-label={t('plugin_management.edit_config_aria', { name: title })}
            title={t('plugin_management.edit_config')}
          >
            <IconSettings size={14} />
          </Button>
          <PluginOverflowMenu
            label={t('plugin_management.more_actions', { name: title })}
            items={menuItems}
          />
        </div>
      </article>
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader
        revealRef={headerRef}
        title={t('plugin_management.title')}
        meta={meta}
        description={data ? undefined : t('plugin_management.description')}
        actions={
          <>
            <Button
              variant="secondary"
              shape="pill"
              size="sm"
              onClick={() => navigate('/plugin-store')}
            >
              <IconSidebarStore size={14} />
              {t('plugin_store.title')}
            </Button>
            <Button
              shape="pill"
              onClick={loadPlugins}
              disabled={!connected || loading || actionBusy}
            >
              <IconRefreshCw size={14} className={loading ? 'spinning' : undefined} />
              {t('plugin_management.refresh')}
            </Button>
          </>
        }
      />

      {error || (data && !data.pluginsEnabled) || restartNames.length > 0 ? (
        <div className={styles.alerts}>
          <ErrorBanner
            message={error}
            onRetry={connected ? loadPlugins : undefined}
            retrying={loading}
          />
          {data && !data.pluginsEnabled ? (
            <PluginNotice>{t('plugin_management.global_disabled_hint')}</PluginNotice>
          ) : null}
          {restartNames.length > 0 ? (
            <PluginNotice
              action={
                <Button variant="ghost" size="xs" onClick={clearRestartRequired}>
                  {t('plugin_management.restart_dismiss')}
                </Button>
              }
            >
              {t('plugin_management.restart_required_banner', { plugins: restartNames.join(', ') })}
            </PluginNotice>
          ) : null}
        </div>
      ) : null}

      {data ? (
        <PluginSummaryCards cards={summaryCards} ariaLabel={t('plugin_management.summary_label')} />
      ) : null}

      <div className={styles.toolbar}>
        <SearchField
          ref={searchInputRef}
          value={filter}
          onChange={setFilter}
          placeholder={t('plugin_management.search_placeholder')}
          ariaLabel={t('plugin_management.search_label')}
          disabled={loading && !data}
        />
        <div
          className={styles.filterChips}
          role="group"
          aria-label={t('plugin_management.filter_label')}
        >
          {STATUS_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.filterChip} ${statusFilter === key ? styles.filterChipActive : ''}`}
              onClick={() => setStatusFilter(key)}
              aria-pressed={statusFilter === key}
            >
              {t(`plugin_management.filter_${key}`)}
              <span className={styles.filterChipCount}>{filterCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className={styles.list} aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className={styles.skeletonRow}>
              <Skeleton width={40} height={40} rounded={10} />
              <div className={styles.skeletonText}>
                <Skeleton width="38%" height={14} />
                <Skeleton width="62%" height={10} />
              </div>
            </div>
          ))}
        </div>
      ) : plugins.length === 0 ? (
        error ? null : (
          <EmptyState
            title={t('plugin_management.no_plugins')}
            description={t('plugin_management.no_plugins_desc')}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/plugin-store')}>
                <IconSidebarStore size={16} />
                {t('plugin_management.browse_store')}
              </Button>
            }
          />
        )
      ) : visiblePlugins.length === 0 ? (
        <EmptyState
          title={t('plugin_management.no_matches')}
          description={t('plugin_management.no_matches_desc')}
          action={
            hasActiveFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFilter('');
                  setStatusFilter('all');
                  searchInputRef.current?.focus();
                }}
              >
                {t('plugin_management.clear_filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={styles.list}>{visiblePlugins.map(renderRow)}</div>
      )}

      {data ? (
        <p className={styles.footerLine}>
          {t('plugin_management.plugins_dir')}: <code>{data.pluginsDir || 'plugins'}</code>
        </p>
      ) : null}

      <Sheet
        open={Boolean(editingPlugin)}
        onClose={closeConfigSheet}
        confirmClose={confirmSheetClose}
        size="lg"
        title={
          editingPlugin ? (
            <>
              {t('plugin_management.config_title', { name: getPluginTitle(editingPlugin) })}
              {draftDirty ? (
                <span className={styles.dirtyMarker} title={t('plugin_management.unsaved_marker')}>
                  <span aria-hidden="true"> •</span>
                  <span className={styles.srOnly}> {t('plugin_management.unsaved_marker')}</span>
                </span>
              ) : null}
            </>
          ) : (
            t('plugin_management.edit_config')
          )
        }
        description={
          editingPlugin ? (
            <span className={styles.sheetMeta}>
              {editingPlugin.id}
              {editingPlugin.path ? ` · ${editingPlugin.path}` : ''}
            </span>
          ) : undefined
        }
        closeDisabled={savingConfig}
        footer={
          <div className={styles.sheetFooter}>
            <Button
              variant="secondary"
              onClick={() => {
                void confirmSheetClose().then((ok) => {
                  if (ok) closeConfigSheet();
                });
              }}
              disabled={savingConfig}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSaveConfig}
              loading={savingConfig}
              disabled={!draft || draftLoading}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {editingPlugin && draftError ? (
          <ErrorBanner
            message={draftError}
            onRetry={() => void loadDraft(editingPlugin)}
            retrying={draftLoading}
          />
        ) : null}
        {editingPlugin && !draft && !draftError ? (
          <div className={styles.sheetSkeleton} aria-busy="true">
            <Skeleton width="30%" height={16} />
            <Skeleton height={52} />
            <Skeleton height={44} />
            <Skeleton width="30%" height={16} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        ) : null}
        {draft && editingPlugin ? (
          <div className={styles.configForm}>
            {sheetNotice ? <PluginNotice>{sheetNotice}</PluginNotice> : null}
            <section className={styles.formSection}>
              <h3>{t('plugin_management.base_settings')}</h3>
              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>{t('plugin_management.enabled')}</div>
                  <div className={styles.fieldDescription}>
                    {t('plugin_management.enabled_hint')}
                  </div>
                </div>
                <ToggleSwitch
                  checked={draft.enabled}
                  onChange={(enabled) =>
                    updateDraft((current) => ({ ...current, enabled, enabledTouched: true }))
                  }
                  ariaLabel={t('plugin_management.enabled')}
                />
              </div>
              <Input
                label={t('plugin_management.priority')}
                value={draft.priority}
                onChange={handlePriorityChange}
                inputMode="numeric"
                error={draft.errors.priority || undefined}
              />
            </section>

            <section className={styles.formSection}>
              <h3>{t('plugin_management.config_fields')}</h3>
              {editingPlugin.configFields.length > 0 ? (
                editingPlugin.configFields.map((field) => renderFieldEditor(field))
              ) : (
                <div className={styles.emptyConfig}>{t('plugin_management.no_config_fields')}</div>
              )}
            </section>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
