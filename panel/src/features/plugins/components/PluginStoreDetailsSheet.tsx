import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { IconExternalLink } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import type { PluginStoreEntry } from '@/types';
import {
  buildRepositoryURL,
  getPluginRepositorySlug,
  isDefaultPluginStoreSource,
  resolvePluginAssetURL,
} from '../pluginResources';
import { PluginLogo } from './PluginLogo';
import styles from './PluginStoreDetailsSheet.module.scss';

const formatInstallType = (installType: string) =>
  installType
    .trim()
    .split('-')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');

interface PluginStoreDetailsSheetProps {
  entry: PluginStoreEntry | null;
  onClose: () => void;
}

/** Everything the compact Store card no longer shows: install type, platforms, license, source, tags. */
export function PluginStoreDetailsSheet({ entry, onClose }: PluginStoreDetailsSheetProps) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);

  const repositoryURL = entry ? buildRepositoryURL(entry.repository) : '';
  const homepageURL = entry && /^https?:\/\//i.test(entry.homepage) ? entry.homepage : '';
  const sourceName = entry
    ? isDefaultPluginStoreSource(entry)
      ? t('plugin_store.cli_proxy_api_source')
      : entry.sourceName || entry.sourceUrl
    : '';

  const rows: Array<{ key: string; label: string; value: React.ReactNode }> = entry
    ? [
        { key: 'id', label: t('plugin_store.details_id'), value: <code>{entry.id}</code> },
        {
          key: 'version',
          label: t('plugin_store.details_version'),
          value: entry.version ? `v${entry.version}` : '—',
        },
        {
          key: 'installed',
          label: t('plugin_store.details_installed_version'),
          value: entry.installedVersion ? `v${entry.installedVersion}` : '—',
        },
        { key: 'author', label: t('plugin_store.details_author'), value: entry.author || '—' },
        { key: 'license', label: t('plugin_store.details_license'), value: entry.license || '—' },
        { key: 'source', label: t('plugin_store.details_source'), value: sourceName || '—' },
        {
          key: 'installType',
          label: t('plugin_store.details_install_type'),
          value: entry.installType ? formatInstallType(entry.installType) : '—',
        },
        {
          key: 'platforms',
          label: t('plugin_store.details_platforms'),
          value:
            entry.platforms.length > 0
              ? entry.platforms.map((platform) => `${platform.goos}/${platform.goarch}`).join(', ')
              : '—',
        },
        {
          key: 'repository',
          label: t('plugin_store.details_repository'),
          value: repositoryURL ? (
            <a href={repositoryURL} target="_blank" rel="noreferrer" className={styles.link}>
              {getPluginRepositorySlug(entry.repository) || repositoryURL}
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            '—'
          ),
        },
        {
          key: 'homepage',
          label: t('plugin_store.details_homepage'),
          value: homepageURL ? (
            <a href={homepageURL} target="_blank" rel="noreferrer" className={styles.link}>
              {homepageURL}
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            '—'
          ),
        },
      ]
    : [];

  return (
    <Sheet
      open={Boolean(entry)}
      onClose={onClose}
      size="md"
      eyebrow={t('plugin_store.details_eyebrow')}
      title={entry ? entry.name || entry.id : ''}
    >
      {entry ? (
        <div className={styles.body}>
          <div className={styles.identity}>
            <PluginLogo src={resolvePluginAssetURL(entry.logo, apiBase)} size={52} />
            {entry.description ? <p className={styles.description}>{entry.description}</p> : null}
          </div>
          <dl className={styles.grid}>
            {rows.map((row) => (
              <div key={row.key} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {entry.tags.length > 0 ? (
            <div className={styles.tags}>
              {entry.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
