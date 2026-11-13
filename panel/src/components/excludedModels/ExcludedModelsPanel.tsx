import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconSearch } from '@/components/ui/icons';
import { Listbox, type ListboxChange } from '@/components/ui/Listbox';
import {
  getModelExclusionState,
  type ExclusionStats,
  type ModelExclusionState,
} from './excludedModelRules';
import styles from './ExcludedModelsPicker.module.scss';

export interface ExcludedModelCandidate {
  id: string;
  displayName?: string;
}

interface ExcludedModelsPanelProps {
  rules: readonly string[];
  candidates: readonly ExcludedModelCandidate[];
  /** 由 Picker 算好传下来，避免在 footer 里把整个目录再扫一遍。 */
  stats: ExclusionStats;
  /** Every model whose exclusion changed in one gesture, applied together. */
  onToggle: (changes: ListboxChange[]) => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled: boolean;
  listboxId: string;
  /** 展开后是否把焦点送进搜索框（键盘展开时为 true，鼠标点开时也为 true）。 */
  autoFocus: boolean;
  /** 收起面板并把焦点还给 trigger。 */
  onDismiss: () => void;
}

const matchesQuery = (candidate: ExcludedModelCandidate, query: string): boolean =>
  candidate.id.toLowerCase().includes(query) ||
  (candidate.displayName ?? '').toLowerCase().includes(query);

export function ExcludedModelsPanel({
  rules,
  candidates,
  stats,
  onToggle,
  onSelectAll,
  onClear,
  disabled,
  listboxId,
  autoFocus,
  onDismiss,
}: ExcludedModelsPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) => matchesQuery(candidate, normalized));
  }, [candidates, query]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    // preventScroll：裸 focus() 会把外层 Sheet 的滚动猛拽过来，动画中途还会把面板顶出视野。
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const toggle = (changes: ListboxChange[]) => {
    if (disabled) return;
    // 纯通配符命中的行不可直接切换——它的排除权属于那条规则。行内副文本常驻解释原因。
    const allowed = changes.filter((change) => {
      const current = getModelExclusionState(rules, change.value);
      return !(current.state === 'excluded' && current.by === 'wildcard');
    });
    if (allowed.length > 0) onToggle(allowed);
  };

  // 外层 Sheet 在 document 上、OAuth 页在 window 上都听 Escape。
  // 不拦住就会「关面板 = 关 Sheet / 离开页面 + 触发未保存弹窗」。
  const handleEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (query) {
      setQuery('');
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    onDismiss();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault();
      listRef.current
        ?.querySelector<HTMLElement>('[data-slot="listbox-item"][tabindex="0"]')
        ?.focus();
      return;
    }
    if (event.key === 'Enter' && visible.length > 0) {
      // Enter in the search toggles the first match, as it did before the list took focus.
      event.preventDefault();
      const first = visible[0];
      toggle([
        { value: first.id, selected: getModelExclusionState(rules, first.id).state !== 'excluded' },
      ]);
      return;
    }
    handleEscape(event);
  };

  const excludedIds = visible
    .filter((candidate) => getModelExclusionState(rules, candidate.id).state === 'excluded')
    .map((candidate) => candidate.id);

  return (
    <div className={styles.panel}>
      <div className={styles.searchRow}>
        <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('excluded_models.search_placeholder')}
          aria-label={t('excluded_models.search_aria')}
          aria-controls={listboxId}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div ref={listRef}>
        {visible.length === 0 ? (
          <p className={styles.noResults}>
            {query.trim()
              ? t('excluded_models.no_results', { query: query.trim() })
              : t('excluded_models.catalog_empty')}
          </p>
        ) : (
          <Listbox
            id={listboxId}
            className={styles.list}
            ariaLabel={t('excluded_models.list_aria')}
            disabled={disabled}
            value={excludedIds}
            onChange={toggle}
            onKeyDown={handleEscape}
            options={visible.map((candidate) => {
              const state = getModelExclusionState(rules, candidate.id);
              const lockedByRule = state.state === 'excluded' && state.by === 'wildcard';
              return {
                value: candidate.id,
                label: candidate.id,
                disabled: lockedByRule,
                className: [
                  styles.row,
                  state.state === 'excluded' ? styles.rowExcluded : '',
                  lockedByRule ? styles.rowLocked : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                content: <ExcludedModelRow candidate={candidate} state={state} />,
              };
            })}
          />
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerCount}>
          {t('excluded_models.footer_count', { excluded: stats.excluded, total: stats.total })}
        </span>
        <span className={styles.footerActions}>
          <button
            type="button"
            className={styles.footerButton}
            onClick={onSelectAll}
            disabled={disabled || candidates.length === 0}
          >
            {t('excluded_models.select_all')}
          </button>
          <button
            type="button"
            className={styles.footerButton}
            onClick={onClear}
            disabled={disabled}
            aria-label={t('excluded_models.clear_aria')}
          >
            {t('excluded_models.clear')}
          </button>
        </span>
      </div>
    </div>
  );
}

interface ExcludedModelRowProps {
  candidate: ExcludedModelCandidate;
  state: ModelExclusionState;
}

function ExcludedModelRow({ candidate, state }: ExcludedModelRowProps) {
  const { t } = useTranslation();
  const excluded = state.state === 'excluded';
  // 把「哪条规则、用哪句话解释」在一处收敛好，下面的 JSX 就不必再做类型收窄。
  const wildcardReason =
    state.state === 'excluded' && (state.by === 'wildcard' || state.by === 'both')
      ? {
          rule: state.rule,
          text:
            state.by === 'wildcard'
              ? t('excluded_models.wildcard_locked', { rule: state.rule })
              : t('excluded_models.also_wildcard', { rule: state.rule }),
          muted: state.by === 'both',
        }
      : null;

  return (
    <>
      <span className={styles.checkbox} aria-hidden="true">
        {excluded ? <IconCheck size={12} /> : null}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowId}>{candidate.id}</span>
        {candidate.displayName && candidate.displayName !== candidate.id ? (
          <span className={styles.rowDisplayName}>{candidate.displayName}</span>
        ) : null}
        {wildcardReason ? <span className={styles.rowReason}>{wildcardReason.text}</span> : null}
      </span>
      {wildcardReason ? (
        <span className={`${styles.badge} ${wildcardReason.muted ? styles.badgeMuted : ''}`.trim()}>
          {t('excluded_models.badge_wildcard')}
        </span>
      ) : null}
    </>
  );
}
