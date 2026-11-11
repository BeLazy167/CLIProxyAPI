/**
 * Default Vault view: one dense row per credential, grouped by provider.
 * Row click opens Details; controls inside the row stop that. Quota is a
 * single compact meter (worst window) fed from the shared quota store.
 */

import { useId, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChevronDown, IconModelCluster, IconRefreshCw } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { AuthFileItem } from '@/types';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import type { QuotaCardState } from '@/features/quota/providers';
import { formatQuotaWindowLabel, formatRemainingPercent } from '@/features/quota/quotaWindows';
import { remainingTone } from '@/features/quota/components/quotaTone';
import {
  getAuthFileIcon,
  getAuthFileStatusMessage,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isProblemAuthFile,
  isRuntimeOnlyAuthFile,
  isThemeSurfaceIconProvider,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { resolveQuotaProviderType, worstQuotaWindow } from '@/features/authFiles/quotaSummary';
import { AuthFileCooldownChip } from './AuthFileCooldownChip';
import { OverflowMenu } from './OverflowMenu';
import styles from './AuthFilesLedger.module.scss';

export type AuthFilesLedgerGroup = { provider: string; files: AuthFileItem[] };

export type AuthFilesLedgerProps = {
  groups: AuthFilesLedgerGroup[];
  now: number;
  resolvedTheme: ResolvedTheme;
  displayNameFor: (name: string) => string;
  selectedFiles: Set<string>;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  quotaFor: (file: AuthFileItem) => QuotaCardState | undefined;
  quotaLoading: boolean;
  onLoadGroupQuota: (files: AuthFileItem[]) => void;
  onRefreshQuota: (file: AuthFileItem) => void;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onOpenDetails: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
};

const TONE_CLASS = {
  high: styles.fillHigh,
  medium: styles.fillMedium,
  low: styles.fillLow,
} as const;

/** Elements inside a row that own their own click; a click there must not open Details. */
const ROW_CONTROL_SELECTOR = 'button, input, label, a, [role="menu"], [role="dialog"]';

export function AuthFilesLedgerSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.ledger} aria-hidden="true">
      <Skeleton width={160} height={16} rounded={6} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={44} rounded={8} />
      ))}
    </div>
  );
}

