import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import {
  IconAlertTriangle,
  IconCheck,
  IconCheckCircle2,
  IconCopy,
  IconExternalLink,
  IconLoader2,
} from '@/components/ui/icons';
import { PROVIDER_LOGOS } from '../brandLogos';
import {
  APIKEY_FUN_AFFILIATE_URL,
  APIKEY_FUN_DASHBOARD_URL,
  APIKEY_FUN_DISPLAY_NAME,
  type ApiKeyFunUsageSummary,
} from '../sponsor';
import { isSponsorPartialMutationError } from '../sponsorMutationRecovery';
import type { ProviderEntryFormInput, ProviderResource, SponsorProviderRaw } from '../types';
import type { UseProviderWorkbenchResult } from '../useProviderWorkbench';
import { SponsorProviderForm } from '../sheets/forms/SponsorProviderForm';
import {
  useSponsorUsageCheck,
  type SponsorUsageMessages,
} from '../sheets/forms/useSponsorUsageCheck';
import styles from './SponsorQuickStartPanel.module.scss';

interface SponsorQuickStartPanelProps {
  resource: ProviderResource | null;
  workbench: UseProviderWorkbenchResult;
  mutationDisabled?: boolean;
}

type StepStatus = 'todo' | 'running' | 'done' | 'failed';

interface VerifyTarget {
  baseUrl: string;
  apiKey: string;
}

/** 已保存配置里第一把可用的密钥与其 base URL；用于自动校验 */
const verifyTargetOf = (resource: ProviderResource | null): VerifyTarget | null => {
  if (!resource || resource.brand !== 'apikeyFun') return null;
  const raw = resource.raw as SponsorProviderRaw;
  const keyed = raw.codex[0]?.config ?? raw.claude[0]?.config;
  if (keyed?.apiKey) return { baseUrl: keyed.baseUrl ?? '', apiKey: keyed.apiKey };
  const openai = raw.openai[0]?.config;
  const openaiKey = openai?.apiKeyEntries?.find((entry) => entry.apiKey?.trim())?.apiKey;
  return openaiKey ? { baseUrl: openai?.baseUrl ?? '', apiKey: openaiKey } : null;
};

const formatUsageAmount = (value: ApiKeyFunUsageSummary['remaining'], locale: string): string => {
  if (value === null) return '--';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  }
  return value;
};

const isHealthyUsageSummary = (summary: ApiKeyFunUsageSummary): boolean => {
  const normalizedStatus = (summary.status ?? '').trim().toLowerCase();
  return summary.isValid && (!normalizedStatus || normalizedStatus === 'active');
};

const STATUS_CLASS: Record<StepStatus, string> = {
  todo: styles.markTodo,
  running: styles.markRunning,
  done: styles.markDone,
  failed: styles.markFailed,
};

function StepMark({ status, index }: { status: StepStatus; index: number }) {
  const { t } = useTranslation();
  return (
    <span
      className={`${styles.mark} ${STATUS_CLASS[status]}`}
      role="img"
      aria-label={t(`providersPage.sponsor.quickStart.status.${status}`)}
    >
      {status === 'done' ? (
        <IconCheck size={13} />
      ) : status === 'failed' ? (
        <IconAlertTriangle size={12} />
      ) : status === 'running' ? (
        <IconLoader2 size={12} className={styles.spin} />
      ) : (
        index
      )}
    </span>
  );
}

