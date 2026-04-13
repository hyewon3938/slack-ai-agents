'use client';

import { useSleepDashboard } from '../hooks/use-sleep-dashboard';
import { PeriodSelector } from './period-selector';
import { SleepSummaryCards } from './sleep-summary-cards';
import { SleepTimeline } from './sleep-timeline';
import { SleepTrendChart } from './sleep-trend-chart';
import { SleepDayPattern } from './sleep-day-pattern';
import { CardSkeleton } from '@/components/ui/skeleton';

export function SleepDashboard() {
  const { period, data, loading, handlePeriodChange } = useSleepDashboard();

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <CardSkeleton className="h-10" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <CardSkeleton key={i} className="h-20" />)}
        </div>
        <CardSkeleton className="h-64" />
        <CardSkeleton className="h-48" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 md:py-6">
        <PeriodSelector period={period} onChange={handlePeriodChange} />
        <SleepSummaryCards summary={data.summary} />
        <SleepTimeline records={data.records} />
        <SleepTrendChart records={data.records} />
        <SleepDayPattern pattern={data.dayOfWeekPattern} />
      </div>
    </div>
  );
}
