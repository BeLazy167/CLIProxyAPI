import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import styles from './ProviderGlyph.module.scss';

/** Provider brand icon in a small tile; decorative — callers name the provider in text. */
export function ProviderGlyph({
  provider,
  resolvedTheme,
  className,
}: {
  provider: QuotaProviderType;
  resolvedTheme: ResolvedTheme;
  className?: string;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  return (
    <span
      className={className ? `${styles.glyph} ${className}` : styles.glyph}
      aria-hidden="true"
      style={
        isThemeSurfaceIconProvider(provider)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.fallback}>
          {getTypeLabel(t, provider).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
