import { useState } from 'react';
import { IconPlug } from '@/components/ui/icons';
import styles from './PluginLogo.module.scss';

interface PluginLogoProps {
  src: string;
  /** Box edge in px; the fallback icon scales with it. */
  size?: 40 | 36 | 52;
  className?: string;
}

/** Logo box with a plug fallback; shared by the Plugins list, Store cards and modals. */
export function PluginLogo({ src, size = 40, className }: PluginLogoProps) {
  const [failedSrc, setFailedSrc] = useState('');
  const showImage = Boolean(src) && failedSrc !== src;
  const iconSize = size >= 52 ? 26 : 18;

  return (
    <span
      className={[styles.box, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <IconPlug size={iconSize} />
      )}
    </span>
  );
}
