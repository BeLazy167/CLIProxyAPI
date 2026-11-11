import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconExternalLink } from '@/components/ui/icons';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { FieldAnchor, FieldGrid, FieldHint, FieldStack, ToggleRow } from '../fields/FieldPrimitives';
import { QuotaSwitchPreviewModelToggle, QuotaSwitchProjectToggle } from '../fields/sharedFields';
import styles from './SectionQuota.module.scss';

const Icon = CONFIG_TAB_ICONS.quota;
const S = 'config_management.visual.sections.quota';

/** 04 配额回退：配额耗尽时的回退策略（两个开关默认 true）；实时额度看配额页。 */
export function SectionQuota({ values, disabled, animateIn, onChange }: ConfigSectionProps) {
  const { t } = useTranslation();

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.quota}
      icon={<Icon size={16} />}
      title={t(`${S}.title`)}
      description={t(`${S}.description`)}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldHint>
          {t(`${S}.intro`)}{' '}
          <Link to="/quota" className={styles.quotaLink}>
            {t(`${S}.open_quota_page`)}
            <IconExternalLink size={12} aria-hidden="true" />
          </Link>
        </FieldHint>
        <FieldGrid>
          <QuotaSwitchProjectToggle values={values} disabled={disabled} onChange={onChange} />
          <QuotaSwitchPreviewModelToggle values={values} disabled={disabled} onChange={onChange} />
          <FieldAnchor fieldId="quotaAntigravityCredits">
            <ToggleRow
              title={t(`${S}.antigravity_credits`)}
              description={t(`${S}.antigravity_credits_desc`)}
              checked={values.quotaAntigravityCredits}
              disabled={disabled}
              onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
            />
          </FieldAnchor>
        </FieldGrid>
      </FieldStack>
    </SectionCard>
  );
}
