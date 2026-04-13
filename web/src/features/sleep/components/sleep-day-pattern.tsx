'use client';

import type { DayOfWeekPattern } from '../lib/types';

interface SleepDayPatternProps {
  pattern: DayOfWeekPattern[];
}

function barColor(minutes: number): string {
  if (minutes >= 420) return '#818cf8';
  if (minutes >= 360) return '#fbbf24';
  return '#f87171';
}

export function SleepDayPattern({ pattern }: SleepDayPatternProps) {
  const ordered = [1, 2, 3, 4, 5, 6, 0].map((d) => pattern.find((p) => p.day === d)!);
  const maxDur = Math.max(...ordered.map((p) => p.avgDuration), 1);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">요일별 수면 패턴</h3>
      <div className="flex items-end justify-between gap-2">
        {ordered.map((p) => {
          const h = Math.floor(p.avgDuration / 60);
          const m = p.avgDuration % 60;
          const heightPx = Math.max(4, (p.avgDuration / (maxDur + 60)) * 100);
          return (
            <div key={p.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-gray-500">
                {p.count > 0 ? `${h}h${m > 0 ? m : ''}` : '—'}
              </span>
              <div
                className="w-full rounded-t"
                style={{
                  height: heightPx,
                  backgroundColor: p.count > 0 ? barColor(p.avgDuration) : '#e5e7eb',
                }}
              />
              <span className={`text-xs font-medium ${
                p.dayName === '일' ? 'text-red-400' : p.dayName === '토' ? 'text-blue-400' : 'text-gray-500'
              }`}>
                {p.dayName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
