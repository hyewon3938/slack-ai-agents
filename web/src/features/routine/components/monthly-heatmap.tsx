'use client';

import { useState, useMemo } from 'react';
import type { RoutineDayStat } from '@/lib/types';

interface MonthlyHeatmapProps {
  stats: RoutineDayStat[];
  selectedDate: string;
}

const DAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'];
const LEGEND_COLORS = ['#f3f4f6', '#dcfce7', '#86efac', '#4ade80', '#22c55e', '#16a34a'];

function heatColor(rate: number | undefined): string {
  if (rate === undefined) return '#f9fafb';
  if (rate === 0) return '#f3f4f6';
  if (rate < 30) return '#dcfce7';
  if (rate < 50) return '#86efac';
  if (rate < 70) return '#4ade80';
  if (rate < 90) return '#22c55e';
  return '#16a34a';
}

/** GitHub 잔디 스타일 월간 히트맵 */
export function MonthlyHeatmap({ stats, selectedDate }: MonthlyHeatmapProps) {
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={handlePrev} className="text-sm text-gray-400 hover:text-gray-600">◀</button>
        <h3 className="text-sm font-semibold text-gray-900">{year}년 {month}월</h3>
        <button onClick={handleNext} className="text-sm text-gray-400 hover:text-gray-600">▶</button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((d, i) => (
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
                  <span className={rate !== undefined ? 'text-gray-700' : 'text-gray-400'}>
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
        <span>낮음</span>
        {LEGEND_COLORS.map((c) => (
          <div key={c} className="h-3 w-3 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>높음</span>
      </div>
    </div>
  );
}
