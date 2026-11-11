import {
  useEffect,
  useState,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { IconChevronDown } from '../icons';
import styles from './Collapsible.module.scss';

interface CollapsibleProps extends HTMLAttributes<HTMLDetailsElement> {
  label: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (event: React.SyntheticEvent<HTMLDetailsElement>) => void;
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
  onToggle,
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
  const cls = [styles.root, className].filter(Boolean).join(' ');
  const contentCls = flush ? styles.contentFlush : styles.content;

  useEffect(() => {
    if (forceOpen && open === undefined) setUncontrolledOpen(true);
  }, [forceOpen, open]);

  return (
    <details
      className={cls}
      open={resolvedOpen}
      onToggle={(event) => {
        if (open === undefined) {
          setUncontrolledOpen(event.currentTarget.open);
        }
        onToggle?.(event);
      }}
      {...rest}
    >
      <summary className={styles.summary}>
        <span className={styles.summaryLabel}>
          <span>{label}</span>
          {hint ? <span className={styles.summaryHint}>{hint}</span> : null}
        </span>
        {hasError ? <span className={styles.errorDot} aria-hidden="true" /> : null}
        {badge ? <span className={styles.badge}>{badge}</span> : null}
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDown size={16} />
        </span>
      </summary>
      <div className={contentCls}>{children}</div>
    </details>
  );
}
