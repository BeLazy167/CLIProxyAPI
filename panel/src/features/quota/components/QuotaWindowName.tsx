import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatQuotaWindowLabel, type QuotaWindowLabel } from '../quotaWindows';

/** Windows whose name alone does not say what they count. */
const WINDOW_TIPS: Record<string, string> = {
  'claude_quota.seven_day_fable': 'quota_management.tip_window_fable',
};

/** A quota window's name, with a tip when the name needs one. */
export function QuotaWindowName({ label }: { label: QuotaWindowLabel }) {
  const { t } = useTranslation();
  const text = formatQuotaWindowLabel(t, label);
  const tip = label.key ? WINDOW_TIPS[label.key] : undefined;
  return tip ? <Tooltip content={t(tip)}>{text}</Tooltip> : <>{text}</>;
}
