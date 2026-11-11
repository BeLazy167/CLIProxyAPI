import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { Input } from '@/components/ui/Input';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader/PageHeader';
import { IconCheckCircle2, IconPlug } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { oauthApi, pluginsApi, type BuiltInOAuthProvider } from '@/services/api';
import { authFilesApi } from '@/services/api/authFiles';
import { vertexApi, type VertexImportResponse } from '@/services/api/vertex';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import {
  AUTH_FILES_CHANGED_EVENT,
  notifyAuthFilesChanged,
} from '@/features/authFiles/authFilesEvents';
import { getPluginTitle, resolvePluginAssetURL } from '@/features/plugins/pluginResources';
import {
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
} from '@/features/providers/kimi';
import { maskEmails } from '@/features/quota/maskIdentity';
import type { AuthFileItem, PluginListEntry } from '@/types';
import { createOAuthAttempts, type OAuthAttempt } from './oauthAttempts';
import {
  authFileKey,
  authFileKeyForProvider,
  findCreatedCredential,
  formatClock,
  nowMs,
} from './oauthFlow';
import { validateDevinCallback } from './devinOAuth';
import styles from './OAuthPage.module.scss';
import iconMeta from '@/assets/icons/meta.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDevin from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';

interface ProviderState {
  url?: string;
  userCode?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  cancelling?: boolean;
  cancelError?: string;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
  /** The user opened or closed the callback section; overrides auto-expand. */
  callbackOpen?: boolean;
  startedAt?: number;
  /** Provider-reported or known link expiry; absent means show elapsed time. */
  expiresAt?: number;
  /** Credential names before this attempt, to recognise the one it creates. */
  knownFiles?: string[];
  /** Masked identity of the credential this attempt created. */
  createdName?: string;
}

interface VertexImportResult {
  projectId?: string;
  email?: string;
  location?: string;
  authFile?: string;
}

interface VertexImportState {
  file?: File;
  fileName: string;
  location: string;
  loading: boolean;
  error?: string;
  result?: VertexImportResult;
}

interface BuiltInOAuthProviderCard {
  kind: 'builtin';
  id: BuiltInOAuthProvider;
  titleKey: string;
  icon: string | { light: string; dark: string };
}

interface PluginOAuthProviderCard {
  kind: 'plugin';
  id: string;
  title: string;
  icon: string;
}

type OAuthProviderCard = BuiltInOAuthProviderCard | PluginOAuthProviderCard;

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

const PROVIDERS: BuiltInOAuthProviderCard[] = [
  {
    kind: 'builtin',
    id: 'meta',
    titleKey: 'auth_login.meta_oauth_title',
    icon: iconMeta,
  },
  {
    kind: 'builtin',
    id: 'kimi',
    titleKey: 'auth_login.kimi_oauth_title',
    icon: { light: iconKimiDark, dark: iconKimiLight },
  },
  {
    kind: 'builtin',
    id: 'kimi-ai',
    titleKey: 'auth_login.kimi_ai_oauth_title',
    icon: { light: iconKimiDark, dark: iconKimiLight },
  },
  {
    kind: 'builtin',
    id: 'codex',
    titleKey: 'auth_login.codex_oauth_title',
    icon: iconCodex,
  },
  {
    kind: 'builtin',
    id: 'anthropic',
    titleKey: 'auth_login.anthropic_oauth_title',
    icon: iconClaude,
  },
  {
    kind: 'builtin',
    id: 'antigravity',
    titleKey: 'auth_login.antigravity_oauth_title',
    icon: iconAntigravity,
  },
  {
    kind: 'builtin',
    id: 'xai',
    titleKey: 'auth_login.xai_oauth_title',
    icon: { light: iconGrok, dark: iconGrokDark },
  },
  {
    kind: 'builtin',
    id: 'devin',
    titleKey: 'auth_login.devin_oauth_title',
    icon: { light: iconDevin, dark: iconDevinDark },
  },
];

