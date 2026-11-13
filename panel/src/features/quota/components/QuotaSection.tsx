import type { ReactNode } from 'react';
import styles from './QuotaSection.module.scss';

export interface QuotaSectionProps {
  id: string;
  title: ReactNode;
  note?: ReactNode;
  /** Controls on the right of the header band. */
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A Quota page section: a header band with its title over a bordered body. */
export function QuotaSection({ id, title, note, tools, className, children }: QuotaSectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <header className={styles.head}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {note && <span className={styles.note}>{note}</span>}
        {tools && <div className={styles.tools}>{tools}</div>}
      </header>
      {children}
    </section>
  );
}
