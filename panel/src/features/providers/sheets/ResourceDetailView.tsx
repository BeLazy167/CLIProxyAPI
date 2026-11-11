import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconCheck, IconCopy, IconEye, IconEyeOff, IconX } from '@/components/ui/icons';
import { getProviderTotalStats, type ProviderRecentUsageMap } from '@/components/providers/utils';
import { useNotificationStore } from '@/stores';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { readRuntimePolicy } from '../runtimePolicy';
import {
  getSponsorProviderDefinition,
  isMultiProtocolSponsorBrand,
  sponsorProtocolI18nKey,
  sponsorProtocolUrl,
} from '../sponsorDefinitions';
import type { ProviderResource, SponsorProviderRaw } from '../types';
import styles from './forms/sharedForm.module.scss';
import detailStyles from './ResourceDetailView.module.scss';

interface ResourceDetailViewProps {
  resource: ProviderResource;
  usageByProvider?: ProviderRecentUsageMap;
}

const sponsorProtocolEntryKey = (protocol: string): string => {
  if (protocol === 'claude') return 'anthropicEntries';
  if (protocol === 'codex') return 'codexEntries';
  return `${protocol}Entries`;
};

/** 脱敏密钥 + 显示/复制;真实值只在用户主动点击后出现。 */
function SecretValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [revealed, setRevealed] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    showNotification(
      ok ? t('providersPage.detail.copied') : t('providersPage.detail.copyFailed'),
      ok ? 'success' : 'error'
    );
  };
  return (
    <span className={detailStyles.secret}>
      <code className={detailStyles.secretText}>{revealed ? value : maskApiKey(value)}</code>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => setRevealed((v) => !v)}
        aria-label={
          revealed ? t('providersPage.form.hideApiKey') : t('providersPage.form.showApiKey')
        }
        title={revealed ? t('providersPage.form.hideApiKey') : t('providersPage.form.showApiKey')}
      >
        {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => void handleCopy()}
        aria-label={t('common.copy')}
        title={t('common.copy')}
      >
        <IconCopy size={14} />
      </Button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={styles.dt}>{label}</dt>
      <dd className={styles.dd}>{children}</dd>
    </div>
  );
}

