'use client';

import { AppShell } from '@/components/ui/app-shell';
import { RoutinePage } from '@/features/routine/components/routine-page';

export default function RoutinesPageRoute() {
  return (
    <AppShell>
      <RoutinePage />
    </AppShell>
  );
}
