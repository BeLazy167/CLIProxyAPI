import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchField } from '@/components/ui/SearchField';
import { IconExternalLink, IconLoader2, IconPlus } from '@/components/ui/icons';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { PROVIDER_LOGOS } from '../brandLogos';
import { getKimiAffiliateUrl } from '../kimi';
import { canTestResource, type ProviderTestResult } from '../providerTestStore';
import { APIKEY_FUN_AFFILIATE_URL, APIKEY_FUN_DASHBOARD_URL } from '../sponsor';
import { getSponsorProviderDefinition } from '../sponsorDefinitions';
import type { ProviderGroup, ProviderResource, ProviderSortBy, SortDir } from '../types';
import { ProviderResourceLedger } from './ProviderResourceLedger';
import { ProviderResourceToolbar } from './ProviderResourceToolbar';
import styles from './ProviderResourcePanel.module.scss';

export interface ProviderPanelControls {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

interface ProviderResourcePanelProps {
  group: ProviderGroup;
  filter: string;
  onFilterChange: (value: string) => void;
  filteredResources: ProviderResource[];
  selectedId: string | null;
  disableMutations?: boolean;
  isFetching?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  toolbarControls?: ProviderPanelControls;
  testResults: Record<string, ProviderTestResult>;
  testingAll?: boolean;
  onTest: (resource: ProviderResource) => void;
  onTestAll: () => void;
  onOpen: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled: (resource: ProviderResource, disabled: boolean) => void;
  onCreate: () => void;
}

export function ProviderResourcePanel({
  group,
  filter,
  onFilterChange,
  filteredResources,
  selectedId,
  disableMutations,
  isFetching,
  usageByProvider,
  toolbarControls,
  testResults,
  testingAll,
  onTest,
  onTestAll,
  onOpen,
  onEdit,
  onDelete,
  onToggleDisabled,
  onCreate,
}: ProviderResourcePanelProps) {
  const { t, i18n } = useTranslation();
  const logo = PROVIDER_LOGOS[group.id];
  const providerTitle = t(`providersPage.providerNames.${group.id}`);
  const hasResources = group.resources.length > 0;
  const showSponsorRegistrationLink = group.id === 'apikeyFun' && !hasResources;
  const showSponsorDashboardLink = group.id === 'apikeyFun' && hasResources;
  const registrationUrl =
    group.id === 'kimi'
      ? getKimiAffiliateUrl(i18n.resolvedLanguage ?? i18n.language)
      : group.id === 'fennoAI' || group.id === 'qiniuCloud'
        ? getSponsorProviderDefinition(group.id).affiliateUrl
        : null;
  const testableCount = group.resources.filter((r) => canTestResource(r) && !r.disabled).length;
  const hasActiveFilter = filter.trim() !== '' || (toolbarControls?.selectedModels.size ?? 0) > 0;
  const clearFilters = () => {
    onFilterChange('');
    toolbarControls?.onSelectedModelsChange(new Set());
  };

  const logoClassName = [
    styles.logo,
    logo?.themeSurface ? styles.logoThemeSurface : '',
    logo?.darkSrc ? styles.logoThemeLight : '',
    logo?.invertOnDark ? styles.logoInvertOnDark : '',
  ]
    .filter(Boolean)
    .join(' ');
  const darkLogoClassName = [
    styles.logo,
    logo?.themeSurface ? styles.logoThemeSurface : '',
    styles.logoThemeDark,
  ]
    .filter(Boolean)
    .join(' ');

  const titleContent = (
    <>
      {logo ? (
        <>
          <img src={logo.src} alt="" aria-hidden="true" className={logoClassName} />
          {logo.darkSrc ? (
            <img src={logo.darkSrc} alt="" aria-hidden="true" className={darkLogoClassName} />
          ) : null}
        </>
      ) : null}
      <h2 className={styles.title}>{providerTitle}</h2>
      {showSponsorDashboardLink ? (
        <IconExternalLink className={styles.titleExternalIcon} size={16} />
      ) : null}
    </>
  );

  const renderBody = () => {
    if (!hasResources) {
      return (
        <EmptyState
          title={
            showSponsorRegistrationLink
              ? t('providersPage.sponsor.emptyRegisterHint')
              : t('providersPage.table.emptyTitle', { provider: providerTitle })
          }
          description={
            showSponsorRegistrationLink ? undefined : t('providersPage.table.emptyDescription')
          }
          action={
            showSponsorRegistrationLink ? (
              <a
                className={`${styles.emptyActionButton} ${styles.emptyActionButtonEmphasis}`}
                href={APIKEY_FUN_AFFILIATE_URL}
                target="_blank"
                rel="noreferrer"
              >
                <IconExternalLink size={16} />
                <span>{t('providersPage.sponsor.registerLink')}</span>
              </a>
            ) : (
              <Button variant="primary" size="sm" onClick={onCreate} disabled={disableMutations}>
                <IconPlus size={14} aria-hidden="true" />
                {t('providersPage.actions.addNamed', { provider: providerTitle })}
              </Button>
            )
          }
        />
      );
    }
    if (filteredResources.length === 0) {
      return (
        <EmptyState
          title={t('providersPage.table.noMatchTitle')}
          description={t('providersPage.table.noMatchDescription', {
            count: group.resources.length,
          })}
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {t('common.clear_search')}
            </Button>
          }
        />
      );
    }
    return (
      <ProviderResourceLedger
        resources={filteredResources}
        selectedId={selectedId}
        disableMutations={disableMutations}
        usageByProvider={usageByProvider}
        testResults={testResults}
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleDisabled={onToggleDisabled}
        onTest={onTest}
      />
    );
  };

