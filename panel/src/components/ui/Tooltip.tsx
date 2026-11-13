import type { ReactNode } from 'react';
import { Tooltip as SdkTooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';
import { IconInfo } from './icons';
import styles from './Tooltip.module.scss';

interface TooltipProps {
  /** The tip: plain text, read on hover, focus or a tap. */
  content: ReactNode;
  /**
   * Text shown as a dotted word that opens the tip. Without it, an (i) button opens it, named by
   * `label`.
   */
  children?: ReactNode;
  label?: string;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * A tip on a button whose only job is the tip, so a tap can open it on a phone. Never wrap an
 * action button; put an (i) beside it instead.
 */
export function Tooltip({ content, children, label, side = 'bottom', className }: TooltipProps) {
  const text = children !== undefined;
  return (
    <SdkTooltip toggleable>
      <TooltipTrigger
        className={[text ? styles.text : styles.icon, className].filter(Boolean).join(' ')}
        aria-label={text ? undefined : label}
      >
        {text ? children : <IconInfo size={16} aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent className={styles.content} side={side} sideOffset={6} collisionPadding={8}>
        {content}
      </TooltipContent>
    </SdkTooltip>
  );
}
