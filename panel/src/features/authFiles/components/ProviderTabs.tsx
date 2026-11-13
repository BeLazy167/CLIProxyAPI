import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import { Tab, TabList, Tabs } from '@/components/ui/Tabs';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { scrollProviderTabs } from './providerTabsWheel';
import styles from './ProviderTabs.module.scss';

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  resolvedTheme: ResolvedTheme;
  onChange: (type: string) => void;
};

/**
 * 提供商过滤 tabs：水平排布，支持鼠标滚轮与触屏横向滚动。
 * 品牌色只出现在图标上，激活态是文字 + 2px 墨色下划线。
 */
export function ProviderTabs({
  types,
  counts,
  active,
  resolvedTheme,
  onChange,
}: ProviderTabsProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = wrapRef.current?.firstElementChild as HTMLElement | null | undefined;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React delegates wheel events passively; use a local listener to prevent page scrolling.
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={wrapRef} className={styles.tabsWrap}>
      <Tabs value={active} onChange={onChange}>
        <TabList className={styles.tabs} aria-label={t('auth_files.filter_all')}>
          {types.map((type) => {
            const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);
            const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);

            return (
              <Tab key={type} value={type} className={styles.tab}>
                {type === 'all' ? (
                  <IconFilterAll className={styles.tabGlyph} size={15} />
                ) : (
                  <span
                    className={styles.tabIconWrap}
                    style={
                      // 与 AI 提供商界面一致：Kimi 图标底座随主题切换颜色
                      isThemeSurfaceIconProvider(type)
                        ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                        : undefined
                    }
                  >
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className={styles.tabIcon} />
                    ) : (
                      <span className={styles.tabIconFallback}>
                        {label.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                <span className={styles.tabLabel}>{label}</span>
                <span className={styles.tabCount}>{counts[type] ?? 0}</span>
              </Tab>
            );
          })}
        </TabList>
      </Tabs>
    </div>
  );
}
