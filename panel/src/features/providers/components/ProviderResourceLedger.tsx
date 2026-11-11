/**
 * 提供商条目列表:一条凭证一行(identity / health / routing / actions)。
 * 整行点击打开详情;行内控件自行处理点击。窄屏下行退化为堆叠卡片。
 */

import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconPencil, IconTrash2 } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import {
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  getProviderRecentStatusData,
  getProviderTotalStats,
  getProviderUsageKey,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import { useNow } from '@/hooks/useNow';
import type { OpenAIProviderConfig } from '@/types';
import type { StatusBarData } from '@/utils/recentRequests';
import { canTestResource, type ProviderTestResult } from '../providerTestStore';
import { isMultiProtocolSponsorBrand } from '../sponsorDefinitions';
import type { ProviderResource } from '../types';
import { ConnectivityStatusIcon } from '../sheets/forms/ConnectivityStatusIcon';
import styles from './ProviderResourceLedger.module.scss';
import statusBarStyles from './providerStatusBar.module.scss';

export interface ProviderResourceLedgerProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  testResults: Record<string, ProviderTestResult>;
  onOpen: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled: (resource: ProviderResource, disabled: boolean) => void;
  onTest: (resource: ProviderResource) => void;
}

/** 行内自带点击行为的元素;点到它们不打开详情。 */
const ROW_CONTROL_SELECTOR = 'button, input, label, a, [role="menu"], [role="dialog"]';

const resourceDisplayName = (resource: ProviderResource): string =>
  resource.name ?? resource.apiKeyPreview ?? resource.identifier;

const resolveStatusBarData = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentStatusData(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderRecentStatusData(
    usageByProvider,
    getProviderUsageKey(resource.brand),
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

const resolveTotalStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderTotalStats(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderTotalStats(
    usageByProvider,
    getProviderUsageKey(resource.brand),
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

export function ProviderResourceLedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.ledger} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={52} rounded={8} />
      ))}
    </div>
  );
}

function TestResultLine({ result }: { result: ProviderTestResult | undefined }) {
  const { t } = useTranslation();
  const now = useNow(result?.state === 'success' || result?.state === 'error');
  if (!result) return null;
  let text: string;
  if (result.state === 'loading') {
    text = t('providersPage.connectivity.stateLoading');
  } else {
    const minutes = Math.max(0, Math.floor((now - result.testedAt) / 60_000));
    const when =
      minutes < 1
        ? t('providersPage.connectivity.justNow')
        : t('providersPage.connectivity.minutesAgo', { count: minutes });
    text =
      result.state === 'success'
        ? [t('providersPage.connectivity.ok', { ms: result.latencyMs ?? 0 }), result.model, when]
            .filter(Boolean)
            .join(' · ')
        : `${result.message} · ${when}`;
  }
  return (
    <span
      className={`${styles.testLine} ${result.state === 'error' ? styles.testLineError : ''}`}
      title={text}
    >
      <ConnectivityStatusIcon state={result.state} />
      <span className={styles.testText}>{text}</span>
    </span>
  );
}

