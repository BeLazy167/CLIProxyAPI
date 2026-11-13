import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pagination as SdkPagination,
  PaginationItem,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
} from '@ui-sdk/react/pagination';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** 总条目数（用于「第 x / y 页 · n 条」文案）。 */
  totalItems: number;
  onChange: (page: number) => void;
  /** Shown before the steps, e.g. the page size with its tip. */
  lead?: ReactNode;
  className?: string;
}

/** 列表底部分页（Quota / 凭证库共用）。少于两页时不渲染。 */
export function Pagination({
  page,
  totalPages,
  totalItems,
  onChange,
  lead,
  className,
}: PaginationProps) {
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
        {lead && <PaginationItem className="pagination-lead">{lead}</PaginationItem>}
        <PaginationItem>
          <PaginationPrevious className="pagination-step" aria-label={t('common.pagination_prev')}>
            <IconChevronLeft size={16} aria-hidden="true" />
          </PaginationPrevious>
        </PaginationItem>
        <PaginationItem className="pagination-info" aria-live="polite">
          {t('common.pagination_info', { current: page, total: totalPages, count: totalItems })}
        </PaginationItem>
        <PaginationItem>
          <PaginationNext className="pagination-step" aria-label={t('common.pagination_next')}>
            <IconChevronRight size={16} aria-hidden="true" />
          </PaginationNext>
        </PaginationItem>
      </PaginationList>
    </SdkPagination>
  );
}
