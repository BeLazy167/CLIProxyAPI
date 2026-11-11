import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/stores';

export function ConfirmationModal() {
  const { t } = useTranslation();
  const confirmation = useNotificationStore((state) => state.confirmation);
  const hideConfirmation = useNotificationStore((state) => state.hideConfirmation);
  const setConfirmationLoading = useNotificationStore((state) => state.setConfirmationLoading);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isOpen, isLoading, options } = confirmation;

  useEffect(() => {
    if (!isOpen) setError(null);
  }, [isOpen]);

  if (!isOpen || !options) {
    return null;
  }

  const {
    title,
    message,
    onConfirm,
    onCancel,
    confirmText,
    cancelText,
    variant = 'primary',
  } = options;

  const handleConfirm = async () => {
    try {
      setError(null);
      setConfirmationLoading(true);
      await onConfirm();
      hideConfirmation();
    } catch (err) {
      // 失败留在框内说明，而不是静默吞掉
      setError(err instanceof Error && err.message ? err.message : t('common.unknown_error'));
    } finally {
      setConfirmationLoading(false);
    }
  };

  const handleCancel = () => {
    if (isLoading) {
      return;
    }
    if (onCancel) {
      onCancel();
    }
    hideConfirmation();
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleCancel}
      title={title}
      closeDisabled={isLoading}
      initialFocusRef={variant === 'danger' ? cancelRef : undefined}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={handleCancel} disabled={isLoading}>
            {cancelText || t('common.cancel')}
          </Button>
          <Button variant={variant} onClick={handleConfirm} loading={isLoading}>
            {confirmText || t('common.confirm')}
          </Button>
        </>
      }
    >
      {typeof message === 'string' ? <p className="confirm-message">{message}</p> : message}
      {error && (
        <div className="error-box confirm-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
