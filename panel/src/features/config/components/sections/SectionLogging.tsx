import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import {
  FieldAnchor,
  FieldGrid,
  FieldGroup,
  FieldStack,
  FieldSuffix,
  ToggleRow,
  YamlKey,
} from '../fields/FieldPrimitives';
import { DebugToggle, LoggingToFileToggle } from '../fields/sharedFields';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.logging;
const S = 'config_management.visual.sections';

/** 03 日志与诊断：调试、商业模式（重启生效）、日志输出与使用统计。 */
export function SectionLogging({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const errorLogsMaxFilesError = getValidationMessage(t, validationErrors?.errorLogsMaxFiles);
  const redisUsageQueueRetentionError = getValidationMessage(
    t,
    validationErrors?.redisUsageQueueRetentionSeconds
  );
  const fileLoggingOff = !values.loggingToFile;
  const requiresFileLogging = t('config_management.visual.field_state.requires', {
    field: t(`${S}.system.logging_to_file`),
  });

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.logging}
      icon={<Icon size={16} />}
      title={t(`${S}.logging.title`)}
      description={t(`${S}.logging.description`)}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGroup title={t(`${S}.logging.group_output`)}>
          <FieldStack>
            <FieldGrid>
              <DebugToggle values={values} disabled={disabled} onChange={onChange} />
              <LoggingToFileToggle values={values} disabled={disabled} onChange={onChange} />
            </FieldGrid>
            <FieldGrid>
              <FieldAnchor fieldId="logsMaxTotalSizeMb">
                <Input
                  label={t(`${S}.system.logs_max_size`)}
                  type="number"
                  placeholder="0"
                  value={values.logsMaxTotalSizeMb}
                  onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                  disabled={disabled || fileLoggingOff}
                  rightElement={<FieldSuffix>MB</FieldSuffix>}
                  hint={
                    <>
                      {fileLoggingOff ? `${requiresFileLogging} ` : null}
                      {t(`${S}.system.logs_max_size_hint`)}
                      <YamlKey path="observability.logs.logs-max-total-size-mb" />
                    </>
                  }
                  error={logsMaxSizeError}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="errorLogsMaxFiles">
                <Input
                  label={t(`${S}.system.error_logs_max_files`)}
                  type="number"
                  placeholder="10"
                  value={values.errorLogsMaxFiles}
                  onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                  disabled={disabled}
                  hint={
                    <>
                      {t(`${S}.system.error_logs_max_files_hint`)}
                      <YamlKey path="observability.logs.error-logs-max-files" />
                    </>
                  }
                  error={errorLogsMaxFilesError}
                />
              </FieldAnchor>
            </FieldGrid>
          </FieldStack>
        </FieldGroup>

        <FieldGroup title={t(`${S}.logging.group_usage`)}>
          <FieldGrid>
            <FieldAnchor fieldId="usageStatisticsEnabled">
              <ToggleRow
                title={t(`${S}.system.usage_statistics_enabled`)}
                description={t(`${S}.system.usage_statistics_enabled_desc`)}
                checked={values.usageStatisticsEnabled}
                disabled={disabled}
                onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="redisUsageQueueRetentionSeconds">
              <Input
                label={t(`${S}.system.redis_usage_retention`)}
                type="number"
                min={1}
                max={3600}
                placeholder="60"
                value={values.redisUsageQueueRetentionSeconds}
                onChange={(e) => onChange({ redisUsageQueueRetentionSeconds: e.target.value })}
                disabled={disabled}
                rightElement={<FieldSuffix>s</FieldSuffix>}
                hint={
                  <>
                    {t(`${S}.system.redis_usage_retention_hint`)}
                    <YamlKey path="observability.usage.redis-usage-queue-retention-seconds" />
                  </>
                }
                error={redisUsageQueueRetentionError}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title={t(`${S}.logging.group_runtime`)}>
          <FieldGrid>
            <FieldAnchor fieldId="commercialMode">
              <ToggleRow
                title={t(`${S}.system.commercial_mode`)}
                description={t(`${S}.system.commercial_mode_desc`)}
                checked={values.commercialMode}
                disabled={disabled}
                onChange={(commercialMode) => onChange({ commercialMode })}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
      </FieldStack>
    </SectionCard>
  );
}
