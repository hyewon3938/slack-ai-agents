'use client';

import { useState } from 'react';
import { TopTabs } from '@/components/ui/tabs';
import { SleepDashboard } from '@/features/sleep/components/sleep-dashboard';
import { RoutinePage } from '@/features/routine/components/routine-page';

type LifeView = 'sleep' | 'routine';

const LIFE_TABS: { id: LifeView; label: string }[] = [
  { id: 'sleep', label: '수면' },
  { id: 'routine', label: '루틴' },
];

export function LifePage() {
  const [view, setView] = useState<LifeView>('sleep');

  return (
    <div className="flex flex-1 flex-col">
      <TopTabs tabs={LIFE_TABS} active={view} onChange={setView} />
      {view === 'sleep' && <SleepDashboard />}
      {view === 'routine' && <RoutinePage />}
    </div>
  );
}
