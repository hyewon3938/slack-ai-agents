'use client';

import { AppShell } from '@/components/ui/app-shell';
import { LinkTopTabs } from '@/components/ui/tabs';

const LIFE_TABS = [
  { href: '/life/routine', label: '루틴' },
  { href: '/life/sleep', label: '수면' },
];

export default function LifeLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col">
        <LinkTopTabs tabs={LIFE_TABS} />
        {children}
      </div>
    </AppShell>
  );
}
