import { useId, useRef, type PropsWithChildren, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconX } from './icons';
import { useDialog } from './useDialog';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  closeDisabled?: boolean;
  /** 打开时聚焦的元素（如危险确认框聚焦「取消」）。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 点击遮罩关闭，默认关闭（表单类对话框不希望误触）。 */
  closeOnOverlayClick?: boolean;
}

// 与 components.scss 的 modal-fade-out 时长一致
const CLOSE_ANIMATION_DURATION = 160;

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
  children,
}: PropsWithChildren<ModalProps>) {
  const { t } = useTranslation();
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const { isVisible, isClosing, handleClose } = useDialog({
    open,
    onClose,
    containerRef: modalRef,
    initialFocusRef,
    fallbackFocusRef: closeButtonRef,
    closeDisabled,
    closeDuration: CLOSE_ANIMATION_DURATION,
  });

  if (!open && !isVisible) return null;

  const overlayClass = `modal-overlay ${isClosing ? 'modal-overlay-closing' : 'modal-overlay-entering'}`;
  const modalClass = `modal ${isClosing ? 'modal-closing' : 'modal-entering'}${className ? ` ${className}` : ''}`;

  const modalContent = (
    <div
      className={overlayClass}
      onMouseDown={(event) => {
        if (!closeOnOverlayClick || closeDisabled) return;
        if (event.target === event.currentTarget) void handleClose();
      }}
    >
      <div
        ref={modalRef}
        className={modalClass}
        style={{ width, maxWidth: '100%' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="modal-close-floating"
          onClick={closeDisabled ? undefined : () => void handleClose()}
          aria-label={t('common.close')}
          disabled={closeDisabled}
        >
          <IconX size={20} />
        </button>
        <div className="modal-header">
          <h2 className="modal-title" id={title ? titleId : undefined}>
            {title}
          </h2>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