function LedgerRow(props: ProviderResourceLedgerProps & { resource: ProviderResource }) {
  const {
    resource,
    selectedId,
    disableMutations,
    usageByProvider,
    testResults,
    onOpen,
    onEdit,
    onDelete,
    onToggleDisabled,
    onTest,
  } = props;
  const { t } = useTranslation();
  const isSponsor = isMultiProtocolSponsorBrand(resource.brand);
  const name = resourceDisplayName(resource);
  const monoName = resource.name === null;
  const selected = resource.id === selectedId;
  const testResult = testResults[resource.id];
  const testable = canTestResource(resource);
  const stats = usageByProvider && !isSponsor ? resolveTotalStats(resource, usageByProvider) : null;
  const statusBar =
    usageByProvider && !isSponsor ? resolveStatusBarData(resource, usageByProvider) : null;

  const secondary = isSponsor
    ? (resource.flags.protocols ?? [])
        .map((protocol) => t(`providersPage.sponsor.protocols.${protocol}`))
        .join(' / ')
    : resource.brand === 'claude' && !resource.baseUrl
      ? `https://api.anthropic.com ${t('providersPage.status.defaultSuffix')}`
      : (resource.baseUrl ?? t('providersPage.status.notSet'));

  const chips: Array<{ key: string; label: string; tone?: 'muted' | 'accent' }> = [];
  if (resource.disabled) {
    chips.push({ key: 'disabled', label: t('providersPage.status.disabled'), tone: 'muted' });
  }
  if (resource.prefix) chips.push({ key: 'prefix', label: resource.prefix });
  if (resource.brand === 'openaiCompatibility' && resource.apiKeyEntryCount > 1) {
    chips.push({
      key: 'keys',
      label: t('providersPage.table.keysCount', { count: resource.apiKeyEntryCount }),
    });
  }
  if ((resource.brand === 'codex' || resource.brand === 'xai') && resource.flags.websockets) {
    chips.push({ key: 'ws', label: t('providersPage.table.websocketsTag'), tone: 'accent' });
  }
  if (resource.brand === 'claude' && resource.flags.cloakEnabled) {
    chips.push({ key: 'cloak', label: t('providersPage.table.cloakTag'), tone: 'accent' });
  }
  if (resource.brand === 'claude' && resource.flags.claudeCodeCliProfile) {
    chips.push({ key: 'cli', label: t('providersPage.table.cliProfileTag'), tone: 'accent' });
  }

  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if ((event.target as Element).closest(ROW_CONTROL_SELECTOR)) return;
    onOpen(resource);
  };

  const healthSummary = stats
    ? t('providersPage.table.healthSummary', {
        name,
        success: stats.success,
        failure: stats.failure,
        rate:
          statusBar && statusBar.totalSuccess + statusBar.totalFailure > 0
            ? `${Math.round(statusBar.successRate)}%`
            : '--',
      })
    : null;

  return (
    <li
      className={[
        styles.row,
        selected ? styles.rowSelected : '',
        resource.disabled ? styles.rowDisabled : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleRowClick}
      aria-current={selected ? 'true' : undefined}
    >
      <div className={styles.identity}>
        <div className={styles.primaryLine}>
          <button
            type="button"
            className={`${styles.primary} ${monoName ? styles.mono : ''}`}
            title={name}
            onClick={() => onOpen(resource)}
          >
            {name}
          </button>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={[
                styles.chip,
                chip.tone === 'muted' ? styles.chipMuted : '',
                chip.tone === 'accent' ? styles.chipAccent : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {chip.label}
            </span>
          ))}
        </div>
        <span className={styles.secondary} title={secondary}>
          {secondary}
        </span>
      </div>

      <div className={styles.health}>
        {stats ? (
          <>
            <span className={styles.srOnly}>{healthSummary}</span>
            <span className={styles.counts} aria-hidden="true">
              <span className={styles.countOk}>
                {t('providersPage.table.okCount', { count: stats.success })}
              </span>
              <span
                className={`${styles.countFail} ${stats.failure > 0 ? styles.countFailLive : ''}`}
              >
                {t('providersPage.table.failCount', { count: stats.failure })}
              </span>
            </span>
            {statusBar ? (
              <div className={styles.statusBarWrap} aria-hidden="true">
                <ProviderStatusBar statusData={statusBar} styles={statusBarStyles} />
              </div>
            ) : null}
          </>
        ) : (
          <span className={styles.none}>—</span>
        )}
        <span className={styles.testSlot} aria-live="polite">
          <TestResultLine result={testResult} />
        </span>
      </div>

      <div className={styles.routing}>
        {!isSponsor ? (
          <>
            <span
              className={styles.routingChip}
              title={t('providersPage.form.priority')}
              aria-label={`${t('providersPage.form.priority')} ${resource.priority}`}
            >
              <span className={styles.routingKey}>P</span>
              {resource.priority}
            </span>
            {resource.weight !== null ? (
              <span
                className={styles.routingChip}
                title={t('providersPage.form.weight')}
                aria-label={`${t('providersPage.form.weight')} ${resource.weight}`}
              >
                <span className={styles.routingKey}>W</span>
                {resource.weight}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={styles.actions}>
        <ToggleSwitch
          checked={!resource.disabled}
          disabled={disableMutations}
          onChange={(value) => onToggleDisabled(resource, !value)}
          ariaLabel={t(
            resource.disabled
              ? 'providersPage.actions.enableNamed'
              : 'providersPage.actions.disableNamed',
            { name }
          )}
        />
        {testable ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onTest(resource)}
            disabled={disableMutations || testResult?.state === 'loading'}
            aria-label={`${t('providersPage.connectivity.test')}: ${name}`}
            title={t('providersPage.connectivity.testHint')}
          >
            {t('providersPage.connectivity.test')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          onClick={() => onEdit(resource)}
          disabled={disableMutations}
          aria-label={`${t('providersPage.actions.edit')}: ${name}`}
          title={t('providersPage.actions.edit')}
        >
          <IconPencil size={14} aria-hidden="true" />
        </Button>
        <Button
          variant="danger-quiet"
          size="xs"
          iconOnly
          onClick={() => onDelete(resource)}
          disabled={disableMutations}
          aria-label={`${t('providersPage.actions.delete')}: ${name}`}
          title={t('providersPage.actions.delete')}
        >
          <IconTrash2 size={14} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function ProviderResourceLedger(props: ProviderResourceLedgerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.ledger}>
      <div className={styles.head} aria-hidden="true">
        <span>{t('providersPage.table.key')}</span>
        <span>{t('providersPage.table.health')}</span>
        <span>{t('providersPage.table.routing')}</span>
        <span className={styles.headActions}>{t('providersPage.table.actions')}</span>
      </div>
      <ul className={styles.rows}>
        {props.resources.map((resource) => (
          <LedgerRow key={resource.id} {...props} resource={resource} />
        ))}
      </ul>
    </div>
  );
}
