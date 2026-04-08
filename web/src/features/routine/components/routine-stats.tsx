'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { RoutineDayStat, RoutinePerStat } from '@/features/routine/lib/types';
import { getTodayISO, addDays, getDayName } from '@/lib/kst';
import { MonthlyHeatmap } from './monthly-heatmap';
import { YearlyHeatmap } from './yearly-heatmap';
import { RoutineHeatmap } from './routine-heatmap';

interface RoutineStatsProps {
  stats: RoutineDayStat[];
  yearlyStats: RoutineDayStat[];
  fetchStats: (from: string, to: string) => Promise<void>;
  selectedDate: string;
}

/** 달성률 통계 뷰 */
export function RoutineStats({ stats, yearlyStats, fetchStats, selectedDate }: RoutineStatsProps) {
  const today = getTodayISO();
  const weekStart = addDays(today, -6);

  useEffect(() => {
    const defaultFrom = addDays(today, -30);
    fetchStats(defaultFrom, today);
  }, [fetchStats, today]);

  return (
    <div className="space-y-6">
      <YearlyHeatmap stats={yearlyStats} />
      <PerRoutineSection />
      <WeeklyChart stats={stats} from={weekStart} to={today} />
      <MonthlyHeatmap stats={stats} selectedDate={selectedDate} />
    </div>
  );
}

// ─── 루틴별 달성률 (기간 선택 + 히트맵) ─────────────

function PerRoutineSection() {
  const today = getTodayISO();
  const [period, setPeriod] = useState<'all' | 'custom'>('all');
  const [from, setFrom] = useState(() => addDays(today, -30));
  const [to, setTo] = useState(today);
  const [perStats, setPerStats] = useState<RoutinePerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoutine, setSelectedRoutine] = useState<{ id: number; name: string } | null>(null);

  const fetchPerRoutine = useCallback(async (f?: string, t?: string) => {
    const params = f && t ? `&from=${f}&to=${t}` : '';
    const res = await fetch(`/api/routines/stats?type=per-routine${params}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutinePerStat[] };
      setPerStats(data);
    }
  }, []);

  useEffect(() => {
    fetchPerRoutine().finally(() => setLoading(false));
  }, [fetchPerRoutine]);

  const handlePeriodChange = async (p: 'all' | 'custom') => {
    setPeriod(p);
    if (p === 'all') await fetchPerRoutine();
  };

  const handleSearch = async () => {
    await fetchPerRoutine(from, to);
  };

  const handleRoutineClick = (id: number, name: string) => {
    setSelectedRoutine((prev) => (prev?.id === id ? null : { id, name }));
  };

  const avgRate = perStats.length > 0
    ? Math.round(perStats.reduce((sum, s) => sum + s.rate, 0) / perStats.length)
    : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">루틴별 달성률</h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handlePeriodChange('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              period === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            전체
          </button>
          <button
            onClick={() => handlePeriodChange('custom')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              period === 'custom' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            기간 선택
          </button>
        </div>
      </div>

      {/* 기간 선택 UI */}
      {period === 'custom' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <span className="text-sm text-gray-400">~</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSearch}
            className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            조회
          </button>
        </div>
      )}

      {/* 평균 달성률 */}
      {perStats.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-gray-500">평균 달성률</span>
          <span className="text-lg font-bold text-green-600">{avgRate}%</span>
        </div>
      )}

      {/* 루틴별 리스트 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : perStats.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">루틴 기록이 없어</p>
      ) : (
        <div className="space-y-1.5">
          {perStats.map((s) => (
            <div key={s.template_id}>
              <button
                onClick={() => handleRoutineClick(s.template_id, s.name)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-gray-50 ${
                  selectedRoutine?.id === s.template_id ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                }`}
              >
                <div className="w-24 shrink-0 md:w-32">
                  <div className="truncate text-sm font-medium text-gray-800" title={s.name}>
                    {s.name}
                  </div>
                  <div className="text-xs text-gray-400">{s.days_active}일째</div>
                </div>
                <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all"
                    style={{ width: `${s.rate}%`, backgroundColor: rateColor(s.rate) }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs text-gray-500">
                  {s.completed}/{s.total}
                  <span className="ml-1 font-semibold text-gray-700">{s.rate}%</span>
                </span>
              </button>

              {/* 선택된 루틴 히트맵 (인라인 펼침) */}
              {selectedRoutine?.id === s.template_id && (
                <div className="mt-1 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                  <RoutineHeatmap templateId={s.template_id} templateName={s.name} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function rateColor(rate: number): string {
  if (rate >= 70) return '#22c55e';
  if (rate >= 30) return '#fbbf24';
  return '#f87171';
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
