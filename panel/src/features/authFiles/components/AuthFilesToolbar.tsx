import { useTranslation } from 'react-i18next';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';
import type {
  AuthFilesSortMode,
  AuthFilesStatusFilterMode,
  AuthFilesViewMode,
} from '@/features/authFiles/uiState';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import styles from './AuthFilesToolbar.module.scss';

export type AuthFilesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilterMode: AuthFilesStatusFilterMode;
  statusFilterOptions: Array<{ value: AuthFilesStatusFilterMode; label: string }>;
  onStatusFilterChange: (mode: AuthFilesStatusFilterMode) => void;
  sortMode: AuthFilesSortMode;
  sortOptions: Array<{ value: string; label: string }>;
  onSortModeChange: (value: string) => void;
  viewMode: AuthFilesViewMode;
  onViewModeChange: (mode: AuthFilesViewMode) => void;
  /** Destructive list-scoped actions live behind "..." rather than next to the filters. */
  menuItems: OverflowMenuItem[];
};

/**
 * 工作区工具栏：搜索 · 状态分段 · 排序 · 行/卡片切换 · 溢出菜单。
 */
export function AuthFilesToolbar(props: AuthFilesToolbarProps) {
  const {
    search,
    onSearchChange,
    statusFilterMode,
    statusFilterOptions,
    onStatusFilterChange,
    sortMode,
    sortOptions,
    onSortModeChange,
    viewMode,
    onViewModeChange,
    menuItems,
  } = props;
  const { t } = useTranslation();
  const viewOptions: Array<{ value: AuthFilesViewMode; label: string }> = [
    { value: 'rows', label: t('auth_files.view_rows') },
    { value: 'cards', label: t('auth_files.view_cards') },
  ];

  return (
    <div className={styles.toolbar}>
      <SearchField
        value={search}
        onChange={onSearchChange}
        placeholder={t('auth_files.search_placeholder')}
        ariaLabel={t('auth_files.search_label')}
        clearLabel={t('common.clear_search')}
        className={styles.search}
      />

      <div
        className={styles.segmented}
        role="group"
        aria-label={t('auth_files.problem_filter_label')}
      >
        {statusFilterOptions.map((option) => {
          const isActive = statusFilterMode === option.value;
          const isProblem = option.value === 'problem';
          return (
            <button
              key={option.value}
              type="button"
              className={`${styles.segment} ${isActive ? styles.segmentActive : ''} ${
                isProblem ? styles.segmentProblem : ''
              }`}
              aria-pressed={isActive}
              onClick={() => onStatusFilterChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <Select
        value={sortMode}
        options={sortOptions}
        onChange={onSortModeChange}
        ariaLabel={t('auth_files.sort_label')}
        size="sm"
        variant="quiet"
        fullWidth={false}
        className={styles.sort}
      />

      <div className={styles.trailing}>
        <div className={styles.segmented} role="group" aria-label={t('auth_files.view_label')}>
          {viewOptions.map((option) => {
            const isActive = viewMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`${styles.segment} ${isActive ? styles.segmentActive : ''}`}
                aria-pressed={isActive}
                onClick={() => onViewModeChange(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <OverflowMenu items={menuItems} label={t('auth_files.more_actions')} />
      </div>
    </div>
  );
}
