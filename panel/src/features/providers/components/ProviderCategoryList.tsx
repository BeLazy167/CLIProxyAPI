import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { scrollProviderTabs } from '@/features/authFiles/components/providerTabsWheel';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  /** 需要关注的品牌(含禁用条目或近期失败) */
  attentionBrands?: ReadonlySet<ProviderBrand>;
  onSelect: (brand: ProviderBrand) => void;
}

const PRECONFIGURED_BRAND_ORDER: readonly ProviderBrand[] = ['fennoAI', 'qiniuCloud'];

const PRECONFIGURED_BRANDS: ReadonlySet<ProviderBrand> = new Set(PRECONFIGURED_BRAND_ORDER);

function BrandLogo({ brand, className }: { brand: ProviderBrand; className: string }) {
  const logo = PROVIDER_LOGOS[brand];
  if (!logo) return null;
  const base = [
    className,
    logo.transparent ? styles.logoTransparent : '',
    logo.themeSurface ? styles.logoThemeSurface : '',
  ]
    .filter(Boolean)
    .join(' ');
  const light = [
    base,
    logo.darkSrc ? styles.logoThemeLight : '',
    logo.invertOnDark ? styles.logoInvertOnDark : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <img src={logo.src} alt="" aria-hidden="true" className={light} />
      {logo.darkSrc ? (
        <img
          src={logo.darkSrc}
          alt=""
          aria-hidden="true"
          className={`${base} ${styles.logoThemeDark}`}
        />
      ) : null}
    </>
  );
}

/**
 * 提供商分类导航:>=1280px 为左侧纵向栏,更窄时退化为横向可滚动的 tab 行。
 * 两种形态同时渲染,由 CSS 媒体查询切换显示。
 */
export function ProviderCategoryList({
  groups,
  activeBrand,
  attentionBrands,
  onSelect,
}: ProviderCategoryListProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React 的 wheel 事件是 passive 的;本地监听才能阻止页面随之滚动。
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  const preconfiguredGroups = groups
    .filter((g) => PRECONFIGURED_BRANDS.has(g.id))
    .sort(
      (left, right) =>
        PRECONFIGURED_BRAND_ORDER.indexOf(left.id) - PRECONFIGURED_BRAND_ORDER.indexOf(right.id)
    );
  const providerGroups = groups.filter((g) => !PRECONFIGURED_BRANDS.has(g.id));
  const needsAttention = (brand: ProviderBrand) => attentionBrands?.has(brand) ?? false;

  const renderGroups = (items: ProviderGroup[]) => (
    <div className={styles.list}>
      {items.map((group) => {
        const active = group.id === activeBrand;
        const total = group.resources.length;
        const activeCount = group.resources.filter((r) => !r.disabled).length;
        const attention = needsAttention(group.id);
        const itemClass = [
          styles.item,
          active ? styles.active : '',
          group.id === 'kimi' ? styles.itemKimi : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={group.id}
            type="button"
            className={itemClass}
            onClick={() => onSelect(group.id)}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.itemLeft}>
              <BrandLogo brand={group.id} className={styles.logo} />
              <span className={styles.itemText}>
                <span className={styles.itemTitle}>
                  {t(`providersPage.providerNames.${group.id}`)}
                </span>
                <span className={styles.itemSubtitle}>
                  {t('providersPage.categories.activeCount', {
                    active: activeCount,
                    total,
                  })}
                </span>
              </span>
            </span>
            {attention ? (
              <span
                className={styles.attentionDot}
                role="img"
                aria-label={t('providersPage.categories.attention')}
                title={t('providersPage.categories.attention')}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );

  const orderedTabs = [...providerGroups, ...preconfiguredGroups];

  return (
    <>
      <div className={styles.stack}>
        <aside className={styles.aside}>
          <p className={styles.eyebrow}>{t('providersPage.categories.title')}</p>
          {renderGroups(providerGroups)}
        </aside>
        {preconfiguredGroups.length > 0 && (
          <aside className={styles.aside}>
            <p className={styles.eyebrow}>{t('providersPage.categories.preconfigured')}</p>
            {renderGroups(preconfiguredGroups)}
          </aside>
        )}
      </div>

      <div
        ref={tabsRef}
        className={styles.tabs}
        role="group"
        aria-label={t('providersPage.categories.title')}
      >
        {orderedTabs.map((group) => {
          const active = group.id === activeBrand;
          return (
            <button
              key={group.id}
              type="button"
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              aria-pressed={active}
              onClick={() => onSelect(group.id)}
            >
              <span className={styles.tabIconWrap}>
                <BrandLogo brand={group.id} className={styles.tabIcon} />
              </span>
              <span className={styles.tabLabel}>
                {t(`providersPage.providerNames.${group.id}`)}
              </span>
              <span className={styles.tabCount}>{group.resources.length}</span>
              {needsAttention(group.id) ? (
                <span
                  className={styles.attentionDot}
                  role="img"
                  aria-label={t('providersPage.categories.attention')}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
