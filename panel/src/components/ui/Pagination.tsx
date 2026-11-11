import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** 总条目数（用于「第 x / y 页 · n 条」文案）。 */
  totalItems: number;
  onChange: (page: number) => void;
  className?: string;
}

/** 列表底部分页（Quota / 凭证库共用）。少于两页时不渲染。 */
export function Pagination({ page, totalPages, totalItems, onChange, className }: PaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <nav
      className={['pagination', className].filter(Boolean).join(' ')}
      aria-label={t('common.pagination_label')}
    >
      <Button
        variant="secondary"
        size="xs"
        shape="pill"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        {t('common.pagination_prev')}
      </Button>
      <span className="pagination-info" aria-live="polite">
        {t('common.pagination_info', { current: page, total: totalPages, count: totalItems })}
      </span>
      <Button
        variant="secondary"
        size="xs"
        shape="pill"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        {t('common.pagination_next')}
      </Button>
    </nav>
  );
}
