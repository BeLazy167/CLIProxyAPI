import { useState, type ReactNode } from 'react';
import { Popover as SdkPopover, PopoverContent, PopoverTrigger } from '@ui-sdk/react/popover';
import styles from './Popover.module.scss';

interface PopoverProps {
  /** Names the popover. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  /** Names the trigger when its content is only an icon. */
  triggerLabel?: string;
  triggerTitle?: string;
  disabled?: boolean;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** Interactive content beside its trigger: filters, details with an action. */
export function Popover({
  label,
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  disabled = false,
  side = 'bottom',
  align = 'start',
  className,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <SdkPopover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger
        className={triggerClassName}
        aria-label={triggerLabel}
        title={triggerTitle}
        disabled={disabled}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={[styles.content, className].filter(Boolean).join(' ')}
        aria-label={label}
        side={side}
        align={align}
        sideOffset={4}
        collisionPadding={8}
      >
        {typeof children === 'function' ? children(close) : children}
      </PopoverContent>
    </SdkPopover>
  );
}
