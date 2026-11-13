import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { IconSearch, IconX } from '@/components/ui/icons';
import type { VisualConfigValues } from '@/types/visualConfig';
import { FIELD_VALUE_KEYS } from '../constants';
import {
  CONFIG_FIELD_SEARCH_INDEX,
  searchConfigFields,
  type ConfigFieldSearchEntry,
} from '../searchIndex';
import styles from './ConfigSearch.module.scss';

export type ConfigSearchProps = {
  disabled?: boolean;
  /** 用户选中结果：由页面切换 tab 并滚动/脉冲目标字段（useFieldJump）。 */
  onJump: (entry: ConfigFieldSearchEntry) => void;
  /** 当前表单值：结果行显示该字段的当前值。 */
  values?: VisualConfigValues;
  /** 输入框 DOM id（页面用 `/` 快捷键聚焦）。 */
  inputId?: string;
};

/** 结果行里的当前值预览：布尔 → On/Off；空 → Not set；列表 → N items；长文本截断。 */
function previewValue(
  entry: ConfigFieldSearchEntry,
  values: VisualConfigValues,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const key = FIELD_VALUE_KEYS[entry.fieldId]?.[0];
  if (!key) return null;
  const value = key.startsWith('streaming.')
    ? values.streaming[key.slice('streaming.'.length) as keyof VisualConfigValues['streaming']]
    : values[key as keyof VisualConfigValues];
  if (typeof value === 'boolean') {
    return t(
      value ? 'config_management.visual.field_state.on' : 'config_management.visual.field_state.off'
    );
  }
  if (key === 'apiKeysText' && typeof value === 'string') {
    const count = value.split('\n').filter((line) => line.trim()).length;
    return t('config_management.visual.api_keys.count', { count });
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return t('common.not_set');
    if (entry.fieldId === 'rmSecretKey') return '••••••';
    return value.length > 28 ? `${value.slice(0, 27)}…` : value;
  }
  if (Array.isArray(value)) {
    return t('config_management.visual.field_state.items', { count: value.length });
  }
  return null;
}

/**
 * 全局字段搜索（标签 / YAML 键名 / 关键词），键盘可导航。
 * 跳转后保留输入文本，只收起结果列表，便于继续调整查询。
 */
export function ConfigSearch({ disabled = false, onJump, values, inputId }: ConfigSearchProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const searchResults = useMemo(() => searchConfigFields(searchQuery, t), [searchQuery, t]);
  const byFieldId = useMemo(
    () => new Map(searchResults.map((entry) => [entry.fieldId, entry])),
    [searchResults]
  );
  const placeholder = t('config_management.visual.search.placeholder', {
    count: CONFIG_FIELD_SEARCH_INDEX.length,
  });

  const renderResult = (fieldId: string) => {
    const entry = byFieldId.get(fieldId);
    if (!entry) return null;
    const preview = values ? previewValue(entry, values, t) : null;
    return (
      <span className={styles.searchResultItem}>
        <span className={styles.searchResultMain}>
          <span className={styles.searchResultLabel}>
            {t(entry.labelKey)}
            {entry.qualifierKey ? (
              <span className={styles.searchResultQualifier}>{t(entry.qualifierKey)}</span>
            ) : null}
          </span>
          {entry.yamlKeys ? (
            <span className={styles.searchResultYaml}>{entry.yamlKeys.join('.')}</span>
          ) : null}
        </span>
        <span className={styles.searchResultAside}>
          {preview !== null ? <span className={styles.searchResultValue}>{preview}</span> : null}
          <span className={styles.searchResultSection}>
            {t(`config_management.visual.sections.${entry.sectionId}.title`)}
          </span>
        </span>
      </span>
    );
  };

  return (
    <div className={styles.searchBox}>
      <AutocompleteInput
        id={inputId}
        className={styles.searchControl}
        placeholder={placeholder}
        ariaLabel={placeholder}
        value={searchQuery}
        onChange={setSearchQuery}
        disabled={disabled}
        options={searchResults.map((entry) => entry.fieldId)}
        prefiltered
        autoHighlight
        openOnFocus={false}
        hideTrigger
        emptyText={searchQuery.trim() ? t('config_management.visual.search.no_results') : undefined}
        renderOption={renderResult}
        onSelect={(fieldId) => {
          const entry = byFieldId.get(fieldId);
          if (entry) onJump(entry);
        }}
        rightElement={
          searchQuery ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear_search')}
              disabled={disabled}
            >
              <IconX size={14} />
            </button>
          ) : (
            <span className={styles.searchIcon} aria-hidden="true">
              <kbd className={styles.shortcutKey}>/</kbd>
              <IconSearch size={16} />
            </span>
          )
        }
      />
    </div>
  );
}
