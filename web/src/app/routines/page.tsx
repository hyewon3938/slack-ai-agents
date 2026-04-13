'use client';

import { AppShell } from '@/components/ui/app-shell';
import { LifePage } from '@/features/life/components/life-page';

export default function RoutinesPageRoute() {
  return (
    <AppShell>
      <LifePage />
    </AppShell>
  );
}
