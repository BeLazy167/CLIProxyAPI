import {
  useEffect,
  useState,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  Collapsible as SdkCollapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@ui-sdk/react/collapsible';
import { IconChevronDown } from '../icons';
import styles from './Collapsible.module.scss';

interface CollapsibleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'> {
  label: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  flush?: boolean;
  /** 摘要行右侧的可选徽章槽（如「3 changed」）。 */
  badge?: ReactNode;
  /** 子内容存在校验错误：摘要行显示失败色圆点。 */
  hasError?: boolean;
  /**
   * 为 true 时（非受控模式下）展开一次；用户之后仍可手动收起。
   * 用于「子字段有错误/被修改时自动展开」而不夺走用户的开合控制权。
   */
  forceOpen?: boolean;
}

export function Collapsible({
  label,
  hint,
  defaultOpen = false,
  open,
  onOpenChange,
  flush,
  badge,
  hasError = false,
  forceOpen = false,
  children,
  className,
  ...rest
}: PropsWithChildren<CollapsibleProps>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen || forceOpen);
  const resolvedOpen = open ?? uncontrolledOpen;

  useEffect(() => {
    if (forceOpen && open === undefined) setUncontrolledOpen(true);
  }, [forceOpen, open]);

  return (
    <SdkCollapsible
      {...rest}
      className={[styles.root, className].filter(Boolean).join(' ')}
      open={resolvedOpen}
      onOpenChange={(next) => {
        if (open === undefined) setUncontrolledOpen(next);
        onOpenChange?.(next);
      }}
    >
      <CollapsibleTrigger className={styles.summary}>
        <span className={styles.summaryLabel}>
          <span>{label}</span>
          {hint ? <span className={styles.summaryHint}>{hint}</span> : null}
        </span>
        {hasError ? <span className={styles.errorDot} aria-hidden="true" /> : null}
        {badge ? <span className={styles.badge}>{badge}</span> : null}
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDown size={16} />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel hiddenUntilFound className={flush ? styles.contentFlush : styles.content}>
        {children}
      </CollapsiblePanel>
    </SdkCollapsible>
  );
}
