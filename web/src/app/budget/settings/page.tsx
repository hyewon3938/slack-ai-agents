'use client';

import { AppShell } from '@/components/ui/app-shell';
import { BudgetSettingsPage } from '@/features/budget/components/budget-settings-page';

export default function Page() {
  return (
    <AppShell>
      <BudgetSettingsPage />
    </AppShell>
  );
}
