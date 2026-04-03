'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RoutineDayStat } from '@/lib/types';
import { getTodayISO, addDays, getDayName } from '@/lib/kst';

interface RoutineStatsProps {
  stats: RoutineDayStat[];
  fetchStats: (from: string, to: string) => Promise<void>;
  selectedDate: string;
}

/** 달성률 통계 뷰 — 주간 바차트 + 월간 히트맵 + 기간 선택 */
export function RoutineStats({ stats, fetchStats, selectedDate }: RoutineStatsProps) {
  const today = getTodayISO();
  const weekStart = addDays(today, -6);

  // 초기 로드: 최근 30일
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

  const avg = days.filter((d) => d.rate >= 0);
  const avgRate = avg.length > 0 ? Math.round(avg.reduce((s, d) => s + d.rate, 0) / avg.length) : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">주간 달성률 (최근 7일)</h3>
      <div className="flex items-end justify-between gap-2">
        {days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-gray-500">
              {d.rate >= 0 ? `${d.rate}%` : '—'}
            </span>
            <div
              className="w-full rounded-t"
              style={{
                height: Math.max(4, d.rate >= 0 ? d.rate * 0.8 : 4),
                backgroundColor: barColor(d.rate),
              }}
            />
            <span className={`text-xs font-medium ${
              d.day === '일' ? 'text-red-400' : d.day === '토' ? 'text-blue-400' : 'text-gray-500'
            }`}>
              {d.day}
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

function barColor(rate: number): string {
  if (rate < 0) return '#e5e7eb';
  if (rate < 30) return '#f87171';
  if (rate < 70) return '#fbbf24';
  return '#22c55e';
}

// ─── 월간 히트맵 ────────────────────────────────────

function MonthlyHeatmap({ stats, selectedDate }: { stats: RoutineDayStat[]; selectedDate: string }) {
  const [year, setYear] = useState(() => Number(selectedDate.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(selectedDate.slice(5, 7)));

  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    stats.forEach((s) => m.set(s.date, s.rate));
    return m;
  }, [stats]);

  const handlePrev = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const handleNext = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // 달력 그리드 생성
  const weeks = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const grid: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);

    for (let d = 1; d <= daysInMonth; d++) {
      week.push(d);
      if (week.length === 7) { grid.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      grid.push(week);
    }
    return grid;
  }, [year, month]);

  const dayHeaders = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* 월 네비게이션 */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={handlePrev} className="text-sm text-gray-400 hover:text-gray-600">◀</button>
        <h3 className="text-sm font-semibold text-gray-900">{year}년 {month}월</h3>
        <button onClick={handleNext} className="text-sm text-gray-400 hover:text-gray-600">▶</button>
      </div>

      {/* 요일 헤더 */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {dayHeaders.map((d, i) => (
          <div
            key={d}
            className={`text-center text-xs font-medium ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 히트맵 그리드 */}
      <div className="grid gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              if (day === null) return <div key={di} className="aspect-square" />;
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const rate = rateMap.get(dateStr);
              return (
                <div
                  key={di}
                  className="flex aspect-square items-center justify-center rounded text-xs"
                  style={{ backgroundColor: heatColor(rate) }}
                  title={rate !== undefined ? `${dateStr}: ${rate}%` : dateStr}
                >
                  <span className={`${rate !== undefined ? 'text-gray-700' : 'text-gray-400'}`}>
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 범례 */}
      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
        <span>낮음</span>
        {['#f3f4f6', '#dcfce7', '#86efac', '#4ade80', '#22c55e', '#16a34a'].map((c) => (
          <div key={c} className="h-3 w-3 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>높음</span>
      </div>
    </div>
  );
}

function heatColor(rate: number | undefined): string {
  if (rate === undefined) return '#f9fafb';
  if (rate === 0) return '#f3f4f6';
  if (rate < 30) return '#dcfce7';
  if (rate < 50) return '#86efac';
  if (rate < 70) return '#4ade80';
  if (rate < 90) return '#22c55e';
  return '#16a34a';
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
