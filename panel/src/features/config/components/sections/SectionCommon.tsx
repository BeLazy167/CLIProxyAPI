import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconExternalLink } from '@/components/ui/icons';
import { CONFIG_TAB_ICONS, type ConfigTabId } from '../../constants';
import type { VisualSectionId } from '../../searchIndex';
import type { ConfigSectionProps } from '../../types';
import { getValidationMessage } from '../blocks/shared';
import { SectionCard } from '../SectionCard';
import { FieldGrid, FieldStack } from '../fields/FieldPrimitives';
import {
  ApiKeysField,
  DebugToggle,
  HostField,
  LoggingToFileToggle,
  PortField,
  ProxyUrlField,
  QuotaSwitchPreviewModelToggle,
  QuotaSwitchProjectToggle,
} from '../fields/sharedFields';
import styles from './SectionCommon.module.scss';

const Icon = CONFIG_TAB_ICONS.common;
const S = 'config_management.visual.sections.common';

type OverviewCardProps = {
  title: string;
  sectionId: VisualSectionId;
  /** 需要注意的原因（非空时卡片转琥珀并显示该行）。 */
  attention?: string;
  onOpenSection?: (id: ConfigTabId) => void;
  children: ReactNode;
};

function OverviewCard({ title, sectionId, attention, onOpenSection, children }: OverviewCardProps) {
  const { t } = useTranslation();
  const sectionTitle = t(`config_management.visual.sections.${sectionId}.title`);
  return (
    <section className={`${styles.card} ${attention ? styles.cardAttention : ''}`}>
      <header className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <button
          type="button"
          className={styles.cardLink}
          onClick={() => onOpenSection?.(sectionId)}
          aria-label={t(`${S}.open_section`, { section: sectionTitle })}
        >
          {sectionTitle}
          <IconExternalLink size={12} aria-hidden="true" />
        </button>
      </header>
      {attention ? (
        <p className={styles.cardAttentionLine}>
          <IconAlertTriangle size={12} aria-hidden="true" />
          {attention}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/**
 * 「总览」tab：8 个高频字段以摘要卡呈现，可就地编辑；每张卡链到所属分区。
 * 渲染源与正典分区共享（sharedFields），数据同为 useVisualConfig 一份状态。
 */
export function SectionCommon({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
  onOpenSection,
}: ConfigSectionProps & { onOpenSection?: (id: ConfigTabId) => void }) {
  const { t } = useTranslation();
  const portError = getValidationMessage(t, validationErrors?.port);
  const apiKeyCount = values.apiKeysText.split('\n').filter((line) => line.trim()).length;

  return (
    <SectionCard
      icon={<Icon size={16} />}
      title={t(`${S}.title`)}
      description={t(`${S}.description`)}
      animateIn={animateIn}
    >
      <div className={styles.grid}>
        <OverviewCard
          title={t(`${S}.card_listener`)}
          sectionId="connectivity"
          attention={portError}
          onOpenSection={onOpenSection}
        >
          <FieldGrid>
            <HostField values={values} disabled={disabled} onChange={onChange} />
            <PortField values={values} disabled={disabled} onChange={onChange} error={portError} />
          </FieldGrid>
        </OverviewCard>

        <OverviewCard
          title={t(`${S}.card_api_keys`)}
          sectionId="connectivity"
          attention={apiKeyCount === 0 ? t(`${S}.attention_no_api_keys`) : undefined}
          onOpenSection={onOpenSection}
        >
          <ApiKeysField values={values} disabled={disabled} onChange={onChange} />
        </OverviewCard>

        <OverviewCard
          title={t(`${S}.card_proxy`)}
          sectionId="network"
          onOpenSection={onOpenSection}
        >
          <FieldGrid>
            <ProxyUrlField values={values} disabled={disabled} onChange={onChange} />
          </FieldGrid>
        </OverviewCard>

        <OverviewCard
          title={t(`${S}.card_logging`)}
          sectionId="logging"
          onOpenSection={onOpenSection}
        >
          <FieldStack>
            <DebugToggle values={values} disabled={disabled} onChange={onChange} />
            <LoggingToFileToggle values={values} disabled={disabled} onChange={onChange} />
          </FieldStack>
        </OverviewCard>

        <OverviewCard title={t(`${S}.card_quota`)} sectionId="quota" onOpenSection={onOpenSection}>
          <FieldStack>
            <QuotaSwitchProjectToggle values={values} disabled={disabled} onChange={onChange} />
            <QuotaSwitchPreviewModelToggle values={values} disabled={disabled} onChange={onChange} />
          </FieldStack>
        </OverviewCard>
      </div>
    </SectionCard>
  );
}
