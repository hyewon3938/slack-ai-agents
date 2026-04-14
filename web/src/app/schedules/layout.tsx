'use client';

import { AppShell } from '@/components/ui/app-shell';
import { LinkTopTabs } from '@/components/ui/tabs';

const SCHEDULE_TABS = [
  { href: '/schedules/calendar', label: '캘린더' },
  { href: '/schedules/backlog', label: '백로그' },
  { href: '/schedules/categories', label: '카테고리' },
];

export default function SchedulesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col">
        <LinkTopTabs tabs={SCHEDULE_TABS} />
        {children}
      </div>
    </AppShell>
  );
}
