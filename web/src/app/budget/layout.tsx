'use client';

import { AppShell } from '@/components/ui/app-shell';
import { LinkTopTabs } from '@/components/ui/tabs';

const BUDGET_TABS = [
  { href: '/budget/manage', label: '관리' },
  { href: '/budget/analysis', label: '분석' },
  { href: '/budget/settings', label: '설정' },
];

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col">
        <LinkTopTabs tabs={BUDGET_TABS} maxWidth="max-w-2xl" />
        {children}
      </div>
    </AppShell>
  );
}
