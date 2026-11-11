import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { IconRefreshCw } from '@/components/ui/icons';
import { useCountUp } from '@/hooks/motion';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  refreshing: boolean;
  disableControls: boolean;
  showEmails: boolean;
  onToggleEmails: () => void;
  onRefreshAll: () => void;
};

/**
 * 额度页头部：共享 PageHeader + 「显示邮箱」次按钮 + 墨色「刷新全部」。
 * meta 语义：已加载数是「活数据」（绿），需关注数走失败色。
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    refreshing,
    disableControls,
    showEmails,
    onToggleEmails,
    onRefreshAll,
  } = props;
  const { t } = useTranslation();
  // 批量结果陆续落地时，「已加载」是页面上唯一滚动的数字
  const displayLoadedCount = useCountUp(loadedCount);

  const meta: PageHeaderMetaSegment[] = [
    { key: 'total', text: t('quota_management.meta_credentials', { count: totalCount }) },
    {
      key: 'loaded',
      text: t('quota_management.meta_loaded', { count: displayLoadedCount }),
      tone: loadedCount > 0 ? 'ok' : 'quiet',
    },
  ];
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
          <Button
            variant="secondary"
            shape="pill"
            size="sm"
            onClick={onToggleEmails}
            aria-pressed={showEmails}
          >
            {showEmails ? t('quota_management.hide_emails') : t('quota_management.show_emails')}
          </Button>
          <Button shape="pill" onClick={onRefreshAll} disabled={disableControls || refreshing}>
            <IconRefreshCw size={14} className={refreshing ? 'spinning' : undefined} />
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </>
      }
    />
  );
}
