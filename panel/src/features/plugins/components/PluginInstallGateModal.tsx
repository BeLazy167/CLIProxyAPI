import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { IconAlertTriangle, IconExternalLink } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import type { PluginStoreEntry } from '@/types';
import {
  buildRepositoryURL,
  getPluginConfirmToken,
  getPluginRepositorySlug,
  isDefaultPluginStoreSource,
  resolvePluginAssetURL,
} from '../pluginResources';
import { PluginLogo } from './PluginLogo';
import styles from './PluginInstallGateModal.module.scss';

interface PluginInstallGateModalProps {
  open: boolean;
  entry: PluginStoreEntry | null;
  isUpdate: boolean;
  /** Human-readable target version shown in the confirm button (e.g. "v1.2.0"). */
  targetVersion: string;
  installing: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Third-party install gate. Step 1 shows identity and risks together; step 2 is the
 * typed confirmation. Updating an already-installed plugin from the same source
 * skips the typing and confirms from step 1 with the old -> new version.
 */
export function PluginInstallGateModal({
  open,
  entry,
  isUpdate,
  targetVersion,
  installing,
  onClose,
  onConfirm,
}: PluginInstallGateModalProps) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  // Reset on each fresh open; adjusting state during render avoids a setState-in-effect.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(1);
      setTyped('');
    }
  }

  if (!entry) return null;

  const title = entry.name || entry.id;
  const repoSlug = getPluginRepositorySlug(entry.repository);
  const repositoryURL = buildRepositoryURL(entry.repository);
  const repoLabel = repoSlug || entry.id;
  const token = getPluginConfirmToken(entry);
  const logo = resolvePluginAssetURL(entry.logo, apiBase);
  const rawSourceText = entry.sourceName || entry.sourceUrl;
  const sourceText = isDefaultPluginStoreSource(entry)
    ? t('plugin_store.cli_proxy_api_source')
    : rawSourceText;
  const tokenMatches = typed.trim() === token;
  const requireTypedConfirm = !isUpdate;

  const handleClose = () => {
    if (installing) return;
    onClose();
  };

  const handleFinalConfirm = async () => {
    try {
      await onConfirm();
    } catch {
      // The caller surfaces the error via a notification; stay on this step.
    }
  };

  const confirmLabel = isUpdate
    ? t('plugin_store.update_to_version', { version: targetVersion })
    : t('plugin_store.gate_step3_action');

  const identity = (
    <div className={styles.identity}>
      <PluginLogo src={logo} size={52} />
      <h3 className={styles.name}>{title}</h3>
      {repositoryURL ? (
        <a
          className={styles.repoLink}
          href={repositoryURL}
          target="_blank"
          rel="noreferrer"
          title={t('plugin_store.open_repository')}
          aria-label={t('plugin_store.open_repository')}
        >
          <span>{repoLabel}</span>
          <IconExternalLink size={12} />
        </a>
      ) : (
        <p className={styles.slug}>{repoLabel}</p>
      )}
      {sourceText ? (
        <p className={styles.source}>{t('plugin_store.source_name', { source: sourceText })}</p>
      ) : null}
      {isUpdate && entry.installedVersion ? (
        <p className={styles.source}>
          {t('plugin_store.version_arrow', {
            from: entry.installedVersion.replace(/^v/i, ''),
            to: targetVersion.replace(/^v/i, ''),
          })}
        </p>
      ) : null}
    </div>
  );

  let body: ReactNode;
  let footer: ReactNode;

  if (step === 1) {
    body = (
      <>
        {identity}
        <div className={styles.warningBanner}>
          <IconAlertTriangle size={18} />
          <span>{t('plugin_store.gate_warning')}</span>
        </div>
        <ul className={styles.effects}>
          <li>{t('plugin_store.gate_effect_runs_code')}</li>
          <li>{t('plugin_store.gate_effect_no_review')}</li>
          <li>{t('plugin_store.gate_effect_restart')}</li>
        </ul>
        <div className={styles.untrustedAlert}>
          <p className={styles.untrustedText}>{t('plugin_store.gate_untrusted_alert')}</p>
          <dl className={styles.originGrid}>
            <dt>{t('plugin_store.gate_repository_label')}</dt>
            <dd>{repoSlug || entry.repository || '—'}</dd>
            <dt>{t('plugin_store.gate_source_label')}</dt>
            <dd>{sourceText || '—'}</dd>
          </dl>
        </div>
      </>
    );
    footer = requireTypedConfirm ? (
      <Button variant="secondary" fullWidth onClick={() => setStep(2)}>
        {t('plugin_store.gate_step2_action')}
      </Button>
    ) : (
      <Button
        variant="danger"
        fullWidth
        onClick={handleFinalConfirm}
        disabled={installing}
        loading={installing}
      >
        {confirmLabel}
      </Button>
    );
  } else {
    body = (
      <>
        {identity}
        <div className={styles.confirmBlock}>
          <label className={styles.confirmPrompt} htmlFor="plugin-gate-confirm">
            {t('plugin_store.gate_step3_prompt', { token })}
          </label>
          <Input
            id="plugin-gate-confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={installing}
            aria-label={t('plugin_store.gate_step3_prompt', { token })}
          />
          <p className={styles.confirmHint}>{t('plugin_store.gate_step3_hint')}</p>
        </div>
      </>
    );
    footer = (
      <div className={styles.footerRow}>
        <Button variant="ghost" onClick={() => setStep(1)} disabled={installing}>
          {t('common.back')}
        </Button>
        <Button
          variant="danger"
          onClick={handleFinalConfirm}
          disabled={!tokenMatches || installing}
          loading={installing}
        >
          {confirmLabel}
        </Button>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t(isUpdate ? 'plugin_store.gate_title_update' : 'plugin_store.gate_title', {
        name: title,
      })}
      closeDisabled={installing}
      footer={footer}
      width={520}
      className={styles.gateModal}
    >
      {body}
    </Modal>
  );
}