const BUILTIN_PROVIDER_IDS = new Set<string>(PROVIDERS.map((provider) => provider.id));
const CALLBACK_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai', 'devin']);
const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
/** Devin device sessions expire server-side after five minutes. */
const KNOWN_EXPIRY_MS: Record<string, number> = { devin: 5 * 60 * 1000 };
/** After this long without a callback the browser probably cannot reach us. */
const CALLBACK_AUTO_EXPAND_MS = 20 * 1000;
const getProviderI18nPrefix = (provider: string) => provider.replace('-', '_');
const getAuthKey = (provider: string, suffix: string) =>
  `auth_login.${getProviderI18nPrefix(provider)}_${suffix}`;

const getIcon = (icon: string | { light: string; dark: string }, theme: 'light' | 'dark') => {
  return typeof icon === 'string' ? icon : icon[theme];
};

function PluginOAuthIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" className={styles.providerIcon} onError={() => setFailed(true)} />;
  }
  return (
    <span className={styles.providerIconFallback} aria-hidden="true">
      <IconPlug size={18} />
    </span>
  );
}

function OAuthProviderIcon({
  provider,
  theme,
}: {
  provider: OAuthProviderCard;
  theme: 'light' | 'dark';
}) {
  if (provider.kind === 'plugin') {
    return <PluginOAuthIcon src={provider.icon} />;
  }
  return <img src={getIcon(provider.icon, theme)} alt="" className={styles.providerIcon} />;
}

const buildPluginOAuthProviderCards = (
  plugins: PluginListEntry[],
  apiBase: string
): PluginOAuthProviderCard[] => {
  const seenProviders = new Set(BUILTIN_PROVIDER_IDS);
  return plugins.flatMap((plugin) => {
    const provider = plugin.oauthProvider;
    if (
      !plugin.supportsOAuth ||
      !plugin.effectiveEnabled ||
      !provider ||
      seenProviders.has(provider)
    ) {
      return [];
    }
    seenProviders.add(provider);
    return [
      {
        kind: 'plugin' as const,
        id: provider,
        title: getPluginTitle(plugin),
        icon: resolvePluginAssetURL(plugin.logo || plugin.metadata?.logo || '', apiBase),
      },
    ];
  });
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const readQueryLikeCallbackInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams =
    queryStart >= 0
      ? trimmed.slice(queryStart + 1)
      : hashStart >= 0
        ? trimmed.slice(hashStart + 1)
        : trimmed;

  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
};

const extractDisplayedXaiCode = (value: string): string => {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i);
  return (codeMatch?.[1] ?? trimmed).trim();
};

const buildXaiCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteUrl(trimmed)) return trimmed;

  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const code = params.get('code')?.trim();
    const error = params.get('error')?.trim();
    const errorDescription = params.get('error_description')?.trim();
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;

    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    if (code) callbackUrl.searchParams.set('code', code);
    if (error) callbackUrl.searchParams.set('error', error);
    if (errorDescription) callbackUrl.searchParams.set('error_description', errorDescription);
    return callbackUrl.toString();
  }

  const code = extractDisplayedXaiCode(trimmed);
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;

  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
};

const resolveCallbackUrl = (provider: string, input: string, state?: string): string | null => {
  if (provider !== 'xai') return input.trim();
  return buildXaiCallbackUrl(input, state);
};

