import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  PageHeader,
  type PageHeaderMetaSegment,
  type PageHeaderMetaTone,
} from '@/components/ui/PageHeader';
import { IconRefreshCw } from '@/components/ui/icons';
import type { HeaderMetaSegment } from '../uiState';

export type ConfigHeaderProps = {
  /** ▍mono meta 行的段落序列（uiState.buildHeaderMeta 的产物）。 */
  meta: HeaderMetaSegment[];
  reloadDisabled: boolean;
  reloading: boolean;
  onReload: () => void;
};

const TONE: Record<HeaderMetaSegment['tone'], PageHeaderMetaTone> = {
  muted: 'muted',
  warning: 'warning',
  error: 'attention',
  ok: 'ok',
};

/**
 * 配置面板头部：共享 PageHeader + 重载 ghost。
 * 保存动作不在头部常驻 —— 由 FloatingSaveBar 在 dirty 时承载。
 */
export function ConfigHeader({
  meta,
  reloadDisabled,
  reloading,
  onReload,
}: ConfigHeaderProps) {
  const { t } = useTranslation();
  const segments: PageHeaderMetaSegment[] = meta.map((segment) => ({
    key: segment.key,
    tone: TONE[segment.tone],
    text:
      segment.count !== undefined
        ? t(segment.labelKey, { count: segment.count })
        : t(segment.labelKey),
  }));

  return (
    <PageHeader
      title={t('config_management.title')}
      meta={segments}
      actions={
        <Button variant="ghost" shape="pill" size="sm" onClick={onReload} disabled={reloadDisabled}>
          <IconRefreshCw size={14} className={reloading ? 'spinning' : undefined} />
          {t('config_management.reload')}
        </Button>
      }
    />
  );
}
