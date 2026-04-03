'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RoutineDayStat } from '@/lib/types';
import { getTodayISO, addDays, getDayName } from '@/lib/kst';
import { MonthlyHeatmap } from './monthly-heatmap';

interface RoutineStatsProps {
  stats: RoutineDayStat[];
  fetchStats: (from: string, to: string) => Promise<void>;
  selectedDate: string;
}

/** 달성률 통계 뷰 — 주간 바차트 + 월간 히트맵 + 기간 선택 */
export function RoutineStats({ stats, fetchStats, selectedDate }: RoutineStatsProps) {
  const today = getTodayISO();
  const weekStart = addDays(today, -6);

  useEffect(() => {
    fetchStats(addDays(today, -30), today);
  }, [fetchStats, today]);

  return (
    <div className="space-y-6">
      <WeeklyChart stats={stats} from={weekStart} to={today} />
      <MonthlyHeatmap stats={stats} selectedDate={selectedDate} />
      <PeriodSelector fetchStats={fetchStats} stats={stats} />
    </div>
  );
}

// ─── 주간 바차트 ────────────────────────────────────

function barColor(rate: number): string {
  if (rate < 0) return '#e5e7eb';
  if (rate < 30) return '#f87171';
  if (rate < 70) return '#fbbf24';
  return '#22c55e';
}

function WeeklyChart({ stats, from, to }: { stats: RoutineDayStat[]; from: string; to: string }) {
  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    stats.forEach((s) => m.set(s.date, s.rate));
    return m;
  }, [stats]);

  const days: { date: string; day: string; rate: number }[] = [];
  let d = from;
  while (d <= to) {
    days.push({ date: d, day: getDayName(d), rate: rateMap.get(d) ?? -1 });
    d = addDays(d, 1);
  }

  const validDays = days.filter((day) => day.rate >= 0);
  const avgRate = validDays.length > 0
    ? Math.round(validDays.reduce((s, day) => s + day.rate, 0) / validDays.length)
    : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">주간 달성률 (최근 7일)</h3>
      <div className="flex items-end justify-between gap-2">
        {days.map((day) => (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-gray-500">
              {day.rate >= 0 ? `${day.rate}%` : '—'}
            </span>
            <div
              className="w-full rounded-t"
              style={{
                height: Math.max(4, day.rate >= 0 ? day.rate * 0.8 : 4),
                backgroundColor: barColor(day.rate),
              }}
            />
            <span className={`text-xs font-medium ${
              day.day === '일' ? 'text-red-400' : day.day === '토' ? 'text-blue-400' : 'text-gray-500'
            }`}>
              {day.day}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-gray-500">이번 주 평균:</span>
        <span className="font-semibold text-green-600">{avgRate}%</span>
      </div>
    </div>
  );
}

// ─── 기간 선택 ──────────────────────────────────────

function PeriodSelector({
  fetchStats, stats,
}: {
  fetchStats: (from: string, to: string) => Promise<void>;
  stats: RoutineDayStat[];
}) {
  const today = getTodayISO();
  const [from, setFrom] = useState(() => addDays(today, -30));
  const [to, setTo] = useState(today);
  const [queried, setQueried] = useState(false);

  const handleSearch = async () => {
    await fetchStats(from, to);
    setQueried(true);
  };

  const avg = useMemo(() => {
    const filtered = stats.filter((s) => s.date >= from && s.date <= to);
    if (filtered.length === 0) return null;
    return Math.round(filtered.reduce((sum, s) => sum + s.rate, 0) / filtered.length);
  }, [stats, from, to]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">기간별 조회</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <span className="text-sm text-gray-400">~</span>
        <input
          type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          조회
        </button>
      </div>
      {queried && avg !== null && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-gray-500">기간 내 평균 달성률:</span>
          <span className="text-base font-bold text-green-600">{avg}%</span>
        </div>
      )}
    </div>
  );
}
