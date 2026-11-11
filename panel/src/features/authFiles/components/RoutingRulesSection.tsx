import type { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import styles from './RoutingRulesSection.module.scss';

export type RoutingRulesSectionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Collapsible home for the two OAuth routing config panels (excluded models, model aliases). */
export function RoutingRulesSection({
  open,
  onOpenChange,
  children,
}: PropsWithChildren<RoutingRulesSectionProps>) {
  const { t } = useTranslation();
  return (
    <Collapsible
      label={t('auth_files.routing_rules_title')}
      hint={t('auth_files.routing_rules_hint')}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      flush
    >
      <div className={styles.configGrid}>{children}</div>
    </Collapsible>
  );
}
