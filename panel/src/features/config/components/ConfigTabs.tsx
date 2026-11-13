import { useEffect, useRef } from 'react';
import { Tab, TabList } from '@/components/ui/Tabs';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@/hooks/motion';
import { CONFIG_TAB_ICONS, CONFIG_TAB_IDS, type ConfigTabId } from '../constants';
import styles from './ConfigTabs.module.scss';

export type ConfigTabsProps = {
  active: ConfigTabId;
  /** 每 tab 校验错误数（uiState.countSectionErrors 的产物），>0 显示失败色徽章。 */
  errorCounts: Partial<Record<ConfigTabId, number>>;
  /** 有待保存修改的 tabs（uiState.resolveDirtyTabs 的产物），显示琥珀脏点。 */
  dirtyTabs: ReadonlySet<ConfigTabId>;
  /** 有非阻断警告的 tabs（如远程访问已开但管理密钥为空），显示琥珀「!」徽章。 */
  warningTabs?: ReadonlySet<ConfigTabId>;
  disabled?: boolean;
};

/**
 * 分区 tab 列表，放在 ConfigPage 的 Tabs 根里（选中与切换由根管）。
 * 分区 tabs：安静的下划线式（与提供商 tabs 同语汇），图标 + 标签 + 错误徽章 + 脏点。
 * 「常用」是首 tab；tab 切换是高频操作，零动画。
 */
export function ConfigTabs({
  active,
  errorCounts,
  dirtyTabs,
  warningTabs,
  disabled = false,
}: ConfigTabsProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 移动端横滚时把激活 tab 带回视野中央；无溢出时不动，避免无谓的页面滚动。
  useEffect(() => {
    const scroller = wrapRef.current?.firstElementChild;
    const tab = scroller?.querySelector<HTMLElement>('[data-selected]');
    if (!scroller || !tab) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    tab.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [active]);

  return (
    <div ref={wrapRef} className={styles.tabsWrap}>
      <TabList className={styles.tabs} aria-label={t('config_management.title')}>
        {CONFIG_TAB_IDS.map((id) => {
          const Icon = CONFIG_TAB_ICONS[id];
          const errorCount = errorCounts[id] ?? 0;
          const isDirty = dirtyTabs.has(id);
          const hasWarning = warningTabs?.has(id) ?? false;
          const tabLabel = t(`config_management.visual.sections.${id}.title`);
          const accessibleLabel = [
            tabLabel,
            errorCount > 0 ? t('config_management.meta_errors', { count: errorCount }) : null,
            hasWarning ? t('config_management.meta_warning') : null,
            isDirty ? t('config_management.status_dirty_short') : null,
          ]
            .filter(Boolean)
            .join(', ');

          return (
            <Tab
              key={id}
              value={id}
              aria-label={accessibleLabel}
              className={styles.tab}
              disabled={disabled}
            >
              <Icon size={15} className={styles.tabGlyph} />
              <span className={styles.tabLabel}>{tabLabel}</span>
              {errorCount > 0 ? (
                <span className={styles.tabBadge} aria-hidden="true">
                  {errorCount}
                </span>
              ) : null}
              {hasWarning ? (
                <span className={styles.tabWarningBadge} aria-hidden="true">
                  !
                </span>
              ) : null}
              {isDirty ? <span className={styles.tabDirtyDot} aria-hidden="true" /> : null}
            </Tab>
          );
        })}
      </TabList>
    </div>
  );
}
