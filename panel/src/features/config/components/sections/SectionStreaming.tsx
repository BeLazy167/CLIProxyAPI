import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import {
  FieldAnchor,
  FieldGrid,
  FieldStack,
  FieldSuffix,
  YamlKey,
} from '../fields/FieldPrimitives';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.streaming;
const S = 'config_management.visual.sections.streaming';

/** 05 流式传输：keepalive 与 bootstrap 重试；nonstream-keepalive-interval 是顶层 YAML 键。 */
export function SectionStreaming({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();

  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );
  const isKeepaliveDisabled = !keepaliveError && Number(values.streaming.keepaliveSeconds) <= 0;
  const isNonstreamKeepaliveDisabled =
    !nonstreamKeepaliveError && Number(values.streaming.nonstreamKeepaliveInterval) <= 0;
  const disabledPill = <FieldSuffix pill>{t(`${S}.disabled`)}</FieldSuffix>;
  const seconds = <FieldSuffix>s</FieldSuffix>;

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.streaming}
      icon={<Icon size={16} />}
      title={t(`${S}.title`)}
      description={t(`${S}.description`)}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGrid>
          <FieldAnchor fieldId="streamingKeepaliveSeconds">
            <Input
              label={t(`${S}.keepalive_seconds`)}
              type="number"
              placeholder="0"
              value={values.streaming.keepaliveSeconds}
              onChange={(e) =>
                onChange({ streaming: { ...values.streaming, keepaliveSeconds: e.target.value } })
              }
              disabled={disabled}
              rightElement={isKeepaliveDisabled ? disabledPill : seconds}
              hint={
                <>
                  {t(`${S}.keepalive_hint`)}
                  <YamlKey path="requests.streaming.keepalive-seconds" />
                </>
              }
              error={keepaliveError}
            />
          </FieldAnchor>

          <FieldAnchor fieldId="streamingBootstrapRetries">
            <Input
              label={t(`${S}.bootstrap_retries`)}
              type="number"
              placeholder="1"
              value={values.streaming.bootstrapRetries}
              onChange={(e) =>
                onChange({ streaming: { ...values.streaming, bootstrapRetries: e.target.value } })
              }
              disabled={disabled}
              hint={
                <>
                  {t(`${S}.bootstrap_hint`)}
                  <YamlKey path="requests.streaming.bootstrap-retries" />
                </>
              }
              error={bootstrapRetriesError}
            />
          </FieldAnchor>
        </FieldGrid>

        <FieldGrid>
          <FieldAnchor fieldId="streamingNonstreamKeepalive">
            <Input
              label={t(`${S}.nonstream_keepalive`)}
              type="number"
              placeholder="0"
              value={values.streaming.nonstreamKeepaliveInterval}
              onChange={(e) =>
                onChange({
                  streaming: { ...values.streaming, nonstreamKeepaliveInterval: e.target.value },
                })
              }
              disabled={disabled}
              rightElement={isNonstreamKeepaliveDisabled ? disabledPill : seconds}
              hint={
                <>
                  {t(`${S}.nonstream_keepalive_hint`)}
                  <YamlKey path="requests.nonstream-keepalive-interval" />
                </>
              }
              error={nonstreamKeepaliveError}
            />
          </FieldAnchor>
        </FieldGrid>
      </FieldStack>
    </SectionCard>
  );
}
