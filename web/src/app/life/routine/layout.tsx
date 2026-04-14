'use client';

import { LinkPillTabs } from '@/components/ui/tabs';

const ROUTINE_TABS = [
  { href: '/life/routine/checklist', label: '체크리스트' },
  { href: '/life/routine/stats', label: '통계' },
  { href: '/life/routine/manage', label: '관리' },
];

export default function RoutineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-4 pt-4">
        <LinkPillTabs tabs={ROUTINE_TABS} />
      </div>
      {children}
    </div>
  );
}
