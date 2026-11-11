import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBookOpen,
  IconCode,
  IconExternalLink,
  IconGithub,
  IconRefreshCw,
} from '@/components/ui/icons';
import { useRevealGroup } from '@/hooks/motion';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { copyToClipboard } from '@/utils/clipboard';
import { formatDateTimeValue, maskApiKey } from '@/utils/format';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconDevinLight from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  devin: { light: iconDevinLight, dark: iconDevinDark },
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  meta: iconMeta,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const RELEASES_URL = 'https://github.com/router-for-me/CLIProxyAPI/releases';

const LINKS = [
  {
    key: 'main',
    href: 'https://github.com/router-for-me/CLIProxyAPI',
    labelKey: 'system_info.link_main_repo',
    Icon: IconGithub,
  },
  {
    key: 'webui',
    href: 'https://github.com/router-for-me/Cli-Proxy-API-Management-Center',
    labelKey: 'system_info.link_webui_repo',
    Icon: IconCode,
  },
  {
    key: 'docs',
    href: 'https://help.router-for.me/',
    labelKey: 'system_info.link_docs',
    Icon: IconBookOpen,
  },
] as const;

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

interface UpdateCheckState {
  status: 'idle' | 'checking' | 'latest' | 'update' | 'unknown' | 'error';
  latest: string;
  checkedAt: number | null;
  message: string;
}

const IDLE_UPDATE_CHECK: UpdateCheckState = {
  status: 'idle',
  latest: '',
  checkedAt: null,
  message: '',
};