export function ResourceDetailView({ resource, usageByProvider }: ResourceDetailViewProps) {
  const { t } = useTranslation();
  const none = t('providersPage.status.none');
  const notSet = t('providersPage.status.notSet');

  if (isMultiProtocolSponsorBrand(resource.brand)) {
    const definition = getSponsorProviderDefinition(resource.brand);
    const raw = resource.raw as SponsorProviderRaw;
    const openaiKeyCount = raw.openai.reduce(
      (count, item) => count + (item.config.apiKeyEntries?.length ?? 0),
      0
    );
    const firstKey =
      raw.openai
        .flatMap((item) => item.config.apiKeyEntries ?? [])
        .find((entry) => entry.apiKey?.trim())?.apiKey ??
      raw.codex.find((item) => item.config.apiKey?.trim())?.config.apiKey ??
      raw.claude.find((item) => item.config.apiKey?.trim())?.config.apiKey ??
      raw.gemini.find((item) => item.config.apiKey?.trim())?.config.apiKey;
    const baseUrl = definition.resolveBaseUrl(
      raw.openai[0]?.config.baseUrl ??
        raw.codex[0]?.config.baseUrl ??
        raw.claude[0]?.config.baseUrl ??
        raw.gemini[0]?.config.baseUrl
    );
    const protocolUrls = definition.getProtocolUrls(baseUrl);
    const protocolCounts: Record<string, number> = {
      openai: openaiKeyCount,
      codex: raw.codex.length,
      claude: raw.claude.length,
      gemini: raw.gemini.length,
    };

    return (
      <div>
        <div className={styles.detailHeader}>
          <p className={styles.sectionDesc}>
            {t('providersPage.sponsor.detailHint', { provider: definition.displayName })}
          </p>
        </div>

        <div className={styles.sponsorProtocolGrid}>
          {definition.protocols.map((protocol) => (
            <div key={protocol} className={styles.sponsorProtocolCard}>
              <span className={styles.sponsorProtocolName}>
                {t(`providersPage.sponsor.protocols.${sponsorProtocolI18nKey(protocol)}`)}
              </span>
              <span className={styles.sponsorProtocolUrl}>
                {sponsorProtocolUrl(protocolUrls, protocol)}
              </span>
            </div>
          ))}
        </div>

        <dl className={styles.dl} style={{ marginTop: 16 }}>
          <Field label={t('providersPage.form.apiKey')}>
            {firstKey ? <SecretValue value={firstKey} /> : resource.identifier}
          </Field>
          <Field label={t('providersPage.detail.fields.prefix')}>{resource.prefix ?? none}</Field>
          {definition.protocols.map((protocol) => (
            <Field
              key={protocol}
              label={t(`providersPage.sponsor.${sponsorProtocolEntryKey(protocol)}`)}
            >
              {protocolCounts[protocol]}
            </Field>
          ))}
        </dl>
      </div>
    );
  }

  const isOpenAI = resource.brand === 'openaiCompatibility';
  const openaiConfig = isOpenAI ? (resource.raw as OpenAIProviderConfig) : null;
  const keyConfig = !isOpenAI ? (resource.raw as ProviderKeyConfig) : null;
  const apiKeyEntries = openaiConfig?.apiKeyEntries ?? [];
  const models = (openaiConfig ?? keyConfig)?.models ?? [];
  const headers = Object.entries((openaiConfig ?? keyConfig)?.headers ?? {});
  const excluded = (keyConfig?.excludedModels ?? []).filter((m) => m !== '*');
  const policy = readRuntimePolicy(openaiConfig ?? keyConfig ?? undefined);
  const coolingLabel =
    policy.cooling === 'inherit'
      ? t('providersPage.runtimePolicy.inherit')
      : policy.cooling === 'enabled'
        ? t('providersPage.runtimePolicy.coolingEnabled')
        : t('providersPage.runtimePolicy.coolingDisabled');
  const retryLabel = policy.retry.trim() ? policy.retry : t('providersPage.runtimePolicy.inherit');
  const baseUrlLabel =
    resource.brand === 'claude' && !resource.baseUrl
      ? `https://api.anthropic.com ${t('providersPage.status.defaultSuffix')}`
      : (resource.baseUrl ?? notSet);

  return (
    <div className={detailStyles.root}>
      <section>
        <h3 className={detailStyles.heading}>{t('providersPage.form.sections.connection')}</h3>
        <dl className={styles.dl}>
          {resource.name ? (
            <Field label={t('providersPage.form.name')}>{resource.name}</Field>
          ) : null}
          {keyConfig?.apiKey ? (
            <Field label={t('providersPage.form.apiKey')}>
              <SecretValue value={keyConfig.apiKey} />
            </Field>
          ) : null}
          <Field label={t('providersPage.detail.fields.baseUrl')}>
            <span className={detailStyles.mono}>{baseUrlLabel}</span>
          </Field>
          <Field label={t('providersPage.detail.fields.proxyUrl')}>
            <span className={detailStyles.mono}>{resource.proxyUrl ?? notSet}</span>
          </Field>
          <Field label={t('providersPage.detail.fields.authIndex')}>
            {resource.authIndex ?? notSet}
          </Field>
          <Field label={t('providersPage.status.disabled')}>
            {resource.disabled ? t('common.yes') : t('common.no')}
          </Field>
        </dl>
      </section>

      <section>
        <h3 className={detailStyles.heading}>{t('providersPage.form.sections.routing')}</h3>
        <dl className={styles.dl}>
          <Field label={t('providersPage.form.priority')}>{resource.priority}</Field>
          {resource.weight !== null ? (
            <Field label={t('providersPage.form.weight')}>{resource.weight}</Field>
          ) : null}
          <Field label={t('providersPage.detail.fields.prefix')}>{resource.prefix ?? none}</Field>
          <Field label={t('providersPage.runtimePolicy.cooling')}>{coolingLabel}</Field>
          <Field label={t('providersPage.runtimePolicy.retry')}>{retryLabel}</Field>
          {policy.errorsMode === 'override' ? (
            <Field label={t('providersPage.runtimePolicy.errorsMode')}>
              {t('providersPage.detail.rulesCount', { count: policy.errorRules.length })}
            </Field>
          ) : null}
        </dl>
      </section>

      {openaiConfig && apiKeyEntries.length > 0 ? (
        <section className={styles.apiKeyEntriesSection}>
          <h3 className={detailStyles.heading}>
            {t('providersPage.form.apiKeyEntriesSection')} · {apiKeyEntries.length}
          </h3>
          <div className={styles.apiKeyEntryList}>
            {apiKeyEntries.map((entry, entryIndex) => {
              const entryStats = usageByProvider
                ? getProviderTotalStats(
                    usageByProvider,
                    openaiConfig.name,
                    entry.apiKey,
                    openaiConfig.baseUrl
                  )
                : { success: 0, failure: 0 };
              return (
                <div key={`${entry.apiKey}-${entryIndex}`} className={styles.apiKeyEntryCard}>
                  <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                  <span className={styles.apiKeyEntryKey}>
                    <SecretValue value={entry.apiKey} />
                  </span>
                  {entry.proxyUrl ? (
                    <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                  ) : null}
                  <div className={styles.apiKeyEntryStats}>
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                      <IconCheck size={12} /> {entryStats.success}
                    </span>
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                      <IconX size={12} /> {entryStats.failure}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className={detailStyles.heading}>
          {t('providersPage.form.sections.models')} · {models.length}
        </h3>
        {models.length === 0 ? (
          <p className={detailStyles.empty}>{t('providersPage.detail.noModels')}</p>
        ) : (
          <ul className={detailStyles.modelList}>
            {models.map((model, index) => (
              <li key={`${model.name}-${index}`} className={detailStyles.modelRow}>
                <span className={detailStyles.mono}>{model.name}</span>
                {model.alias ? (
                  <span className={detailStyles.alias}>
                    → <span className={detailStyles.mono}>{model.alias}</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {excluded.length > 0 ? (
          <div className={detailStyles.chipRow}>
            <span className={detailStyles.chipLabel}>
              {t('providersPage.detail.fields.excludedModels')}
            </span>
            {excluded.map((name) => (
              <span key={name} className={detailStyles.chip}>
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <Collapsible
        label={t('providersPage.form.sections.advanced')}
        hint={t('providersPage.form.configuredCount', { count: headers.length })}
      >
        <dl className={styles.dl}>
          {headers.length === 0 ? (
            <Field label={t('providersPage.detail.fields.headers')}>{none}</Field>
          ) : (
            headers.map(([key, value]) => (
              <Field key={key} label={key}>
                <SecretValue value={value} />
              </Field>
            ))
          )}
          {keyConfig && resource.brand === 'claude' ? (
            <>
              <Field label={t('providersPage.form.cloakMode')}>
                {keyConfig.cloak?.mode?.trim() || t('providersPage.form.cloakModeDefault')}
              </Field>
              <Field label={t('providersPage.form.fingerprintProfile')}>
                {keyConfig.fingerprintProfile === 'claude-code-cli'
                  ? t('providersPage.form.fingerprintProfileClaudeCodeCli')
                  : t('providersPage.form.fingerprintProfileDefault')}
              </Field>
            </>
          ) : null}
          {resource.flags.websockets !== undefined ? (
            <Field label={t('providersPage.form.websockets')}>
              {resource.flags.websockets ? t('common.yes') : t('common.no')}
            </Field>
          ) : null}
        </dl>
      </Collapsible>
    </div>
  );
}
