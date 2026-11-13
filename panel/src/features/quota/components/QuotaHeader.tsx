import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { IconRefreshCw } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCountUp } from '@/hooks/motion';
import { formatInstantShort } from '@/utils/quota';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  /** Newest quota reading on the page; null before any has loaded. */
  readAtMs: number | null;
  refreshing: boolean;
  disableControls: boolean;
  onRefreshAll: () => void;
};

/** "Fri 11/13, 00:38": when the newest reading on the page was taken. */
const formatReadAt = (ms: number) =>
  `${new Date(ms).toLocaleDateString(undefined, { weekday: 'short' })} ${formatInstantShort(ms)}`;

/**
 * 额度页头部：共享 PageHeader + 墨色「刷新全部」。
 * meta 语义：已加载数是「活数据」（绿），需关注数走失败色。
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    readAtMs,
    refreshing,
    disableControls,
    onRefreshAll,
  } = props;
  const { t } = useTranslation();
  // 批量结果陆续落地时，「已加载」是页面上唯一滚动的数字
  const displayLoadedCount = useCountUp(loadedCount);

  const meta: PageHeaderMetaSegment[] = [
    { key: 'total', text: t('quota_management.meta_credentials', { count: totalCount }) },
    {
      key: 'loaded',
      text: (
        <Tooltip
          content={t('quota_management.tip_loaded', { loaded: loadedCount, total: totalCount })}
        >
          {t('quota_management.meta_loaded', { count: displayLoadedCount })}
        </Tooltip>
      ),
      tone: loadedCount > 0 ? 'ok' : 'quiet',
    },
  ];
  if (readAtMs !== null) {
    meta.push({ key: 'read', text: t('quota_management.meta_read', { time: formatReadAt(readAtMs) }) });
  }
  if (attentionCount > 0) {
    meta.push({
      key: 'attention',
      text: t('quota_management.meta_attention', { count: attentionCount }),
      tone: 'attention',
    });
  }

  return (
    <PageHeader
      title={t('quota_management.title')}
      meta={meta}
      actions={
        <>
          <Button onClick={onRefreshAll} disabled={disableControls || refreshing}>
            <IconRefreshCw size={14} className={refreshing ? 'spinning' : undefined} />
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </>
      }
    />
  );
}