// Survives navigation within the session so the result does not vanish when leaving the page.
let updateCheckCache: UpdateCheckState = IDLE_UPDATE_CHECK;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const logout = useAuthStore((state) => state.logout);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);
  const headerRef = useRevealGroup<HTMLElement>();

  const [modelsKey, setModelsKey] = useState('');
  const [modelsKeyMissing, setModelsKeyMissing] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [allGroupsOpen, setAllGroupsOpen] = useState<boolean | null>(null);
  const [groupsResetKey, setGroupsResetKey] = useState(0);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>(updateCheckCache);

  const connected = connectionStatus === 'connected';
  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const filteredGroups = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return groupedModels;
    return groupedModels
      .map((group) => ({
        ...group,
        items: group.items.filter((model) =>
          `${model.name} ${model.alias ?? ''} ${model.description ?? ''}`
            .toLowerCase()
            .includes(query)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedModels, modelSearch]);

  const requestLogEnabled = config?.requestLog ?? false;
  const canEditRequestLog = connected && Boolean(config);

  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = serverVersion || t('system_info.version_unknown');
  const buildTime =
    formatDateTimeValue(serverBuildDate, i18n.language) || t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (!connected || !apiBase) {
      setModelsFetchError(t('notification.connection_required'));
      return;
    }
    setModelsFetchError('');
    try {
      const apiKeys = await resolveApiKeysForModels({ force: forceRefresh });
      const primaryKey = apiKeys[0] ?? '';
      setModelsKey(primaryKey);
      setModelsKeyMissing(apiKeys.length === 0);
      await fetchModelsFromStore(apiBase, primaryKey || undefined, forceRefresh);
    } catch (err: unknown) {
      const suffix = errorText(err) ? `: ${errorText(err)}` : '';
      setModelsFetchError(`${t('system_info.models_error')}${suffix}`);
    }
  };

  const handleCopyModel = async (name: string) => {
    const ok = await copyToClipboard(name);
    showNotification(
      ok ? t('system_info.model_copied', { name }) : t('system_info.model_copy_failed'),
      ok ? 'success' : 'error'
    );
  };

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title'),
      message: t('system_info.clear_login_confirm'),
      variant: 'danger',
      confirmText: t('system_info.clear_login_button'),
      onConfirm: () => {
        logout();
        if (typeof localStorage === 'undefined') return;
        const keysToRemove = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  const handleRequestLogChange = async (next: boolean) => {
    if (!canEditRequestLog || requestLogSaving) return;
    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', next);
    try {
      await configApi.updateRequestLog(next);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
    } catch (err: unknown) {
      updateConfigValue('request-log', previous);
      const message = errorText(err);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const applyUpdateCheck = (next: UpdateCheckState) => {
    updateCheckCache = next;
    setUpdateCheck(next);
  };

  const handleVersionCheck = useCallback(async () => {
    applyUpdateCheck({ ...updateCheckCache, status: 'checking', message: '' });
    const checkedAt = Date.now();
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      if (!latest) {
        applyUpdateCheck({
          status: 'error',
          latest: '',
          checkedAt,
          message: t('system_info.version_check_error'),
        });
        return;
      }
      const comparison = compareVersions(latest, serverVersion);
      if (comparison === null) {
        applyUpdateCheck({
          status: 'unknown',
          latest,
          checkedAt,
          message: t('system_info.version_current_missing'),
        });
        return;
      }
      applyUpdateCheck({
        status: comparison > 0 ? 'update' : 'latest',
        latest,
        checkedAt,
        message:
          comparison > 0
            ? t('system_info.version_update_available', { version: latest })
            : t('system_info.version_is_latest'),
      });
    } catch (err: unknown) {
      const suffix = errorText(err) ? `: ${errorText(err)}` : '';
      applyUpdateCheck({
        status: 'error',
        latest: '',
        checkedAt,
        message: `${t('system_info.version_check_error')}${suffix}`,
      });
    }
  }, [serverVersion, t]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus, apiBase]);

  const meta: PageHeaderMetaSegment[] = [
    { key: 'ui', text: /^v?\d/i.test(appVersion) ? `UI v${appVersion.replace(/^v/i, '')}` : `UI ${appVersion}` },
    {
      key: 'api',
      text: `API ${serverVersion ? `v${serverVersion.replace(/^v/i, '')}` : t('system_info.version_unknown')}`,
    },
    {
      key: 'conn',
      text: t(`common.${connectionStatus}_status`),
      tone: connected ? 'ok' : 'attention',
    },
  ];

  const checkedAtText = updateCheck.checkedAt
    ? formatDateTimeValue(new Date(updateCheck.checkedAt).toISOString(), i18n.language)
    : '';
  const updateToneClass =
    updateCheck.status === 'update'
      ? styles.checkUpdate
      : updateCheck.status === 'latest'
        ? styles.checkLatest
        : updateCheck.status === 'error'
          ? styles.checkError
          : styles.checkMuted;

  const modelsEmptyTitle = modelsKeyMissing
    ? t('system_info.models_empty_no_key')
    : t('system_info.models_empty');
  const modelsEmptyDesc = modelsKeyMissing
    ? t('system_info.models_empty_no_key_desc')
    : t('system_info.models_empty_desc');

  return (
    <div className={styles.page}>
      <PageHeader revealRef={headerRef} title={t('system_info.title')} meta={meta} />

      <div className={styles.grid}>
        <Card className={styles.aboutCard}>
          <div className={styles.aboutHeader}>
            <img src={INLINE_LOGO_JPEG} alt="" className={styles.aboutLogo} />
            <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
          </div>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>{t('system_info.tile_ui')}</div>
              <div className={styles.tileValue}>{appVersion}</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('system_info.tile_api')}</div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleVersionCheck()}
                  loading={updateCheck.status === 'checking'}
                >
                  {t('system_info.version_check_button')}
                </Button>
              </div>
              <div className={styles.tileValue}>{apiVersion}</div>
              <div className={styles.tileSub}>
                {t('system_info.build_time')}: {buildTime}
              </div>
              {updateCheck.status !== 'idle' && updateCheck.status !== 'checking' ? (
                <div className={`${styles.checkResult} ${updateToneClass}`} role="status">
                  <span>{updateCheck.message}</span>
                  {updateCheck.status === 'update' ? (
                    <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                      {t('system_info.view_release')}
                      <IconExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                  {checkedAtText ? (
                    <span className={styles.checkedAt}>
                      {t('system_info.last_checked', { time: checkedAtText })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.links}>
            {LINKS.map(({ key, href, labelKey, Icon }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                <Icon size={14} aria-hidden="true" />
                {t(labelKey)}
                <IconExternalLink size={11} aria-hidden="true" />
              </a>
            ))}
          </div>
        </Card>

        <Card title={t('system_info.session_title')} className={styles.sessionCard}>
          <div className={styles.sessionRow}>
            <span
              className={`${styles.statusDot} ${connected ? styles.statusDotOn : styles.statusDotOff}`}
              aria-hidden="true"
            />
            <span className={styles.sessionStatus}>{t(`common.${connectionStatus}_status`)}</span>
            <code className={styles.sessionBase}>{apiBase || '-'}</code>
          </div>
          <p className={styles.sectionDescription}>{t('system_info.session_desc')}</p>
          <div className={styles.sessionActions}>
            <Button variant="secondary" size="sm" onClick={logout}>
              {t('common.logout')}
            </Button>
            <Button variant="danger-quiet" size="sm" onClick={handleClearLoginStorage}>
              {t('system_info.clear_login_button')}
            </Button>
          </div>
        </Card>

        <Card title={t('system_info.diagnostics_title')} className={styles.diagnosticsCard}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleText}>
              <div className={styles.toggleLabel}>{t('basic_settings.request_log_enable')}</div>
              <div className={styles.toggleHint}>{t('basic_settings.request_log_warning')}</div>
            </div>
            <ToggleSwitch
              checked={requestLogEnabled}
              onChange={(value) => void handleRequestLogChange(value)}
              disabled={!canEditRequestLog || requestLogSaving}
              ariaLabel={t('basic_settings.request_log_enable')}
            />
          </div>
        </Card>

        <Card
          className={styles.modelsCard}
          title={
            <span className={styles.modelsTitle}>
              {t('system_info.models_title')}
              {models.length > 0 ? (
                <span className={styles.modelsTotal}>{models.length}</span>
              ) : null}
            </span>
          }
          extra={
            <div className={styles.modelsExtra}>
              {groupedModels.length > 1 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setAllGroupsOpen((current) => !(current ?? false));
                    setGroupsResetKey((value) => value + 1);
                  }}
                >
                  {t(allGroupsOpen ? 'system_info.collapse_all' : 'system_info.expand_all')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchModels({ forceRefresh: true })}
                loading={modelsLoading}
                disabled={!connected}
              >
                <IconRefreshCw size={14} />
                {t('common.refresh')}
              </Button>
            </div>
          }
        >
          <p className={styles.sectionDescription}>
            {t('system_info.models_desc')}
            {modelsKey ? (
              <>
                {' '}
                <span className={styles.viaKey}>
                  {t('system_info.models_via_key', { key: maskApiKey(modelsKey) })}
                </span>
              </>
            ) : null}
          </p>

          {modelsFetchError || modelsError ? (
            <ErrorBanner
              message={modelsFetchError || modelsError || ''}
              onRetry={connected ? () => fetchModels({ forceRefresh: true }) : undefined}
              retrying={modelsLoading}
            />
          ) : null}

          {modelsLoading && models.length === 0 ? (
            <div className={styles.modelsSkeleton} aria-busy="true">
              <Skeleton height={36} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : models.length === 0 ? (
            modelsFetchError || modelsError ? null : (
              <div className={styles.modelsEmpty}>
                <strong>{modelsEmptyTitle}</strong>
                <span>{modelsEmptyDesc}</span>
              </div>
            )
          ) : (
            <>
              <SearchField
                value={modelSearch}
                onChange={setModelSearch}
                placeholder={t('system_info.models_search_placeholder')}
                ariaLabel={t('system_info.models_search_label')}
              />
              {filteredGroups.length === 0 ? (
                <div className={styles.modelsEmpty}>
                  <strong>{t('system_info.models_no_matches')}</strong>
                </div>
              ) : (
                <div className={styles.groups} key={groupsResetKey}>
                  {filteredGroups.map((group, index) => {
                    const iconSrc = getIconForCategory(group.id);
                    return (
                      <Collapsible
                        key={group.id}
                        flush
                        defaultOpen={allGroupsOpen ?? (index === 0 || Boolean(modelSearch.trim()))}
                        label={
                          <span className={styles.groupTitle}>
                            {iconSrc ? (
                              <img src={iconSrc} alt="" className={styles.groupIcon} />
                            ) : null}
                            {group.label}
                          </span>
                        }
                        badge={group.items.length}
                      >
                        <div className={styles.modelTags}>
                          {group.items.map((model) => (
                            <button
                              key={`${model.name}-${model.alias ?? 'default'}`}
                              type="button"
                              className={styles.modelTag}
                              title={t('system_info.model_copy_hint', { name: model.name })}
                              onClick={() => void handleCopyModel(model.name)}
                            >
                              <span className={styles.modelName}>{model.name}</span>
                              {model.alias ? (
                                <span className={styles.modelAlias}>{model.alias}</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
