import { Fragment, type ReactNode } from 'react';
import styles from './PageHeader.module.scss';

export type PageHeaderMetaTone = 'muted' | 'quiet' | 'ok' | 'warning' | 'attention';

export interface PageHeaderMetaSegment {
  key: string;
  text: ReactNode;
  tone?: PageHeaderMetaTone;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** ▍mono 遥测行的段落；为空时不渲染 meta 行。 */
  meta?: PageHeaderMetaSegment[];
  /** 右侧动作区：至多一个 primary 药丸。 */
  actions?: ReactNode;
  /** 标题下方的次级说明（Logs/System 等没有计数的页面用）。 */
  description?: ReactNode;
  className?: string;
  /** 透传给 useRevealGroup 的容器 ref。 */
  revealRef?: React.Ref<HTMLElement>;
}

const TONE_CLASS: Record<PageHeaderMetaTone, string> = {
  muted: styles.metaMuted,
  quiet: styles.metaQuiet,
  ok: styles.metaOk,
  warning: styles.metaWarning,
  attention: styles.metaAttention,
};

/**
 * 全站页头：紧排标题 + ▍mono 遥测 meta 行 + 药丸动作区（Quota 页语汇）。
 * 三处 `data-reveal` 交给页面壳的 useRevealGroup 编排（标题 → meta → 动作）。
 */
export function PageHeader({
  title,
  meta,
  actions,
  description,
  className,
  revealRef,
}: PageHeaderProps) {
  const hasMeta = Boolean(meta && meta.length > 0);
  return (
    <header className={[styles.header, className].filter(Boolean).join(' ')} ref={revealRef}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {title}
        </h1>
        {hasMeta && (
          <p className={styles.meta} data-reveal>
            {meta!.map((segment, index) => (
              <Fragment key={segment.key}>
                {index > 0 ? (
                  <span className={styles.metaDot} aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span className={TONE_CLASS[segment.tone ?? 'muted']}>{segment.text}</span>
              </Fragment>
            ))}
          </p>
        )}
        {description && (
          <p className={styles.description} data-reveal>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className={styles.actions} data-reveal>
          {actions}
        </div>
      )}
    </header>
  );
}