  return (
    <section className={styles.panel} aria-labelledby={`providers-panel-${group.id}`}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleArea} id={`providers-panel-${group.id}`}>
            {showSponsorDashboardLink ? (
              <a
                className={`${styles.titleRow} ${styles.titleLink}`}
                href={APIKEY_FUN_DASHBOARD_URL}
                target="_blank"
                rel="noreferrer"
                title={t('providersPage.sponsor.dashboardLink')}
              >
                {titleContent}
              </a>
            ) : (
              <div className={styles.titleRow}>{titleContent}</div>
            )}
            {showSponsorDashboardLink ? (
              <a
                className={styles.sponsorLink}
                href={APIKEY_FUN_DASHBOARD_URL}
                target="_blank"
                rel="noreferrer"
              >
                {t('providersPage.sponsor.dashboardLink')}
                <IconExternalLink size={12} aria-hidden="true" />
              </a>
            ) : registrationUrl ? (
              <a
                className={styles.sponsorLink}
                href={registrationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('providersPage.sponsor.registerLink')}
                <IconExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <div className={styles.headerActions}>
            {isFetching ? (
              <span className={styles.refreshing} role="status">
                <IconLoader2 size={14} className={styles.spin} aria-hidden="true" />
                {t('providersPage.actions.refreshing')}
              </span>
            ) : null}
            {testableCount > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onTestAll}
                disabled={disableMutations || testingAll}
                loading={testingAll}
                title={t('providersPage.connectivity.testAllHint', { count: testableCount })}
              >
                {t('providersPage.connectivity.testAll')}
              </Button>
            ) : null}
            {hasResources ? (
              <Button variant="primary" size="sm" onClick={onCreate} disabled={disableMutations}>
                <IconPlus size={14} aria-hidden="true" />
                {t('providersPage.actions.addNamed', { provider: providerTitle })}
              </Button>
            ) : null}
          </div>
        </div>
        {hasResources ? (
          <div className={styles.toolbarRow}>
            <SearchField
              className={styles.search}
              value={filter}
              onChange={onFilterChange}
              placeholder={t('providersPage.table.filterPlaceholder')}
              ariaLabel={t('providersPage.table.filterAriaLabel', { provider: providerTitle })}
              clearLabel={t('common.clear_search')}
            />
            {toolbarControls ? (
              <ProviderResourceToolbar
                key={group.id}
                sortBy={toolbarControls.sortBy}
                sortDir={toolbarControls.sortDir}
                onSortBy={toolbarControls.onSortBy}
                onSortDir={toolbarControls.onSortDir}
                availableModels={toolbarControls.availableModels}
                selectedModels={toolbarControls.selectedModels}
                onSelectedModelsChange={toolbarControls.onSelectedModelsChange}
              />
            ) : null}
          </div>
        ) : null}
        {hasResources && testableCount > 0 ? (
          <p className={styles.testHint}>{t('providersPage.connectivity.testHint')}</p>
        ) : null}
      </div>

      {renderBody()}

      {hasResources && filteredResources.length > 0 && hasActiveFilter ? (
        <p className={styles.resultCount} role="status">
          {t('providersPage.table.showingCount', {
            shown: filteredResources.length,
            total: group.resources.length,
          })}
        </p>
      ) : null}
    </section>
  );
}
