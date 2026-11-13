import type { ReactNode } from 'react';
import { Toggle as SdkToggle } from '@ui-sdk/react/toggle';
import styles from './Toggle.module.scss';

interface ToggleProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  /** Replaces the default look, for toggles drawn as cards or chips. */
  className?: string;
}

/** A button that stays pressed, on its own. */
export function Toggle({
  pressed,
  onPressedChange,
  children,
  ariaLabel,
  title,
  disabled = false,
  className,
}: ToggleProps) {
  return (
    <SdkToggle
      className={className ?? styles.toggle}
      pressed={pressed}
      onPressedChange={(next) => onPressedChange(next)}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
    >
      {children}
    </SdkToggle>
  );
}
