import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconExternalLink, IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { pluginsApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginListResponse } from '@/types';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
} from './pluginResources';
import styles from './PluginResourcePage.module.scss';

const SLOW_LOAD_HINT_MS = 6000;

const hasStatus = (error: unknown, status: number) => isRecord(error) && error.status === status;

const safeDecodeURIComponent = (value = '') => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseMenuIndex = (value = '') => {
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : -1;
};

export function PluginResourcePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ pluginId: string; menuIndex: string }>();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const [data, setData] = useState<PluginListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);

  const connected = connectionStatus === 'connected';
  const pluginID = useMemo(() => safeDecodeURIComponent(params.pluginId), [params.pluginId]);
  const menuIndex = useMemo(() => parseMenuIndex(params.menuIndex), [params.menuIndex]);

  const loadResource = useCallback(async () => {
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
          : getErrorMessage(err, t('plugin_resource.load_failed'))
      );
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(loadResource, connected);

  useEffect(() => {
    void loadResource();
  }, [loadResource]);

  useEffect(() => {
    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadResource);
    return () => {
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadResource);
    };
  }, [loadResource]);

  const resource = useMemo(() => {
    const entries = collectPluginResourceEntries(data?.plugins ?? []);
    return entries.find((entry) => entry.pluginID === pluginID && entry.menuIndex === menuIndex);
  }, [data?.plugins, menuIndex, pluginID]);

  const iframeSrc = resource ? resolvePluginAssetURL(resource.menu.path, apiBase) : '';

  // Reset the frame overlay whenever the embedded URL changes or the user reloads.
  useEffect(() => {
    setFrameLoaded(false);
    setSlowLoad(false);
    if (!iframeSrc) return;
    const timer = window.setTimeout(() => setSlowLoad(true), SLOW_LOAD_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [iframeSrc, frameKey]);

  const reloadFrame = () => setFrameKey((value) => value + 1);

  const backAction = (
    <Button variant="secondary" size="sm" onClick={() => navigate('/plugins')}>
      {t('plugin_resource.back_to_plugins')}
    </Button>
  );

  let body: React.ReactNode;
  if (loading && !data) {
    body = (
      <div className={styles.stateShell} aria-busy="true">
        <div className={styles.skeletonStack}>
          <Skeleton width="40%" height={18} />
          <Skeleton height={120} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="55%" height={14} />
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <div className={styles.stateShell}>
        <EmptyState
          title={t('plugin_resource.unavailable')}
          description={error}
          action={
            <div className={styles.stateActions}>
              {connected ? (
                <Button size="sm" onClick={loadResource} loading={loading}>
                  <IconRefreshCw size={14} />
                  {t('plugin_resource.retry')}
                </Button>
              ) : null}
              {backAction}
            </div>
          }
        />
      </div>
    );
  } else if (!resource) {
    body = (
      <div className={styles.stateShell}>
        <EmptyState
          title={t('plugin_resource.not_found')}
          description={t('plugin_resource.not_found_desc')}
          action={backAction}
        />
      </div>
    );
  } else if (!iframeSrc) {
    body = (
      <div className={styles.stateShell}>
        <EmptyState
          title={t('plugin_resource.empty_src')}
          description={t('plugin_resource.empty_src_desc')}
          action={backAction}
        />
      </div>
    );
  } else {
    body = (
      <div className={styles.frameShell}>
        {!frameLoaded ? (
          <div className={styles.frameOverlay} role="status">
            <Skeleton width="40%" height={18} />
            <Skeleton height={120} />
            <Skeleton width="70%" height={14} />
            {slowLoad ? (
              <p className={styles.slowHint}>
                {t('plugin_resource.slow_load_hint')}{' '}
                <a href={iframeSrc} target="_blank" rel="noreferrer">
                  {t('plugin_resource.open_new_tab')}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
        {/*
          Intentionally no `sandbox` attribute: plugin pages are served by the backend and
          commonly rely on same-origin API calls, OAuth popups, downloads and dialogs. A sandbox
          that allows scripts + same-origin provides no isolation, and a stricter one would
          silently break those flows. See the task report for the full rationale.
        */}
        <iframe
          key={frameKey}
          className={styles.frame}
          src={iframeSrc}
          title={`${resource.pluginTitle}: ${resource.label}`}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          onLoad={() => setFrameLoaded(true)}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {resource ? (
        <div className={styles.toolbar}>
          <div className={styles.crumbs}>
            <span className={styles.crumbPlugin}>{resource.pluginTitle}</span>
            {resource.label !== resource.pluginTitle ? (
              <>
                <span className={styles.crumbSep} aria-hidden="true">
                  ›
                </span>
                <span className={styles.crumbPage}>{resource.label}</span>
              </>
            ) : null}
          </div>
          <div className={styles.toolbarActions}>
            <Button
              variant="ghost"
              size="xs"
              onClick={reloadFrame}
              disabled={!iframeSrc}
              aria-label={t('plugin_resource.reload_aria', { name: resource.pluginTitle })}
            >
              <IconRefreshCw size={14} />
              {t('plugin_resource.reload')}
            </Button>
            {iframeSrc ? (
              <a
                className={styles.toolbarLink}
                href={iframeSrc}
                target="_blank"
                rel="noreferrer"
                aria-label={t('plugin_resource.open_new_tab_aria', { name: resource.pluginTitle })}
              >
                <IconExternalLink size={14} />
                {t('plugin_resource.open_new_tab')}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {body}
    </div>
  );
}