function ProviderIcon({
  provider,
  resolvedTheme,
}: {
  provider: string;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  return (
    <span
      className={styles.glyph}
      aria-hidden="true"
      style={
        isThemeSurfaceIconProvider(provider)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.glyphIcon} />
      ) : (
        <span className={styles.glyphFallback}>
          {getTypeLabel(t, provider).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function QuotaCell({
  file,
  quota,
  now,
  disabled,
  onLoad,
}: {
  file: AuthFileItem;
  quota: QuotaCardState | undefined;
  now: number;
  disabled: boolean;
  onLoad: () => void;
}) {
  const { t, i18n } = useTranslation();
  const type = resolveQuotaProviderType(file);
  if (!type || file.disabled === true || isRuntimeOnlyAuthFile(file)) {
    return <span className={styles.quotaNone}>—</span>;
  }
  const status = quota?.status ?? 'idle';
  if (status === 'loading') {
    return (
      <span className={styles.quotaLoading} aria-busy="true">
        <span className={styles.srOnly}>{t('common.loading')}</span>
        <span className={`${styles.track} ${styles.trackSkeleton}`} />
      </span>
    );
  }
  if (status === 'error') {
    const message = resolveQuotaErrorMessage(
      t,
      quota?.errorStatus,
      quota?.error || t('common.unknown_error')
    );
    return (
      <button
        type="button"
        className={`${styles.quotaAction} ${styles.quotaError}`}
        onClick={onLoad}
        disabled={disabled}
        title={message}
        aria-label={`${t('auth_files.quota_cell_failed')}: ${message}`}
      >
        {t('auth_files.quota_cell_failed')}
      </button>
    );
  }
  if (status !== 'success') {
    return (
      <button
        type="button"
        className={styles.quotaAction}
        onClick={onLoad}
        disabled={disabled}
        title={t('auth_files.quota_refresh_hint')}
      >
        {t('auth_files.quota_cell_load')}
      </button>
    );
  }
  const worst = worstQuotaWindow(type, quota);
  if (!worst || worst.remainingPercent === null) {
    return <span className={styles.quotaNone}>{formatRemainingPercent(null)}</span>;
  }
  const percent = worst.remainingPercent;
  const label = formatQuotaWindowLabel(t, worst.label);
  const reset =
    worst.resetAtMs !== null && worst.resetAtMs > now
      ? buildResetDisplay(null, worst.resetAtMs, now, i18n.resolvedLanguage)
      : null;
  return (
    <span className={styles.quotaMeter} title={`${label} · ${formatRemainingPercent(percent)}`}>
      <span className={styles.quotaHead}>
        <span className={styles.quotaPercent}>{formatRemainingPercent(percent)}</span>
        <span className={styles.quotaReset}>{reset?.relative ?? label}</span>
      </span>
      <span
        className={styles.track}
        role="meter"
        aria-label={t('quota_management.window_remaining_label', {
          label,
          percent: Math.round(percent),
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span
          className={`${styles.fill} ${TONE_CLASS[remainingTone(percent)]}`}
          style={{ width: `${Math.round(percent * 100) / 100}%` }}
        />
      </span>
    </span>
  );
}

function LedgerRow(props: AuthFilesLedgerProps & { file: AuthFileItem }) {
  const {
    file,
    now,
    displayNameFor,
    selectedFiles,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    quotaFor,
    onRefreshQuota,
    onShowModels,
    onDownload,
    onManualRefresh,
    onCooldownReset,
    onOpenDetails,
    onDelete,
    onToggleStatus,
    onToggleSelect,
  } = props;
  const { t } = useTranslation();
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const showModelsButton = !isRuntimeOnly || providerKey === 'aistudio';
  const showManualRefreshButton = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const refreshKey = getAuthFileRefreshKey(file);
  const isManualRefreshing = manualRefreshing[refreshKey] === true;
  const isStatusUpdating = statusUpdating[refreshKey] === true;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const identity = deriveAuthFileIdentity(file);
  const displayName = displayNameFor(identity.primary);
  const isDisabled = file.disabled === true;
  const isProblem = !isDisabled && isProblemAuthFile(file);
  const statusMessage = getAuthFileStatusMessage(file);
  const selected = selectedFiles.has(file.name);
  const hasCooldown = Boolean(file.cooldownSnapshot?.records?.length);

  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if (isRuntimeOnly || disableControls) return;
    if ((event.target as Element).closest(ROW_CONTROL_SELECTOR)) return;
    onOpenDetails(file);
  };

  return (
    <li
      className={[
        styles.row,
        selected ? styles.rowSelected : '',
        isDisabled ? styles.rowDisabled : '',
        isRuntimeOnly ? '' : styles.rowClickable,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleRowClick}
    >
      <div className={styles.select}>
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            ariaLabel={t('auth_files.card_select', { name: displayNameFor(file.name) })}
            title={t('auth_files.card_select', { name: displayNameFor(file.name) })}
          />
        )}
      </div>

      <div className={styles.identity}>
        <div className={styles.primaryLine}>
          <span
            className={`${styles.primary} ${identity.kind === 'fileName' ? styles.mono : ''}`}
            title={displayName}
          >
            {displayName}
          </span>
          {isRuntimeOnly && <span className={styles.chip}>{t('auth_files.type_virtual')}</span>}
          {isDisabled && (
            <span className={`${styles.chip} ${styles.chipMuted}`}>
              {t('auth_files.problem_filter_disabled')}
            </span>
          )}
          {isProblem && (
            <span className={`${styles.chip} ${styles.chipDanger}`} title={statusMessage}>
              {t('auth_files.problem_filter_problem')}
            </span>
          )}
          {hasCooldown && file.cooldownSnapshot && (
            <AuthFileCooldownChip
              snapshot={file.cooldownSnapshot}
              resetting={Boolean(authIndexKey && cooldownResetting[authIndexKey])}
              resetDisabled={disableControls || isStatusUpdating || isManualRefreshing}
              onReset={authIndexKey ? () => onCooldownReset(file) : undefined}
            />
          )}
        </div>
        {identity.secondary && (
          <span className={styles.secondary} title={displayNameFor(identity.fullName)}>
            {displayNameFor(identity.secondary)}
          </span>
        )}
        {isProblem && statusMessage && (
          <span className={styles.problemMessage} title={statusMessage}>
            {statusMessage}
          </span>
        )}
      </div>

      <div className={styles.quota}>
        <QuotaCell
          file={file}
          quota={quotaFor(file)}
          now={now}
          disabled={disableControls}
          onLoad={() => onRefreshQuota(file)}
        />
      </div>

      <div className={styles.counts}>
        <span className={styles.countOk} title={t('stats.success')}>
          {t('auth_files.row_ok', { count: file.successCount ?? 0 })}
        </span>
        <span
          className={`${styles.countFail} ${(file.failureCount ?? 0) > 0 ? styles.countFailLive : ''}`}
          title={t('stats.failure')}
        >
          {t('auth_files.row_failed', { count: file.failureCount ?? 0 })}
        </span>
      </div>

      <div className={styles.actions}>
        {!isRuntimeOnly && (
          <ToggleSwitch
            ariaLabel={t('auth_files.card_toggle', { name: displayNameFor(file.name) })}
            checked={!isDisabled}
            disabled={disableControls || isStatusUpdating || isManualRefreshing}
            onChange={(value) => onToggleStatus(file, value)}
          />
        )}
        {showModelsButton && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onShowModels(file)}
            disabled={disableControls}
            aria-label={`${t('auth_files.models_button')}: ${displayName}`}
          >
            <IconModelCluster size={13} aria-hidden="true" />
            {t('auth_files.models_button')}
          </Button>
        )}
        {showManualRefreshButton && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onManualRefresh(file)}
            disabled={disableControls || isDisabled || isStatusUpdating || isManualRefreshing}
            aria-label={`${t('auth_files.manual_refresh_button')}: ${displayName}`}
            title={t('auth_files.manual_refresh_button')}
          >
            {isManualRefreshing ? (
              <LoadingSpinner size={13} />
            ) : (
              <IconRefreshCw size={13} aria-hidden="true" />
            )}
            {t('common.refresh')}
          </Button>
        )}
        {!isRuntimeOnly && (
          <OverflowMenu
            appearance="quiet"
            label={t('auth_files.row_actions_label', { name: displayName })}
            disabled={disableControls}
            items={[
              {
                key: 'download',
                label: t('auth_files.download_button'),
                onSelect: () => onDownload(file.name),
              },
              {
                key: 'details',
                label: t('auth_files.prefix_proxy_button'),
                onSelect: () => onOpenDetails(file),
                disabled: isManualRefreshing,
              },
              {
                key: 'delete',
                label: t('auth_files.delete_button'),
                onSelect: () => onDelete(file.name),
                danger: true,
                disabled: isManualRefreshing,
                loading: deleting === file.name,
              },
            ]}
          />
        )}
      </div>
    </li>
  );
}

function LedgerGroup(props: AuthFilesLedgerProps & { group: AuthFilesLedgerGroup }) {
  const { group, resolvedTheme, disableControls, quotaFor, quotaLoading, onLoadGroupQuota } = props;
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const listId = useId();
  const label = getTypeLabel(t, group.provider);
  const problemCount = group.files.filter(
    (file) => file.disabled !== true && isProblemAuthFile(file)
  ).length;
  const quotaTargets = group.files.filter(
    (file) =>
      resolveQuotaProviderType(file) !== null &&
      file.disabled !== true &&
      !isRuntimeOnlyAuthFile(file) &&
      quotaFor(file)?.status !== 'loading'
  );

  return (
    <section className={styles.group} aria-label={label}>
      <div className={styles.groupHead}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed((value) => !value)}
        >
          <IconChevronDown
            size={14}
            aria-hidden="true"
            className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}
          />
          <ProviderIcon provider={group.provider} resolvedTheme={resolvedTheme} />
          <span className={styles.groupLabel}>{label}</span>
          <span className={styles.groupCount}>{group.files.length}</span>
          {problemCount > 0 && (
            <span className={styles.groupProblem}>
              {t('auth_files.meta_problem', { count: problemCount })}
            </span>
          )}
        </button>
        {quotaTargets.length > 0 && (
          <Button
            variant="secondary"
            size="xs"
            shape="pill"
            onClick={() => onLoadGroupQuota(quotaTargets)}
            disabled={disableControls || quotaLoading}
            loading={quotaLoading}
          >
            {t('auth_files.load_quota_button')}
          </Button>
        )}
      </div>
      {!collapsed && (
        <ul id={listId} className={styles.rows}>
          {group.files.map((file) => (
            <LedgerRow key={file.name} {...props} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AuthFilesLedger(props: AuthFilesLedgerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.ledger} role="region" aria-label={t('auth_files.title_section')}>
      {props.groups.map((group) => (
        <LedgerGroup key={group.provider} {...props} group={group} />
      ))}
    </div>
  );
}
