'use client';

import { AppShell } from '@/components/ui/app-shell';
import { BudgetPage } from '@/features/budget/components/budget-page';

export default function Page() {
  return (
    <AppShell>
      <BudgetPage />
    </AppShell>
  );
}
