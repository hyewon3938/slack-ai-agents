'use client';

import { useRoutines } from '@/features/routine/hooks/use-routines';
import { RoutineStats } from '@/features/routine/components/routine-stats';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function StatsPage() {
  const { stats, yearlyStats, selectedDate, loading, fetchStats } = useRoutines();

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4">
        <ListSkeleton rows={5} rowHeight="h-14" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-4 md:py-6">
        <RoutineStats
          stats={stats}
          yearlyStats={yearlyStats}
          fetchStats={fetchStats}
          selectedDate={selectedDate}
        />
      </div>
    </div>
  );
}
