import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { AuthFileItem } from '@/types';
import { getTypeLabel, normalizeProviderKey } from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import styles from './AuthFileDeleteConfirmModal.module.scss';

/** Above this many files the user must tick an acknowledgement before Delete enables. */
export const DELETE_ACK_THRESHOLD = 5;
const PREVIEW_COUNT = 5;

export type AuthFileDeleteConfirmModalProps = {
  files: AuthFileItem[] | null;
  displayNameFor: (name: string) => string;
  onCancel: () => void;
  /** Rejects on failure; the error is shown inline and the dialog stays open. */
  onConfirm: () => Promise<void>;
};

export function AuthFileDeleteConfirmModal({
  files,
  displayNameFor,
  onCancel,
  onConfirm,
}: AuthFileDeleteConfirmModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = Boolean(files && files.length > 0);

  useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setError(null);
    }
  }, [open]);

  const list = files ?? [];
  const count = list.length;
  const providers = new Set(
    list.map((file) => normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown')))
  );
  const provider = providers.size === 1 ? getTypeLabel(t, [...providers][0]) : null;
  const needsAck = count > DELETE_ACK_THRESHOLD;
  const preview = list.slice(0, PREVIEW_COUNT);
  const remaining = count - preview.length;

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('common.unknown_error'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('auth_files.delete_modal_title', { count })}
      closeDisabled={deleting}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirm()}
            loading={deleting}
            disabled={needsAck && !acknowledged}
          >
            {t('auth_files.delete_modal_confirm', { count })}
          </Button>
        </>
      }
    >
      {provider && (
        <p className={styles.provider}>{t('auth_files.delete_modal_provider', { provider })}</p>
      )}
      <ul className={styles.list}>
        {preview.map((file) => {
          const identity = deriveAuthFileIdentity(file);
          return (
            <li key={file.name} className={styles.item}>
              {displayNameFor(identity.primary)}
            </li>
          );
        })}
        {remaining > 0 && (
          <li className={`${styles.item} ${styles.more}`}>
            {t('auth_files.more_count', { count: remaining })}
          </li>
        )}
      </ul>
      <p className={styles.consequence}>{t('auth_files.delete_modal_consequence')}</p>
      {needsAck && (
        <label className={styles.ack}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            disabled={deleting}
          />
          <span>{t('auth_files.delete_modal_ack', { count })}</span>
        </label>
      )}
      {error && (
        <div className="error-box confirm-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