export function OAuthPage() {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [states, setStates] = useState<Record<string, ProviderState>>({});
  const [pluginProviders, setPluginProviders] = useState<PluginOAuthProviderCard[]>([]);
  const [authFiles, setAuthFiles] = useState<AuthFileItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [vertexOpen, setVertexOpen] = useState(false);
  const [vertexState, setVertexState] = useState<VertexImportState>({
    fileName: '',
    location: '',
    loading: false,
  });
  const attempts = useRef(
    createOAuthAttempts({
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (timer) => window.clearTimeout(timer),
    })
  );
  const vertexFileInputRef = useRef<HTMLInputElement | null>(null);

  const clearTimers = useCallback(() => {
    attempts.current.invalidateAll();
  }, []);

  useEffect(() => {
    // Invalidate synchronously on connection changes, including a new key on
    // the same server. Never send cleanup requests through the new connection.
    const unsubscribe = useAuthStore.subscribe((current, previous) => {
      if (
        current.apiBase !== previous.apiBase ||
        current.managementKey !== previous.managementKey ||
        current.isAuthenticated !== previous.isAuthenticated
      ) {
        clearTimers();
        setStates({});
      }
    });
    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    let cancelled = false;

    const loadPluginProviders = async () => {
      try {
        const response = await pluginsApi.list();
        if (!cancelled) {
          setPluginProviders(buildPluginOAuthProviderCards(response.plugins, apiBase));
        }
      } catch {
        if (!cancelled) {
          setPluginProviders([]);
        }
      }
    };

    void loadPluginProviders();

    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const loadAuthFiles = useCallback(async (): Promise<AuthFileItem[] | null> => {
    try {
      const response = await authFilesApi.list();
      setAuthFiles(response.files);
      return response.files;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void loadAuthFiles();
    const handleChanged = () => void loadAuthFiles();
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(AUTH_FILES_CHANGED_EVENT, handleChanged);
  }, [loadAuthFiles]);

  const anyWaiting = Object.values(states).some((state) => state.status === 'waiting');
  useEffect(() => {
    if (!anyWaiting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyWaiting]);

  const providerCards = useMemo<OAuthProviderCard[]>(
    () => [...PROVIDERS, ...pluginProviders],
    [pluginProviders]
  );

  const connectedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of authFiles ?? []) {
      const key = authFileKey(file);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [authFiles]);

  const getProviderTitleText = (provider: OAuthProviderCard) =>
    provider.kind === 'plugin'
      ? t('auth_login.plugin_oauth_title', { name: provider.title })
      : t(provider.titleKey);

  const getProviderText = (provider: OAuthProviderCard, suffix: string) =>
    provider.kind === 'plugin'
      ? t(`auth_login.plugin_${suffix}`, { name: provider.title })
      : t(getAuthKey(provider.id, suffix));

  const getProviderTextByID = (provider: string, suffix: string) => {
    const card = providerCards.find((item) => item.id === provider);
    return card ? getProviderText(card, suffix) : t(getAuthKey(provider, suffix));
  };

  const updateProviderState = (provider: string, next: Partial<ProviderState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next },
    }));
  };

  const resetProviderAttempt = (provider: string) => {
    attempts.current.get(provider)?.invalidate();
    setStates((prev) => {
      return {
        ...prev,
        [provider]: {},
      };
    });
  };

  const completeProviderAuth = async (
    provider: string,
    attempt: OAuthAttempt,
    knownFiles: readonly string[]
  ) => {
    notifyAuthFilesChanged();
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'success',
      error: undefined,
      polling: false,
      cancelling: false,
      cancelError: undefined,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
      createdName: undefined,
    });
    const files = await loadAuthFiles();
    if (!files || !attempt.isCurrent()) return;
    const created = findCreatedCredential(knownFiles, files, provider);
    if (created) updateProviderState(provider, { createdName: maskEmails(created) });
  };

  const startPolling = (
    provider: string,
    state: string,
    attempt: OAuthAttempt,
    knownFiles: readonly string[]
  ) => {
    attempt.poll(
      () => oauthApi.getAuthStatus(state, attempt.signal),
      (res) => {
        if (res.status === 'ok') {
          void completeProviderAuth(provider, attempt, knownFiles);
          showNotification(getProviderTextByID(provider, 'oauth_status_success'), 'success');
        } else if (res.status === 'error') {
          if (provider === 'devin') {
            // Expired, denied and cancelled states cannot accept another callback.
            attempt.invalidate();
            updateProviderState(provider, {
              url: undefined,
              state: undefined,
              callbackUrl: '',
              callbackSubmitting: false,
              callbackStatus: undefined,
              callbackError: undefined,
            });
          }
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          showNotification(
            `${getProviderTextByID(provider, 'oauth_status_error')} ${res.error || ''}`,
            'error'
          );
        }
        return res.status === 'wait';
      },
      (err) => {
        updateProviderState(provider, {
          status: 'error',
          error: getErrorMessage(err),
          polling: false,
        });
      },
      3000
    );
  };

  const cancelAuth = async (provider: string) => {
    const state = states[provider]?.state;
    if (states[provider]?.cancelling) return;
    if (provider !== 'devin') {
      // Only Devin sessions report cancellation; for the rest stop polling here
      // and let the server drop the session on a best-effort basis.
      resetProviderAttempt(provider);
      if (state) void oauthApi.cancelSession(state).catch(() => undefined);
      return;
    }
    if (!state) return;
    // Replace the attempt before DELETE so late polls/callback submissions cannot
    // overwrite the cancellation result or a subsequent login.
    const attempt = attempts.current.begin(provider);
    updateProviderState(provider, {
      cancelling: true,
      cancelError: undefined,
      polling: true,
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    try {
      const result = await oauthApi.cancelSession(state, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (result.cancelled) {
        resetProviderAttempt(provider);
        showNotification(t('auth_login.devin_oauth_cancelled'), 'success');
        return;
      }
      // A completed or expired session returns cancelled=false. Read its real
      // status rather than claiming cancellation or losing a completed login.
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const message = getErrorMessage(err);
      updateProviderState(provider, { cancelError: message });
      showNotification(`${t('auth_login.devin_oauth_cancel_error')} ${message}`, 'error');
    }
    updateProviderState(provider, {
      cancelling: false,
      status: 'waiting',
      error: undefined,
    });
    startPolling(provider, state, attempt, states[provider]?.knownFiles ?? []);
  };

  const startAuth = async (provider: string) => {
    // A network error can stop polling while the server is still waiting. Require
    // explicit cancellation before replacing that Devin session.
    if (provider === 'devin' && states[provider]?.state) return;
    const attempt = attempts.current.begin(provider);
    const startedAt = nowMs();
    const knownFiles = (authFiles ?? []).map((file) => file.name);
    updateProviderState(provider, {
      url: undefined,
      userCode: undefined,
      state: undefined,
      status: 'waiting',
      polling: true,
      cancelling: false,
      cancelError: undefined,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackOpen: undefined,
      startedAt,
      expiresAt: undefined,
      knownFiles,
      createdName: undefined,
    });
    try {
      const res = await oauthApi.startAuth(provider, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (!res.state) {
        const message = t('auth_login.missing_state');
        updateProviderState(provider, {
          url: res.url,
          state: undefined,
          status: 'error',
          error: message,
          polling: false,
        });
        showNotification(message, 'error');
        return;
      }
      const expiryMs =
        typeof res.expires_in === 'number' && res.expires_in > 0
          ? res.expires_in * 1000
          : KNOWN_EXPIRY_MS[provider];
      updateProviderState(provider, {
        url: res.url,
        userCode: res.user_code,
        state: res.state,
        status: 'waiting',
        polling: true,
        expiresAt: expiryMs ? startedAt + expiryMs : undefined,
      });
      startPolling(provider, res.state, attempt, knownFiles);
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const message = getErrorMessage(err);
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      showNotification(
        `${getProviderTextByID(provider, 'oauth_start_error')}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const submitCallback = async (provider: string) => {
    const attempt = attempts.current.get(provider);
    if (!attempt?.isCurrent()) return;
    if (
      provider === 'devin' &&
      (states[provider]?.cancelling || states[provider]?.status !== 'waiting')
    ) {
      return;
    }
    const callbackInput = (states[provider]?.callbackUrl || '').trim();
    if (!callbackInput) {
      showNotification(
        t(
          provider === 'xai'
            ? 'auth_login.xai_callback_required'
            : 'auth_login.oauth_callback_required'
        ),
        'warning'
      );
      return;
    }
    if (provider === 'devin') {
      const callbackError = validateDevinCallback(callbackInput, states[provider]?.state);
      if (callbackError) {
        showNotification(t(`auth_login.devin_callback_${callbackError}`), 'warning');
        return;
      }
    }
    const redirectUrl = resolveCallbackUrl(provider, callbackInput, states[provider]?.state);
    if (!redirectUrl) {
      showNotification(
        t(
          provider === 'xai' ? 'auth_login.xai_callback_state_missing' : 'auth_login.missing_state'
        ),
        'warning'
      );
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl, attempt.signal);
      if (!attempt.isCurrent()) return;
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404 ? t('auth_login.oauth_callback_upgrade_hint') : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage,
      });
      const notificationMessage = errorMessage
        ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
        : t('auth_login.oauth_callback_error');
      showNotification(notificationMessage, 'error');
    }
  };

  const handleVertexFilePick = () => {
    vertexFileInputRef.current?.click();
  };

  const handleVertexFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      showNotification(t('vertex_import.file_required'), 'warning');
      event.target.value = '';
      return;
    }
    setVertexState((prev) => ({
      ...prev,
      file,
      fileName: file.name,
      error: undefined,
      result: undefined,
    }));
    event.target.value = '';
  };

  const handleVertexImport = async () => {
    if (!vertexState.file) {
      const message = t('vertex_import.file_required');
      setVertexState((prev) => ({ ...prev, error: message }));
      showNotification(message, 'warning');
      return;
    }
    const location = vertexState.location.trim();
    setVertexState((prev) => ({ ...prev, loading: true, error: undefined, result: undefined }));
    try {
      const res: VertexImportResponse = await vertexApi.importCredential(
        vertexState.file,
        location || undefined
      );
      const result: VertexImportResult = {
        projectId: res.project_id,
        email: res.email,
        location: res.location,
        authFile: res['auth-file'] ?? res.auth_file,
      };
      setVertexState((prev) => ({ ...prev, loading: false, result }));
      notifyAuthFilesChanged();
      showNotification(t('vertex_import.success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setVertexState((prev) => ({
        ...prev,
        loading: false,
        error: message || t('notification.upload_failed'),
      }));
      const notification = message
        ? `${t('notification.upload_failed')}: ${message}`
        : t('notification.upload_failed');
      showNotification(notification, 'error');
    }
  };

  const renderWaitingLine = (provider: OAuthProviderCard, state: ProviderState) => {
    const startedAt = state.startedAt ?? now;
    const remaining = state.expiresAt !== undefined ? state.expiresAt - now : undefined;
    const text =
      remaining === undefined
        ? t('auth_login.waiting_elapsed', { time: formatClock(now - startedAt) })
        : remaining > 0
          ? t('auth_login.waiting_left', { time: formatClock(remaining) })
          : t('auth_login.waiting_expired');
    return (
      <div className={styles.waitingRow} role="status">
        <span className={styles.waitingDot} aria-hidden="true" />
        <span className={styles.waitingText}>{text}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => cancelAuth(provider.id)}
          loading={state.cancelling}
        >
          {t('auth_login.cancel_login')}
        </Button>
      </div>
    );
  };

  const renderSteps = (provider: OAuthProviderCard, state: ProviderState) => {
    const canSubmitCallback =
      (provider.kind === 'plugin' || CALLBACK_SUPPORTED.has(provider.id)) && Boolean(state.url);
    const callbackLocked =
      provider.id === 'devin' && (state.cancelling || state.status !== 'waiting');
    const waitedMs = now - (state.startedAt ?? now);
    const callbackOpen =
      state.callbackOpen ?? (state.status === 'waiting' && waitedMs >= CALLBACK_AUTO_EXPAND_MS);

    return (
      <ol className={styles.steps}>
        <li className={styles.step}>
          <div className={styles.stepTitle}>{t('auth_login.step_open_link')}</div>
          {state.url ? (
            <>
              <code className={styles.authUrlValue}>{state.url}</code>
              {state.userCode && (
                <div className={styles.deviceCode}>
                  <span className={styles.deviceCodeLabel}>
                    {t('auth_login.device_code_label')}
                  </span>
                  <code className={styles.deviceCodeValue}>{state.userCode}</code>
                  <Button variant="secondary" size="xs" onClick={() => copyLink(state.userCode)}>
                    {t('auth_login.device_code_copy')}
                  </Button>
                </div>
              )}
              <div className={styles.stepActions}>
                <Button variant="secondary" size="sm" onClick={() => copyLink(state.url!)}>
                  {getProviderText(provider, 'copy_link')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
                >
                  {getProviderText(provider, 'open_link')}
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.stepHint}>{t('auth_login.step_requesting_link')}</div>
          )}
        </li>
        <li className={styles.step}>
          <div className={styles.stepTitle}>{t('auth_login.step_authorize')}</div>
        </li>
        {canSubmitCallback && (
          <li className={styles.step}>
            <Collapsible
              flush
              label={t('auth_login.step_callback')}
              open={callbackOpen}
              onToggle={(event) =>
                updateProviderState(provider.id, { callbackOpen: event.currentTarget.open })
              }
            >
              <div className={styles.callbackSection}>
                <Input
                  aria-label={t(
                    provider.id === 'xai'
                      ? 'auth_login.xai_callback_label'
                      : 'auth_login.oauth_callback_label'
                  )}
                  hint={t(
                    provider.id === 'xai'
                      ? 'auth_login.xai_callback_hint'
                      : provider.id === 'devin'
                        ? 'auth_login.devin_callback_hint'
                        : 'auth_login.oauth_callback_hint'
                  )}
                  disabled={callbackLocked}
                  value={state.callbackUrl || ''}
                  onChange={(e) =>
                    updateProviderState(provider.id, {
                      callbackUrl: e.target.value,
                      callbackStatus: undefined,
                      callbackError: undefined,
                    })
                  }
                  placeholder={t(
                    provider.id === 'xai'
                      ? 'auth_login.xai_callback_placeholder'
                      : provider.id === 'devin'
                        ? 'auth_login.devin_callback_placeholder'
                        : 'auth_login.oauth_callback_placeholder'
                  )}
                />
                <div className={styles.stepActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => submitCallback(provider.id)}
                    loading={state.callbackSubmitting}
                    disabled={callbackLocked}
                  >
                    {t('auth_login.oauth_callback_button')}
                  </Button>
                </div>
                {state.callbackStatus === 'success' && state.status === 'waiting' && (
                  <div className="status-badge success">
                    {t('auth_login.oauth_callback_status_success')}
                  </div>
                )}
                {state.callbackStatus === 'error' && (
                  <div className="status-badge error" role="alert">
                    {t('auth_login.oauth_callback_status_error')} {state.callbackError || ''}
                  </div>
                )}
              </div>
            </Collapsible>
          </li>
        )}
      </ol>
    );
  };

  const renderPanel = (provider: OAuthProviderCard, state: ProviderState) => {
    if (state.status === 'success') {
      return (
        <div className={styles.successBox} role="status">
          <IconCheckCircle2 size={18} className={styles.successIcon} aria-hidden="true" />
          <div className={styles.successText}>
            <div className={styles.successTitle}>
              {state.createdName
                ? t('auth_login.success_connected', { name: state.createdName })
                : getProviderText(provider, 'oauth_status_success')}
            </div>
            <div className={styles.stepHint}>{t('auth_login.success_saved_hint')}</div>
          </div>
          <div className={styles.stepActions}>
            <Link to="/auth-files" className="btn btn-secondary btn-sm">
              {t('auth_login.view_auth_files')}
            </Link>
            <Button variant="secondary" size="sm" onClick={() => startAuth(provider.id)}>
              {t('auth_login.login_another_account')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => resetProviderAttempt(provider.id)}>
              {t('auth_login.dismiss')}
            </Button>
          </div>
        </div>
      );
    }

    const devinSessionStuck = provider.id === 'devin' && Boolean(state.state);
    return (
      <>
        {(state.status === 'waiting' || state.url) && renderSteps(provider, state)}
        {state.status === 'waiting' && renderWaitingLine(provider, state)}
        {state.status === 'error' && (
          <div className={styles.errorRow}>
            <div className="error-box" role="alert">
              {getProviderText(provider, 'oauth_status_error')} {state.error || ''}
              {devinSessionStuck && (
                <div className={styles.stepHint}>{t('auth_login.devin_oauth_retry_hint')}</div>
              )}
            </div>
            <div className={styles.stepActions}>
              {devinSessionStuck ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => cancelAuth(provider.id)}
                  loading={state.cancelling}
                >
                  {t('auth_login.cancel_login')}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => startAuth(provider.id)}>
                  {t('auth_login.retry_login')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => resetProviderAttempt(provider.id)}>
                {t('auth_login.dismiss')}
              </Button>
            </div>
          </div>
        )}
        {state.cancelError && (
          <div className="status-badge error" role="alert">
            {t('auth_login.devin_oauth_cancel_error')} {state.cancelError}
          </div>
        )}
      </>
    );
  };

  const renderProviderRow = (provider: OAuthProviderCard) => {
    const state = states[provider.id] || {};
    const expanded = Boolean(state.status && state.status !== 'idle');
    const isKimi = provider.kind === 'builtin' && ['kimi', 'kimi-ai'].includes(provider.id);
    const connected = connectedCounts.get(authFileKeyForProvider(provider.id)) ?? 0;
    const loginDisabled =
      state.status === 'waiting' || (provider.id === 'devin' && Boolean(state.state));

    return (
      <li
        key={provider.id}
        className={[styles.providerRow, expanded ? styles.providerRowActive : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.rowMain}>
          <OAuthProviderIcon provider={provider} theme={resolvedTheme} />
          <div className={styles.rowText}>
            <div className={styles.rowName}>{getProviderTitleText(provider)}</div>
            <div className={styles.rowHint}>
              {getProviderText(provider, 'oauth_hint')}
              {isKimi && (
                <>
                  {' '}
                  <a
                    href={
                      provider.id === 'kimi-ai'
                        ? KIMI_INTERNATIONAL_AFFILIATE_URL
                        : KIMI_CHINESE_AFFILIATE_URL
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.rowLink}
                  >
                    {t('auth_login.kimi_sign_up_button')}
                  </a>
                </>
              )}
            </div>
          </div>
          {authFiles !== null && (
            <Link to="/auth-files" className={styles.rowCount}>
              {t('auth_login.connected_count', { count: connected })}
            </Link>
          )}
          <Button
            size="sm"
            onClick={() => startAuth(provider.id)}
            loading={state.polling && !state.url}
            disabled={loginDisabled}
          >
            {getProviderText(provider, 'oauth_button')}
          </Button>
        </div>
        {expanded && <div className={styles.rowPanel}>{renderPanel(provider, state)}</div>}
      </li>
    );
  };

  const meta: PageHeaderMetaSegment[] = [
    { key: 'providers', text: t('auth_login.meta_providers', { count: providerCards.length + 1 }) },
  ];
  if (authFiles !== null) {
    meta.push({
      key: 'connected',
      tone: authFiles.length > 0 ? 'ok' : 'muted',
      text: t('auth_login.meta_connected', { count: authFiles.length }),
    });
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title={t('nav.oauth')}
        meta={meta}
        description={t('auth_login.page_description')}
      />

      <ul className={styles.providerList}>{providerCards.map(renderProviderRow)}</ul>

      <h2 className={styles.sectionTitle}>{t('auth_login.other_login_methods')}</h2>
      <ul className={styles.providerList}>
        <li
          className={[styles.providerRow, vertexOpen ? styles.providerRowActive : '']
            .filter(Boolean)
            .join(' ')}
        >
          <div className={styles.rowMain}>
            <img src={iconVertex} alt="" className={styles.providerIcon} />
            <div className={styles.rowText}>
              <div className={styles.rowName}>{t('vertex_import.title')}</div>
              <div className={styles.rowHint}>{t('vertex_import.description')}</div>
            </div>
            {authFiles !== null && (
              <Link to="/auth-files" className={styles.rowCount}>
                {t('auth_login.connected_count', { count: connectedCounts.get('vertex') ?? 0 })}
              </Link>
            )}
            <Button
              size="sm"
              variant={vertexOpen ? 'secondary' : 'primary'}
              onClick={() => setVertexOpen((open) => !open)}
              aria-expanded={vertexOpen}
            >
              {vertexOpen ? t('auth_login.dismiss') : t('vertex_import.import_button')}
            </Button>
          </div>
          {vertexOpen && (
            <div className={styles.rowPanel}>
              <div className={styles.vertexForm}>
                <Input
                  label={t('vertex_import.location_label')}
                  hint={t('vertex_import.location_hint')}
                  value={vertexState.location}
                  onChange={(e) =>
                    setVertexState((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  placeholder={t('vertex_import.location_placeholder')}
                />
                <div className={styles.formItem}>
                  <label className={styles.formItemLabel}>{t('vertex_import.file_label')}</label>
                  <div className={styles.filePicker}>
                    <Button variant="secondary" size="sm" onClick={handleVertexFilePick}>
                      {t('vertex_import.choose_file')}
                    </Button>
                    <div
                      className={`${styles.fileName} ${
                        vertexState.fileName ? '' : styles.fileNamePlaceholder
                      }`.trim()}
                    >
                      {vertexState.fileName || t('vertex_import.file_placeholder')}
                    </div>
                  </div>
                  <div className={styles.stepHint}>{t('vertex_import.file_hint')}</div>
                  <input
                    ref={vertexFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleVertexFileChange}
                  />
                </div>
                {vertexState.error && (
                  <div className="error-box" role="alert">
                    {vertexState.error}
                  </div>
                )}
                {vertexState.result && (
                  <div className={styles.connectionBox}>
                    <div className={styles.connectionLabel}>{t('vertex_import.result_title')}</div>
                    <div className={styles.keyValueList}>
                      {vertexState.result.projectId && (
                        <div className={styles.keyValueItem}>
                          <span className={styles.keyValueKey}>
                            {t('vertex_import.result_project')}
                          </span>
                          <span className={styles.keyValueValue}>
                            {vertexState.result.projectId}
                          </span>
                        </div>
                      )}
                      {vertexState.result.email && (
                        <div className={styles.keyValueItem}>
                          <span className={styles.keyValueKey}>
                            {t('vertex_import.result_email')}
                          </span>
                          <span className={styles.keyValueValue}>{vertexState.result.email}</span>
                        </div>
                      )}
                      {vertexState.result.location && (
                        <div className={styles.keyValueItem}>
                          <span className={styles.keyValueKey}>
                            {t('vertex_import.result_location')}
                          </span>
                          <span className={styles.keyValueValue}>
                            {vertexState.result.location}
                          </span>
                        </div>
                      )}
                      {vertexState.result.authFile && (
                        <div className={styles.keyValueItem}>
                          <span className={styles.keyValueKey}>
                            {t('vertex_import.result_file')}
                          </span>
                          <span className={styles.keyValueValue}>
                            {vertexState.result.authFile}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className={styles.stepActions}>
                  <Button onClick={handleVertexImport} loading={vertexState.loading}>
                    {t('vertex_import.import_button')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}
