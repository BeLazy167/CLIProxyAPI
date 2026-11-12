import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader, type PageHeaderMetaSegment } from '@/components/ui/PageHeader';
import { IconRefreshCw, IconUpload } from '@/components/ui/icons';
import { useRevealGroup } from '@/hooks/motion';

export type VaultHeaderProps = {
  totalCount: number;
  activeCount: number;
  problemCount: number;
  loading: boolean;
  refreshing: boolean;
  uploading: boolean;
  disableControls: boolean;
  onUpload: () => void;
  onRefresh: () => void;
  refreshingCredentials?: boolean;
  credentialRefreshDisabled?: boolean;
  onRefreshCredentials?: () => void;
};

/**
 * 凭证库头部：共享 PageHeader + ghost 刷新/重载 + 墨色「上传」。
 */
export function VaultHeader(props: VaultHeaderProps) {
  const {
    totalCount,
    activeCount,
    problemCount,
    loading,
    refreshing,
    uploading,
    disableControls,
    onUpload,
    onRefresh,
    refreshingCredentials = false,
    credentialRefreshDisabled = false,
    onRefreshCredentials,
  } = props;
  const { t } = useTranslation();
  const revealRef = useRevealGroup<HTMLElement>();

  const meta: PageHeaderMetaSegment[] = [
    { key: 'total', text: t('auth_files.meta_total', { count: totalCount }) },
    {
      key: 'active',
      text: t('auth_files.meta_active', { count: activeCount }),
      tone: activeCount > 0 ? 'ok' : 'quiet',
    },
  ];
  if (problemCount > 0) {
    meta.push({
      key: 'problem',
      text: t('auth_files.meta_problem', { count: problemCount }),
      tone: 'attention',
    });
  }

  return (
    <PageHeader
      revealRef={revealRef}
      title={t('auth_files.title')}
      meta={meta}
      actions={
        <>
          {onRefreshCredentials && (
            <Button
              variant="ghost"
              shape="pill"
              size="sm"
              onClick={onRefreshCredentials}
              disabled={
                disableControls || loading || refreshingCredentials || credentialRefreshDisabled
              }
            >
              {refreshingCredentials ? <LoadingSpinner size={14} /> : <IconRefreshCw size={14} />}
              {t('auth_files.refresh_all_button')}
            </Button>
          )}
          <Button
            variant="ghost"
            shape="pill"
            size="sm"
            onClick={onRefresh}
            disabled={loading || refreshing}
          >
            <IconRefreshCw size={14} className={refreshing ? 'spinning' : undefined} />
            {t('auth_files.reload_button')}
          </Button>
          <Button shape="pill" onClick={onUpload} disabled={disableControls || uploading}>
            {uploading ? <LoadingSpinner size={14} /> : <IconUpload size={15} />}
            {t('auth_files.upload_button')}
          </Button>
        </>
      }
    />
  );
}
