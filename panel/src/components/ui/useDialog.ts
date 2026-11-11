import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FOCUSABLE_SELECTOR, lockScroll, unlockScroll } from './scrollLock';

export interface UseDialogOptions {
  open: boolean;
  onClose: () => void;
  /** 对话框根节点（焦点陷阱范围）。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 打开时优先聚焦的元素；缺省聚焦第一个可聚焦元素。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 兜底聚焦（如关闭按钮）。 */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  closeDisabled?: boolean;
  /** 退场动画时长（ms），结束后才真正卸载并通知父级。 */
  closeDuration: number;
  /** 用户触发关闭前的确认；返回 false 则保持打开。 */
  confirmClose?: () => boolean | Promise<boolean>;
  /** 打开时执行一次（如重置 body 滚动）。 */
  onOpened?: () => void;
}

/**
 * Modal 与 Sheet 共用的对话框行为：
 * 可见/退场状态机、滚动锁、焦点保存与还原、Tab 焦点陷阱、Escape 关闭、关闭前确认。
 */
export function useDialog({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  fallbackFocusRef,
  closeDisabled = false,
  closeDuration,
  confirmClose,
  onOpened,
}: UseDialogOptions) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback(() => {
    const root = containerRef.current;
    if (!root) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
    );
  }, [containerRef]);

  const startClose = useCallback(
    (notifyParent: boolean) => {
      if (closeTimerRef.current !== null) return;
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
        closeTimerRef.current = null;
        if (notifyParent) onClose();
      }, closeDuration);
    },
    [closeDuration, onClose]
  );

  useEffect(() => {
    let cancelled = false;
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      queueMicrotask(() => {
        if (cancelled) return;
        setIsVisible(true);
        setIsClosing(false);
      });
    } else if (isVisible) {
      queueMicrotask(() => {
        if (cancelled) return;
        startClose(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, isVisible, startClose]);

  const handleClose = useCallback(async () => {
    if (confirmClose) {
      try {
        const ok = await confirmClose();
        if (ok === false) return;
      } catch {
        return;
      }
    }
    startClose(true);
  }, [confirmClose, startClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const shouldLockScroll = open || isVisible;
  useEffect(() => {
    if (!shouldLockScroll) return;
    lockScroll();
    return () => unlockScroll();
  }, [shouldLockScroll]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      onOpened?.();
      const target =
        initialFocusRef?.current ??
        getFocusableElements()[0] ??
        fallbackFocusRef?.current ??
        containerRef.current;
      target?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // onOpened 只在打开瞬间调用一次，不随引用变化重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, fallbackFocusRef, getFocusableElements, initialFocusRef, open]);

  useEffect(() => {
    if (open || isVisible) return;
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [isVisible, open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (closeDisabled) return;
        event.preventDefault();
        void handleClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === containerRef.current) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeDisabled, containerRef, getFocusableElements, handleClose, open]);

  return { isVisible, isClosing, handleClose };
}
