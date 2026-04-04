'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RoutineDayStat, RoutinePerStat } from '@/lib/types';
import { getTodayISO, addDays, getDayName } from '@/lib/kst';
import { MonthlyHeatmap } from './monthly-heatmap';
import { YearlyHeatmap } from './yearly-heatmap';

interface RoutineStatsProps {
  stats: RoutineDayStat[];
  yearlyStats: RoutineDayStat[];
  perRoutineStats: RoutinePerStat[];
  fetchStats: (from: string, to: string) => Promise<void>;
  fetchPerRoutineStats: (from: string, to: string) => Promise<void>;
  selectedDate: string;
}

/** 달성률 통계 뷰 — 기간 선택 + 1년 히트맵 + 주간 바차트 + 월간 히트맵 + 루틴별 달성률 */
export function RoutineStats({
  stats,
  yearlyStats,
  perRoutineStats,
  fetchStats,
  fetchPerRoutineStats,
  selectedDate,
}: RoutineStatsProps) {
  const today = getTodayISO();
  const weekStart = addDays(today, -6);

  useEffect(() => {
    const defaultFrom = addDays(today, -30);
    fetchStats(defaultFrom, today);
    fetchPerRoutineStats(defaultFrom, today);
  }, [fetchStats, fetchPerRoutineStats, today]);

  return (
    <div className="space-y-6">
      <PeriodSelector fetchStats={fetchStats} fetchPerRoutineStats={fetchPerRoutineStats} stats={stats} />
      <YearlyHeatmap stats={yearlyStats} />
      <WeeklyChart stats={stats} from={weekStart} to={today} />
      <MonthlyHeatmap stats={stats} selectedDate={selectedDate} />
      <PerRoutineChart stats={perRoutineStats} />
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
  fetchStats,
  fetchPerRoutineStats,
  stats,
}: {
  fetchStats: (from: string, to: string) => Promise<void>;
  fetchPerRoutineStats: (from: string, to: string) => Promise<void>;
  stats: RoutineDayStat[];
}) {
  const today = getTodayISO();
  const [from, setFrom] = useState(() => addDays(today, -30));
  const [to, setTo] = useState(today);
  const [queried, setQueried] = useState(false);

  const handleSearch = async () => {
    await Promise.all([fetchStats(from, to), fetchPerRoutineStats(from, to)]);
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

// ─── 루틴별 달성률 바차트 ────────────────────────────

function perBarColor(rate: number): string {
  if (rate >= 70) return '#22c55e';
  if (rate >= 30) return '#fbbf24';
  return '#f87171';
}

function PerRoutineChart({ stats }: { stats: RoutinePerStat[] }) {
  if (stats.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">루틴별 달성률</h3>
      <div className="space-y-3">
        {stats.map((s) => (
          <div key={s.template_id} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-sm text-gray-700" title={s.name}>
              {s.name}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all"
                style={{
                  width: `${s.rate}%`,
                  backgroundColor: perBarColor(s.rate),
                }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-sm font-medium text-gray-600">
              {s.rate}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
