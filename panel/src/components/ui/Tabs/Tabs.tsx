import type { ComponentProps, ReactNode } from 'react';
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import styles from './Tabs.module.scss';

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}

/** Tabs whose list and panels may sit apart; both go inside this root. */
export function Tabs({ value, onChange, className, children }: TabsProps) {
  return (
    <SdkTabs
      className={className}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
    >
      {children}
    </SdkTabs>
  );
}

export function TabList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList {...props} className={[styles.list, className].filter(Boolean).join(' ')} />;
}

export function Tab({ className, ...props }: ComponentProps<typeof TabsTab>) {
  return <TabsTab {...props} className={[styles.tab, className].filter(Boolean).join(' ')} />;
}

export function TabPanel(props: ComponentProps<typeof TabsPanel>) {
  return <TabsPanel {...props} />;
}
