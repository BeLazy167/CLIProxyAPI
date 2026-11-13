import { useTranslation } from 'react-i18next';
import {
  Pagination as SdkPagination,
  PaginationItem,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
} from '@ui-sdk/react/pagination';

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
    <SdkPagination
      className={['pagination', className].filter(Boolean).join(' ')}
      aria-label={t('common.pagination_label')}
      page={page}
      pageCount={totalPages}
      onPageChange={(next) => onChange(next)}
    >
      <PaginationList className="pagination-list">
        <PaginationItem>
          <PaginationPrevious className="pagination-step">
            {t('common.pagination_prev')}
          </PaginationPrevious>
        </PaginationItem>
        <PaginationItem className="pagination-info" aria-live="polite">
          {t('common.pagination_info', { current: page, total: totalPages, count: totalItems })}
        </PaginationItem>
        <PaginationItem>
          <PaginationNext className="pagination-step">{t('common.pagination_next')}</PaginationNext>
        </PaginationItem>
      </PaginationList>
    </SdkPagination>
  );
}
