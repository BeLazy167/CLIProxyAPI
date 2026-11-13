import type { PropsWithChildren, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
} from '@ui-sdk/react/alert-dialog';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@ui-sdk/react/dialog';
import { IconX } from './icons';
import { useScrollLock } from './scrollLock';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  closeDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnOverlayClick?: boolean;
  /** A question that needs an answer: an alert dialog, which never closes on an outside press. */
  alert?: boolean;
}

export function Modal({
  open,
  title,
  onClose,
  footer,
  width = 520,
  className,
  closeDisabled = false,
  initialFocusRef,
  closeOnOverlayClick = false,
  alert = false,
  children,
}: PropsWithChildren<ModalProps>) {
  const { t } = useTranslation();
  useScrollLock(open);
  const Content = alert ? AlertDialogContent : DialogContent;
  const Title = alert ? AlertDialogTitle : DialogTitle;
  const Close = alert ? AlertDialogClose : DialogClose;
  const root = {
    open,
    dismissible: !closeDisabled,
    onOpenChange: (next: boolean) => {
      if (!next) onClose();
    },
  };

  const content = (
    <Content
      className={['modal', className].filter(Boolean).join(' ')}
      style={{ width, maxWidth: 'calc(100vw - 32px)' }}
      initialFocus={initialFocusRef ? () => initialFocusRef.current : undefined}
    >
      <Close
        className="modal-close-floating"
        aria-label={t('common.close')}
        disabled={closeDisabled}
      >
        <IconX size={20} />
      </Close>
      <div className="modal-header">
        {title ? <Title className="modal-title">{title}</Title> : null}
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </Content>
  );

  return alert ? (
    <AlertDialog {...root}>{content}</AlertDialog>
  ) : (
    <Dialog {...root} closeOnOutsidePress={closeOnOverlayClick && !closeDisabled}>
      {content}
    </Dialog>
  );
}
