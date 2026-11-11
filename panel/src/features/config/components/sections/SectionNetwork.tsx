import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { VisualConfigValues } from '@/types/visualConfig';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { ConfigCollapsible } from '../ConfigCollapsible';
import {
  FieldAnchor,
  FieldGrid,
  FieldGroup,
  FieldShell,
  FieldStack,
  FieldSuffix,
  OptionDescription,
  ToggleRow,
  YamlKey,
} from '../fields/FieldPrimitives';
import { ProxyUrlField } from '../fields/sharedFields';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.network;
const N = 'config_management.visual.sections.network';
const A = 'config_management.visual.additions';

const MORE_FIELD_IDS = ['authAutoRefreshWorkers', 'forceModelPrefix', 'passthroughHeaders', 'wsAuth'];

/** 02 网络：代理 / 重试 / 路由与会话亲和 / 冷却 / 图像与视频 / 更多（折叠）。 */
export function SectionNetwork({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;

  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );

  const affinityOff = !values.routingSessionAffinity;
  const affinityRequires = t('config_management.visual.field_state.requires', {
    field: t(`${N}.session_affinity`),
  });

  const strategyOptions = (
    ['round-robin', 'weighted-round-robin', 'fill-first', 'expiring-first'] as const
  ).map((value) => ({
    value,
    label: t(`${N}.strategy_${value.replace(/-/g, '_')}`),
    description: t(`${N}.strategy_${value.replace(/-/g, '_')}_desc`),
  }));
  const imageOptions = (['false', 'true', 'chat', 'passthrough'] as const).map((value) => ({
    value,
    label: t(`${N}.disable_image_generation_${value}`),
    description: t(`${N}.disable_image_generation_${value}_desc`),
  }));
  const selectedStrategy = strategyOptions.find((o) => o.value === values.routingStrategy);
  const selectedImage = imageOptions.find((o) => o.value === values.disableImageGeneration);

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.network}
      icon={<Icon size={16} />}
      title={t(`${N}.title`)}
      description={t(`${N}.description`)}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGroup title={t(`${N}.group_proxy`)}>
          <FieldGrid>
            <ProxyUrlField values={values} disabled={disabled} onChange={onChange} />
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title={t(`${N}.group_retries`)} description={t(`${N}.group_retries_desc`)}>
          <FieldGrid>
            <FieldAnchor fieldId="requestRetry">
              <Input
                label={t(`${N}.request_retry`)}
                type="number"
                placeholder="3"
                value={values.requestRetry}
                onChange={(e) => onChange({ requestRetry: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${N}.request_retry_hint`)}
                    <YamlKey path="routing.retry.request-retry" />
                  </>
                }
                error={requestRetryError}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="maxRetryCredentials">
              <Input
                label={t(`${N}.max_retry_credentials`)}
                type="number"
                placeholder="0"
                value={values.maxRetryCredentials}
                onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${N}.max_retry_credentials_hint`)}
                    <YamlKey path="routing.retry.max-retry-credentials" />
                  </>
                }
                error={maxRetryCredentialsError}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="maxRetryInterval">
              <Input
                label={t(`${N}.max_retry_interval`)}
                type="number"
                placeholder="30"
                value={values.maxRetryInterval}
                onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                disabled={disabled}
                rightElement={<FieldSuffix>s</FieldSuffix>}
                hint={
                  <>
                    {t(`${N}.max_retry_interval_hint`)}
                    <YamlKey path="routing.retry.max-retry-interval" />
                  </>
                }
                error={maxRetryIntervalError}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title={t(`${N}.group_routing`)} description={t(`${N}.group_routing_desc`)}>
          <FieldStack>
            <FieldGrid>
              <FieldAnchor fieldId="routingStrategy">
                <FieldShell
                  label={t(`${N}.routing_strategy`)}
                  labelId={routingStrategyLabelId}
                  hintId={routingStrategyHintId}
                  hint={
                    <>
                      {selectedStrategy ? (
                        <OptionDescription>{selectedStrategy.description}</OptionDescription>
                      ) : null}
                      {t(`${N}.routing_strategy_hint`)}
                      <YamlKey path="routing.strategy" />
                    </>
                  }
                >
                  <Select
                    value={values.routingStrategy}
                    options={strategyOptions.map(({ value, label }) => ({ value, label }))}
                    id={`${routingStrategyLabelId}-select`}
                    disabled={disabled}
                    ariaLabelledBy={routingStrategyLabelId}
                    ariaDescribedBy={routingStrategyHintId}
                    onChange={(nextValue) =>
                      onChange({
                        routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                      })
                    }
                  />
                </FieldShell>
              </FieldAnchor>
              <FieldAnchor fieldId="routingSessionAffinity">
                <ToggleRow
                  title={t(`${N}.session_affinity`)}
                  description={t(`${N}.session_affinity_desc`)}
                  checked={values.routingSessionAffinity}
                  disabled={disabled}
                  onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="routingSessionAffinityTTL">
                <Input
                  label={t(`${N}.session_affinity_ttl`)}
                  placeholder="1h"
                  value={values.routingSessionAffinityTTL}
                  onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                  disabled={disabled || affinityOff}
                  hint={
                    <>
                      {affinityOff ? `${affinityRequires} ` : null}
                      {t(`${N}.session_affinity_ttl_hint`)}
                      <YamlKey path="routing.session-affinity-ttl" />
                    </>
                  }
                />
              </FieldAnchor>
              <FieldAnchor fieldId="routingSessionAffinitySubagents">
                <ToggleRow
                  title={t(`${A}.routingSessionAffinitySubagents.label`)}
                  description={t(`${A}.routingSessionAffinitySubagents.hint`)}
                  checked={values.routingSessionAffinitySubagents}
                  disabled={disabled || affinityOff}
                  requiresNote={affinityOff ? affinityRequires : undefined}
                  onChange={(routingSessionAffinitySubagents) =>
                    onChange({ routingSessionAffinitySubagents })
                  }
                />
              </FieldAnchor>
            </FieldGrid>
          </FieldStack>
        </FieldGroup>

        <FieldGroup title={t(`${N}.group_cooldowns`)} description={t(`${N}.group_cooldowns_desc`)}>
          <FieldGrid>
            <FieldAnchor fieldId="disableCooling">
              <ToggleRow
                variant="danger"
                title={t(`${N}.disable_cooling`)}
                description={t(`${N}.disable_cooling_desc`)}
                consequence={t(`${N}.disable_cooling_consequence`)}
                checked={values.disableCooling}
                disabled={disabled}
                onChange={(disableCooling) => onChange({ disableCooling })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="saveCooldownStatus">
              <ToggleRow
                title={t(`${A}.saveCooldownStatus.label`)}
                description={t(`${A}.saveCooldownStatus.hint`)}
                checked={values.saveCooldownStatus}
                disabled={disabled}
                onChange={(saveCooldownStatus) => onChange({ saveCooldownStatus })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="transientErrorCooldownSeconds">
              <Input
                label={t(`${A}.transientErrorCooldownSeconds.label`)}
                type="number"
                placeholder="0"
                value={values.transientErrorCooldownSeconds}
                onChange={(e) => onChange({ transientErrorCooldownSeconds: e.target.value })}
                disabled={disabled || values.disableCooling}
                rightElement={<FieldSuffix>s</FieldSuffix>}
                hint={
                  <>
                    {t(`${A}.transientErrorCooldownSeconds.hint`)}
                    <YamlKey path="routing.cooldown.transient-error-cooldown-seconds" />
                  </>
                }
                error={getValidationMessage(t, validationErrors?.transientErrorCooldownSeconds)}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title={t(`${N}.group_media`)}>
          <FieldGrid>
            <FieldAnchor fieldId="disableImageGeneration">
              <FieldShell
                label={t(`${N}.disable_image_generation`)}
                labelId={disableImageGenerationLabelId}
                hintId={disableImageGenerationHintId}
                hint={
                  <>
                    {selectedImage ? (
                      <OptionDescription>{selectedImage.description}</OptionDescription>
                    ) : null}
                    {t(`${N}.disable_image_generation_hint`)}
                    <YamlKey path="multimedia.disable-image-generation" />
                  </>
                }
              >
                <Select
                  value={values.disableImageGeneration}
                  options={imageOptions.map(({ value, label }) => ({ value, label }))}
                  id={`${disableImageGenerationLabelId}-select`}
                  disabled={disabled}
                  ariaLabelledBy={disableImageGenerationLabelId}
                  ariaDescribedBy={disableImageGenerationHintId}
                  onChange={(nextValue) =>
                    onChange({
                      disableImageGeneration:
                        nextValue as VisualConfigValues['disableImageGeneration'],
                    })
                  }
                />
              </FieldShell>
            </FieldAnchor>
            <FieldAnchor fieldId="gptImage2BaseModel">
              <Input
                label={t(`${N}.gpt_image_2_base_model`)}
                placeholder="gpt-5.4-mini"
                value={values.gptImage2BaseModel}
                onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${N}.gpt_image_2_base_model_hint`)}
                    <YamlKey path="multimedia.gpt-image-2-base-model" />
                  </>
                }
              />
            </FieldAnchor>
            <FieldAnchor fieldId="videoResultAuthCacheTTL">
              <Input
                label={t(`${A}.videoResultAuthCacheTTL.label`)}
                type="text"
                placeholder="3h"
                value={values.videoResultAuthCacheTTL}
                onChange={(e) => onChange({ videoResultAuthCacheTTL: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${A}.videoResultAuthCacheTTL.hint`)}
                    <YamlKey path="multimedia.video-result-auth-cache-ttl" />
                  </>
                }
                error={getValidationMessage(t, validationErrors?.videoResultAuthCacheTTL)}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>

        <ConfigCollapsible
          label={t(`${N}.group_more`)}
          hint={t(`${N}.group_more_desc`)}
          fieldIds={MORE_FIELD_IDS}
        >
          <FieldGrid>
            <FieldAnchor fieldId="authAutoRefreshWorkers">
              <Input
                label={t(`${N}.auth_auto_refresh_workers`)}
                type="number"
                placeholder="16"
                value={values.authAutoRefreshWorkers}
                onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                disabled={disabled}
                hint={
                  <>
                    {t(`${N}.auth_auto_refresh_workers_hint`)}
                    <YamlKey path="oauth.auth-auto-refresh-workers" />
                  </>
                }
                error={authAutoRefreshWorkersError}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="forceModelPrefix">
              <ToggleRow
                title={t(`${N}.force_model_prefix`)}
                description={t(`${N}.force_model_prefix_desc`)}
                checked={values.forceModelPrefix}
                disabled={disabled}
                onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="passthroughHeaders">
              <ToggleRow
                title={t(`${N}.passthrough_headers`)}
                description={t(`${N}.passthrough_headers_desc`)}
                checked={values.passthroughHeaders}
                disabled={disabled}
                onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="wsAuth">
              <ToggleRow
                title={t(`${N}.ws_auth`)}
                description={t(`${N}.ws_auth_desc`)}
                checked={values.wsAuth}
                disabled={disabled}
                onChange={(wsAuth) => onChange({ wsAuth })}
              />
            </FieldAnchor>
          </FieldGrid>
        </ConfigCollapsible>
      </FieldStack>
    </SectionCard>
  );
}