function Step({
  index,
  status,
  title,
  hint,
  children,
}: {
  index: number;
  status: StepStatus;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <li className={styles.step}>
      <StepMark status={status} index={index} />
      <div className={styles.stepBody}>
        <span className={styles.stepTitle}>{title}</span>
        {hint && <span className={styles.stepHint}>{hint}</span>}
        {children}
      </div>
    </li>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className={styles.copyField}>
      <code className={styles.copyValue}>{value}</code>
      <Button
        variant="secondary"
        size="xs"
        shape="pill"
        onClick={() => void copyToClipboard(value).then((ok) => setCopied(ok))}
        aria-label={`${t('common.copy')} ${label}`}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        {copied ? t('providersPage.sponsor.quickStart.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

export function SponsorQuickStartPanel({
  resource,
  workbench,
  mutationDisabled = false,
}: SponsorQuickStartPanelProps) {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const apiBase = useAuthStore((state) => state.apiBase);
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  // 自动校验目标：挂载时取已保存的密钥，保存成功后换成刚提交的那把
  const [verifyTarget, setVerifyTarget] = useState<VerifyTarget | null>(() =>
    verifyTargetOf(resource)
  );

  const formMutating = submitting || mutationDisabled || workbench.mutating;
  const mode = resource ? 'edit' : 'create';
  const submitDisabled = formMutating || (mode === 'edit' && !isDirty);
  const logo = PROVIDER_LOGOS.apikeyFun;
  const proxyBaseUrl = apiBase || window.location.origin;

  const usageMessages = useMemo<SponsorUsageMessages>(
    () => ({
      apiKeyRequired: t('providersPage.sponsor.usageApiKeyRequired'),
      emptyResponse: t('providersPage.sponsor.usageEmpty'),
      requestFailed: t('providersPage.connectivity.requestFailed'),
    }),
    [t]
  );
  const usageCheck = useSponsorUsageCheck(
    { baseUrl: verifyTarget?.baseUrl ?? '', apiKey: verifyTarget?.apiKey ?? '' },
    usageMessages
  );
  // run 的身份只随校验目标变化，所以保存后换目标即自动触发一次校验
  const runUsageCheck = usageCheck.run;
  useEffect(() => {
    if (verifyTarget) void runUsageCheck();
  }, [verifyTarget, runUsageCheck]);

  useUnsavedChangesGuard({
    shouldBlock: isDirty && !submitting,
    dialog: {
      title: t('providersPage.unsavedChanges.title'),
      message: t('providersPage.unsavedChanges.message'),
      confirmText: t('providersPage.unsavedChanges.discard'),
      cancelText: t('providersPage.unsavedChanges.keepEditing'),
      variant: 'danger',
    },
  });

  const handleSubmit = async (input: ProviderEntryFormInput) => {
    if (mutationDisabled) return;
    setSubmitting(true);
    try {
      if (resource) {
        await workbench.updateProvider(resource, input);
        showNotification(t('providersPage.toast.updated'), 'success');
      } else {
        await workbench.createProvider('apikeyFun', input);
        showNotification(t('providersPage.toast.created'), 'success');
      }
      const entry = input.sponsorKeyEntries?.[0];
      if (entry) {
        setVerifyTarget({
          baseUrl: entry.baseUrl,
          apiKey: entry.apiKey.trim() || entry.existingApiKey?.trim() || '',
        });
      }
      setSaveFailed(false);
      setIsDirty(false);
      setEditing(false);
      setFormVersion((current) => current + 1);
    } catch (err) {
      setSaveFailed(true);
      if (isSponsorPartialMutationError(err)) {
        showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t(resource ? 'notification.update_failed' : 'notification.add_failed')}: ${msg}`,
        'error'
      );
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 校验结果 ---------- */
  const usageSummary = usageCheck.status.summary;
  const usageHealthy = usageSummary ? isHealthyUsageSummary(usageSummary) : false;
  const verifyStatus: StepStatus =
    usageCheck.status.state === 'loading'
      ? 'running'
      : usageCheck.status.state === 'success'
        ? usageHealthy
          ? 'done'
          : 'failed'
        : usageCheck.status.state === 'error'
          ? 'failed'
          : 'todo';
  const verifyText =
    verifyStatus === 'running'
      ? t('providersPage.sponsor.usageChecking')
      : verifyStatus === 'done' && usageSummary
        ? t('providersPage.sponsor.quickStart.verifyValid', {
            amount: formatUsageAmount(usageSummary.remaining, i18n.language),
            unit: usageSummary.unit,
          })
        : verifyStatus === 'failed'
          ? t('providersPage.sponsor.quickStart.verifyFailed', {
              reason:
                usageCheck.status.message ||
                usageSummary?.status ||
                t('providersPage.sponsor.usageInvalid'),
            })
          : t('providersPage.sponsor.quickStart.verifyPending');

  const verifyBadge = (
    <span className={`${styles.badge} ${STATUS_CLASS[verifyStatus]}`} role="status">
      {verifyStatus === 'done' ? (
        <IconCheckCircle2 size={14} />
      ) : verifyStatus === 'failed' ? (
        <IconAlertTriangle size={14} />
      ) : verifyStatus === 'running' ? (
        <IconLoader2 size={14} className={styles.spin} />
      ) : null}
      {verifyText}
    </span>
  );
  const recheckButton = verifyTarget ? (
    <Button
      variant="ghost"
      size="xs"
      shape="pill"
      onClick={() => void usageCheck.run()}
      disabled={usageCheck.isLoading}
    >
      {t('providersPage.sponsor.quickStart.recheck')}
    </Button>
  ) : null;

  const vendorLine = (
    <div className={styles.vendor}>
      <img src={logo.src} alt="" aria-hidden="true" className={styles.logo} />
      <span className={styles.vendorName}>{APIKEY_FUN_DISPLAY_NAME}</span>
      {resource && (
        <a
          className={styles.topLink}
          href={APIKEY_FUN_DASHBOARD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternalLink size={13} />
          <span>{t('providersPage.sponsor.dashboardLink')}</span>
          <span className={styles.srOnly}>{t('providersPage.sponsor.quickStart.external')}</span>
        </a>
      )}
    </div>
  );

  /* ---------- 已配置：紧凑状态卡 ---------- */
  if (resource && !editing) {
    return (
      <section className={styles.panel}>
        <div className={styles.cardRow}>
          {vendorLine}
          <div className={styles.cardActions}>
            {recheckButton}
            <Button
              variant="secondary"
              size="sm"
              shape="pill"
              onClick={() => setEditing(true)}
              disabled={mutationDisabled}
            >
              {t('common.edit')}
            </Button>
          </div>
        </div>
        <div className={styles.cardStatus}>{verifyBadge}</div>
        <div className={styles.cardField}>
          <span className={styles.stepHint}>
            {t('providersPage.sponsor.quickStart.proxyBaseUrl')}
          </span>
          <CopyField
            value={proxyBaseUrl}
            label={t('providersPage.sponsor.quickStart.proxyBaseUrl')}
          />
        </div>
      </section>
    );
  }

  /* ---------- 向导：四步清单 ---------- */
  const step1: StepStatus = resource || isDirty ? 'done' : 'todo';
  const step2: StepStatus = saveFailed ? 'failed' : resource && !isDirty ? 'done' : 'todo';
  const step4: StepStatus = resource ? 'done' : 'todo';

  return (
    <section className={styles.panel}>
      {vendorLine}
      <p className={styles.intro}>{t('providersPage.sponsor.quickStart.description')}</p>

      <ol className={styles.steps}>
        <Step
          index={1}
          status={step1}
          title={t('providersPage.sponsor.quickStart.getKey')}
          hint={t('providersPage.sponsor.quickStart.getKeyHint')}
        >
          <a
            className={styles.externalLink}
            href={APIKEY_FUN_AFFILIATE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <IconExternalLink size={14} />
            <span>{t('providersPage.sponsor.registerLink')}</span>
            <small>{t('providersPage.sponsor.quickStart.external')}</small>
          </a>
        </Step>

        <Step
          index={2}
          status={step2}
          title={t('providersPage.sponsor.quickStart.addKey')}
          hint={t('providersPage.sponsor.quickStart.addKeyHint')}
        >
          <SponsorProviderForm
            key={`${mode}:${resource?.id ?? 'new'}:${formVersion}`}
            resource={resource}
            mode={mode}
            mutating={formMutating}
            formId={formId}
            variant="quickStart"
            onSubmit={handleSubmit}
            onDirtyChange={setIsDirty}
          />
          <div className={styles.footer}>
            {resource ? (
              <Button
                variant="ghost"
                shape="pill"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setIsDirty(false);
                  setFormVersion((current) => current + 1);
                }}
                disabled={submitting}
              >
                {t('providersPage.actions.cancel')}
              </Button>
            ) : null}
            <Button
              type="submit"
              form={formId}
              shape="pill"
              disabled={submitDisabled}
              loading={submitting}
            >
              {t('providersPage.sponsor.quickStart.saveKey')}
            </Button>
          </div>
        </Step>

        <Step
          index={3}
          status={verifyStatus}
          title={t('providersPage.sponsor.quickStart.verify')}
          hint={t('providersPage.sponsor.quickStart.verifyHint')}
        >
          <div className={styles.verifyRow}>
            {verifyBadge}
            {recheckButton}
          </div>
        </Step>

        <Step
          index={4}
          status={step4}
          title={t('providersPage.sponsor.quickStart.connect')}
          hint={t('providersPage.sponsor.quickStart.connectHint')}
        >
          <CopyField
            value={proxyBaseUrl}
            label={t('providersPage.sponsor.quickStart.proxyBaseUrl')}
          />
        </Step>
      </ol>
    </section>
  );
}
