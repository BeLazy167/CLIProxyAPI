import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconChevronUp,
  IconSlidersHorizontal,
  IconX,
} from '@/components/ui/icons';
import { Popover } from '@/components/ui/Popover';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import type { ProviderSortBy, SortDir } from '../types';
import styles from './ProviderResourceToolbar.module.scss';

interface ProviderResourceToolbarProps {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

export function ProviderResourceToolbar({
  sortBy,
  sortDir,
  onSortBy,
  onSortDir,
  availableModels,
  selectedModels,
  onSelectedModelsChange,
}: ProviderResourceToolbarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const sortOptions = useMemo(
    () => [
      { value: 'name', label: t('providersPage.toolbar.sort.name') },
      { value: 'priority', label: t('providersPage.toolbar.sort.priority') },
      {
        value: 'recent-success',
        label: t('providersPage.toolbar.sort.recentSuccess'),
      },
    ],
    [t]
  );

  const toggleModel = (name: string) => {
    const next = new Set(selectedModels);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectedModelsChange(next);
  };

  const selectAll = () => onSelectedModelsChange(new Set(availableModels));
  const clearAll = () => onSelectedModelsChange(new Set());

  const normalizedQuery = query.trim().toLowerCase();
  const visibleModels = normalizedQuery
    ? availableModels.filter((name) => name.toLowerCase().includes(normalizedQuery))
    : availableModels;

  const sortDirLabel =
    sortDir === 'asc'
      ? t('providersPage.toolbar.sort.directionAsc')
      : t('providersPage.toolbar.sort.directionDesc');

  return (
    <div className={styles.root}>
      <div className={styles.sortGroup}>
        <span className={styles.label}>{t('providersPage.toolbar.sortBy')}</span>
        <Select
          value={sortBy}
          options={sortOptions}
          onChange={(value) => onSortBy(value as ProviderSortBy)}
          ariaLabel={t('providersPage.toolbar.sortBy')}
          size="sm"
          variant="quiet"
          fullWidth={false}
        />
        <button
          type="button"
          className={styles.dirBtn}
          onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          aria-label={sortDirLabel}
          title={sortDirLabel}
        >
          {sortDir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>

      <div className={styles.filterGroup}>
        <Popover
          label={t('providersPage.toolbar.filter.dialogLabel')}
          align="end"
          disabled={availableModels.length === 0}
          triggerClassName={`${styles.filterTrigger} ${selectedModels.size > 0 ? styles.filterTriggerActive : ''}`}
          className={styles.filterPanel}
          trigger={
            <>
              <IconSlidersHorizontal size={14} aria-hidden="true" />
              <span>
                {t('providersPage.toolbar.filter.label')}{' '}
                {selectedModels.size === 0 ? t('providersPage.toolbar.filter.all') : ''}
              </span>
              {selectedModels.size > 0 ? (
                <span className={styles.filterCount}>{selectedModels.size}</span>
              ) : null}
              <IconChevronDown size={12} aria-hidden="true" />
            </>
          }
        >
          <input
            type="search"
            className={styles.filterSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('providersPage.toolbar.filter.searchPlaceholder')}
            aria-label={t('providersPage.toolbar.filter.searchPlaceholder')}
          />
          <div className={styles.filterToolbar}>
            <button
              type="button"
              className={styles.filterToolbarBtn}
              onClick={selectAll}
              disabled={availableModels.length === 0}
            >
              {t('providersPage.toolbar.filter.selectAll')}
            </button>
            <button
              type="button"
              className={styles.filterToolbarBtn}
              onClick={clearAll}
              disabled={selectedModels.size === 0}
            >
              {t('providersPage.toolbar.filter.clear')}
            </button>
          </div>
          {visibleModels.length === 0 ? (
            <div className={styles.filterEmpty}>
              {availableModels.length === 0
                ? t('providersPage.toolbar.filter.empty')
                : t('providersPage.toolbar.filter.noMatch')}
            </div>
          ) : (
            <ul className={styles.filterList}>
              {visibleModels.map((name) => (
                <li key={name} className={styles.filterItem}>
                  <SelectionCheckbox
                    checked={selectedModels.has(name)}
                    onChange={() => toggleModel(name)}
                    label={<span className={styles.filterItemLabel}>{name}</span>}
                  />
                </li>
              ))}
            </ul>
          )}
        </Popover>
        {selectedModels.size > 0 ? (
          <button
            type="button"
            className={styles.filterClear}
            onClick={clearAll}
            aria-label={t('providersPage.toolbar.filter.clear')}
            title={t('providersPage.toolbar.filter.clear')}
          >
            <IconX size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
