import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconChevronDown, IconExternalLink } from '@/components/ui/icons';
import { getErrorMessage } from '@/utils/helpers';
import type { PluginStoreEntry } from '@/types';
import { isOfficialPlugin } from '../pluginResources';
import {
  buildGitHubReleasesPageURL,
  fetchPluginReleaseVersions,
  isGitHubRateLimitError,
  isValidManualReleaseTag,
  supportsPluginVersionSelection,
  type PluginReleaseVersion,
} from '../pluginReleaseVersions';
import { formatPluginVersion, pluginVersionMatches } from '../pluginVersion';
import styles from './PluginInstallOptionsModal.module.scss';

const releaseVersionsCache = new Map<string, PluginReleaseVersion[]>();

const formatReleaseDate = (value: string, locale: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

interface PluginInstallOptionsModalProps {
  entry: PluginStoreEntry;
  isUpdate: boolean;
  /** Requested release tag; empty means "latest, resolved by the backend". */
  version: string;
  installing: boolean;
  onVersionChange: (version: string) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Default view is one line ("Install X v1.2.3 (latest)") with a disclosure for
 * other versions. GitHub releases are fetched only when that disclosure opens:
 * the call is unauthenticated (60/hour per IP) and reveals the user's IP.
 * The parent keys this component by entry so state resets per plugin.
 */
export function PluginInstallOptionsModal({
  entry,
  isUpdate,
  version,
  installing,
  onVersionChange,
  onClose,
  onConfirm,
}: PluginInstallOptionsModalProps) {
  const { i18n, t } = useTranslation();
  const [chooseOpen, setChooseOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [showPrerelease, setShowPrerelease] = useState(false);
  const [releases, setReleases] = useState<PluginReleaseVersion[] | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState<{ message: string; rateLimited: boolean }>();

  const supportsVersionSelection = supportsPluginVersionSelection(entry.installType);
  const releasePageURL = supportsVersionSelection
    ? buildGitHubReleasesPageURL(entry.repository)
    : '';
  const cacheKey = `${entry.storeId || entry.id}|${entry.repository.trim()}`;

  useEffect(() => {
    if (!chooseOpen || !releasePageURL || releases) return;
    const cached = releaseVersionsCache.get(cacheKey);
    if (cached) {
      setReleases(cached);
      return;
    }
    let active = true;
    setReleaseLoading(true);
    setReleaseError(undefined);
    fetchPluginReleaseVersions(entry.repository)
      .then((list) => {
        if (!active) return;
        releaseVersionsCache.set(cacheKey, list);
        setReleases(list);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setReleaseError({
          message: getErrorMessage(err, t('plugin_store.install_versions_load_failed')),
          rateLimited: isGitHubRateLimitError(err),
        });
        setReleases([]);
      })
      .finally(() => {
        if (active) setReleaseLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cacheKey, chooseOpen, entry.repository, releasePageURL, releases, t]);

  const visibleReleases = useMemo(
    () => (releases ?? []).filter((release) => showPrerelease || !release.prerelease),
    [releases, showPrerelease]
  );
  const hasPrerelease = (releases ?? []).some((release) => release.prerelease);
  const releaseOptions = useMemo(
    () =>
      visibleReleases.map((release) => {
        const parts = [
          release.name && release.name !== release.tagName
            ? `${release.tagName} - ${release.name}`
            : release.tagName,
          formatReleaseDate(release.publishedAt, i18n.language),
          release.prerelease ? t('plugin_store.install_version_prerelease_badge') : '',
        ].filter(Boolean);
        return { value: release.tagName, label: parts.join(' · ') };
      }),
    [i18n.language, t, visibleReleases]
  );

  const title = getTitle(entry);
  const latestLabel = entry.version
    ? formatPluginVersion(entry.version)
    : t('plugin_store.install_version_latest');
  const requested = version.trim();
  const targetVersion = requested ? formatPluginVersion(requested) : latestLabel;
  const manualInvalid = manual && Boolean(requested) && !isValidManualReleaseTag(requested);
  const currentVersionSelected =
    Boolean(requested) &&
    Boolean(entry.installedVersion) &&
    pluginVersionMatches(entry.installedVersion, requested);
  const confirmDisabled =
    installing || manualInvalid || currentVersionSelected || (chooseOpen && manual && !requested);

  const handleToggleChoose = () => {
    if (installing) return;
    const next = !chooseOpen;
    setChooseOpen(next);
    if (!next) {
      setManual(false);
      onVersionChange('');
    }
  };

  const handleClose = () => {
    if (installing) return;
    onClose();
  };

  return (
    <Modal
      open
      onClose={handleClose}
      title={t(
        isUpdate ? 'plugin_store.update_confirm_title' : 'plugin_store.install_confirm_title'
      )}
      closeDisabled={installing}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={installing}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={isOfficialPlugin(entry) ? 'primary' : 'danger'}
            onClick={onConfirm}
            disabled={confirmDisabled}
            loading={installing}
          >
            {t(
              isUpdate ? 'plugin_store.update_to_version' : 'plugin_store.install_version_action',
              {
                version: targetVersion,
              }
            )}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.message}>
          {isUpdate && entry.installedVersion
            ? t('plugin_store.update_summary', {
                name: title,
                from: formatPluginVersion(entry.installedVersion),
                to: targetVersion,
              })
            : t('plugin_store.install_summary', { name: title, version: targetVersion })}
          {!requested ? (
            <span className={styles.latestTag}>{t('plugin_store.install_version_latest')}</span>
          ) : null}
        </p>

        {supportsVersionSelection ? (
          <div className={styles.chooser}>
            <button
              type="button"
              className={styles.disclosure}
              onClick={handleToggleChoose}
              aria-expanded={chooseOpen}
              disabled={installing}
            >
              <IconChevronDown
                size={14}
                className={chooseOpen ? styles.chevronOpen : undefined}
                aria-hidden="true"
              />
              {t('plugin_store.choose_another_version')}
            </button>

            {chooseOpen ? (
              <div className={styles.panel}>
                {!releasePageURL ? (
                  <p className={styles.hint}>{t('plugin_store.install_version_non_github')}</p>
                ) : null}
                {releaseLoading ? (
                  <p className={styles.hint}>{t('plugin_store.install_versions_loading')}</p>
                ) : null}
                {releaseError ? (
                  <p className={styles.warning}>
                    {releaseError.rateLimited
                      ? t('plugin_store.install_versions_rate_limited')
                      : `${t('plugin_store.install_versions_load_failed')}: ${releaseError.message}`}
                  </p>
                ) : null}
                {!releaseLoading && !releaseError && releases && releases.length === 0 ? (
                  <p className={styles.hint}>{t('plugin_store.install_versions_empty')}</p>
                ) : null}

                {!manual && releaseOptions.length > 0 ? (
                  <Select
                    value={requested}
                    options={releaseOptions}
                    onChange={onVersionChange}
                    placeholder={t('plugin_store.install_version_release_placeholder')}
                    disabled={installing}
                    ariaLabel={t('plugin_store.install_version_release_select')}
                  />
                ) : null}
                {!manual &&
                !releaseLoading &&
                releases &&
                releases.length > 0 &&
                visibleReleases.length === 0 ? (
                  <p className={styles.hint}>
                    {t('plugin_store.install_versions_only_prerelease')}
                  </p>
                ) : null}
                {!manual && hasPrerelease ? (
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={showPrerelease}
                      onChange={(event) => setShowPrerelease(event.target.checked)}
                      disabled={installing}
                    />
                    <span>{t('plugin_store.install_version_show_prerelease')}</span>
                  </label>
                ) : null}

                {manual ? (
                  <Input
                    id="plugin-store-install-version"
                    label={t('plugin_store.install_version_manual_mode')}
                    value={version}
                    onChange={(event) => onVersionChange(event.target.value)}
                    placeholder={t('plugin_store.install_version_manual_placeholder')}
                    disabled={installing}
                    autoComplete="off"
                    spellCheck={false}
                    error={
                      manualInvalid ? t('plugin_store.install_version_manual_error') : undefined
                    }
                  />
                ) : null}

                <div className={styles.panelLinks}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => {
                      setManual((value) => !value);
                      onVersionChange('');
                    }}
                    disabled={installing}
                  >
                    {t(
                      manual
                        ? 'plugin_store.install_version_pick_release'
                        : 'plugin_store.install_version_enter_manually'
                    )}
                  </button>
                  {releasePageURL ? (
                    <a
                      className={styles.link}
                      href={releasePageURL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('plugin_store.install_version_releases_link')}
                      <IconExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentVersionSelected ? (
          <p className={styles.warning}>
            {t('plugin_store.install_version_current_selected', {
              version: formatPluginVersion(entry.installedVersion),
            })}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

const getTitle = (entry: PluginStoreEntry) => entry.name || entry.id;
