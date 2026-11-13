import { useRef, type ReactNode, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@ui-sdk/react/drawer';
import { IconX } from '../icons';
import styles from './Sheet.module.scss';

export type SheetSize = 'md' | 'lg' | 'xl';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  size?: SheetSize;
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /**
   * Asked before any user close (Escape, outside press, swipe, close button). Return false, or a
   * Promise of false, to keep the sheet open.
   */
  confirmClose?: () => boolean | Promise<boolean>;
}

const SIZE_CLASS: Record<SheetSize, string> = {
  md: styles.sizeMd,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

export function Sheet({
  open,
  onClose,
  size = 'md',
  eyebrow,
  title,
  description,
  footer,
  closeDisabled = false,
  className,
  ariaLabel,
  confirmClose,
  children,
}: PropsWithChildren<SheetProps>) {
  const { t } = useTranslation();
  const confirming = useRef(false);

  const requestClose = async () => {
    if (!confirmClose) {
      onClose();
      return;
    }
    if (confirming.current) return;
    confirming.current = true;
    const ok = await Promise.resolve()
      .then(confirmClose)
      .catch(() => false);
    confirming.current = false;
    if (ok) onClose();
  };

  return (
    <Drawer
      side="right"
      open={open}
      dismissible={!closeDisabled}
      onOpenChange={(next, details) => {
        if (next) return;
        // The drawer only closes through `open`, so a veto never races its exit animation.
        details.cancel();
        void requestClose();
      }}
    >
      <DrawerBackdrop className={styles.overlay} />
      <DrawerContent
        className={[styles.content, SIZE_CLASS[size], className].filter(Boolean).join(' ')}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
      >
        <DrawerClose
          className={styles.closeBtn}
          disabled={closeDisabled}
          aria-label={t('common.close')}
        >
          <IconX size={18} />
        </DrawerClose>
        {(eyebrow || title || description) && (
          <div className={styles.header}>
            {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
            {title ? <DrawerTitle className={styles.title}>{title}</DrawerTitle> : null}
            {description ? (
              <DrawerDescription className={styles.description}>{description}</DrawerDescription>
            ) : null}
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </DrawerContent>
    </Drawer>
  );
}
