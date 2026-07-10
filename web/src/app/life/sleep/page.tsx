'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSleepDashboard } from '@/features/sleep/hooks/use-sleep-dashboard';
import { PeriodSelector } from '@/features/sleep/components/period-selector';
import { SleepScoreCard } from '@/features/sleep/components/sleep-score-card';
import { SleepSummaryCards } from '@/features/sleep/components/sleep-summary-cards';
import { SleepTimeline } from '@/features/sleep/components/sleep-timeline';
import { SleepTrendChart } from '@/features/sleep/components/sleep-trend-chart';
import { NapTimeline } from '@/features/sleep/components/nap-timeline';
import { SleepDayPattern } from '@/features/sleep/components/sleep-day-pattern';
import { CardSkeleton } from '@/components/ui/skeleton';
import type { SleepPeriod } from '@/features/sleep/lib/types';

const VALID_PERIODS: SleepPeriod[] = ['1w', '2w', '1m'];

function SleepFallback() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 md:py-6">
        <CardSkeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} className="h-24" />
          ))}
        </div>
        <CardSkeleton className="h-80" />
      </div>
    </div>
  );
}

export default function SleepPage() {
  return (
    <Suspense fallback={<SleepFallback />}>
      <SleepContent />
    </Suspense>
  );
}

function SleepContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rangeParam = searchParams.get('range') as SleepPeriod | null;
  const initialPeriod = rangeParam && VALID_PERIODS.includes(rangeParam) ? rangeParam : '1w';

  const { period, data, loading, handlePeriodChange } = useSleepDashboard(initialPeriod);

  const onPeriodChange = (p: SleepPeriod) => {
    handlePeriodChange(p);
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', p);
    router.replace(`/life/sleep?${params.toString()}`, { scroll: false });
  };

  if (loading && !data) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 md:py-6">
          <CardSkeleton className="h-10 w-48" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <CardSkeleton key={i} className="h-24" />
            ))}
          </div>
          <CardSkeleton className="h-80" />
          <CardSkeleton className="h-48" />
          <CardSkeleton className="h-48" />
          <CardSkeleton className="h-36" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 md:py-6">
        <PeriodSelector period={period} onChange={onPeriodChange} />
        <SleepScoreCard scores={data.summary.scores} />
        <SleepSummaryCards summary={data.summary} />
        <SleepTimeline dailies={data.dailySleeps} period={period} />
        <SleepTrendChart dailies={data.dailySleeps} period={period} />
        <NapTimeline dailies={data.dailySleeps} period={period} />
        <SleepDayPattern pattern={data.dayOfWeekPattern} />
      </div>
    </div>
  );
}
