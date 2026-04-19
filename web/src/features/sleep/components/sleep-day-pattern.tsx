'use client';

import type { DayOfWeekPattern } from '../lib/types';
import { useChartTooltip } from '../hooks/use-chart-tooltip';

interface SleepDayPatternProps {
  pattern: DayOfWeekPattern[];
}

function barColor(minutes: number): string {
  if (minutes >= 420) return '#818cf8';
  if (minutes >= 360) return '#fbbf24';
  return '#f87171';
}

function minsToTimeStr(mins: number): string {
  let m = mins;
  if (m < 0) m += 1440;
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface PatternTooltip {
  day: number;
  x: number;
}

const DAY_FULL: Record<string, string> = {
  '일': '일요일', '월': '월요일', '화': '화요일',
  '수': '수요일', '목': '목요일', '금': '금요일', '토': '토요일',
};

export function SleepDayPattern({ pattern }: SleepDayPatternProps) {
  const ordered = [1, 2, 3, 4, 5, 6, 0].map((d) => pattern.find((p) => p.day === d)!);
  const maxDur = Math.max(...ordered.map((p) => p.avgDuration), 1);
  const { tooltip, setTooltip, ref } = useChartTooltip<PatternTooltip>();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">요일별 수면 패턴</h3>
      <div ref={ref} className="relative flex items-end justify-between gap-2">
        {ordered.map((p) => {
          const h = Math.floor(p.avgDuration / 60);
          const m = p.avgDuration % 60;
          const heightPx = Math.max(4, (p.avgDuration / (maxDur + 60)) * 100);
          return (
            <div
              key={p.day}
              className="flex flex-1 flex-col items-center gap-1"
              style={{ cursor: p.count > 0 ? 'pointer' : 'default' }}
              onMouseEnter={() => {
                if (p.count === 0) return;
                setTooltip((prev) => prev?.day === p.day ? prev : { day: p.day, x: 0 });
              }}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (p.count === 0) return;
                setTooltip((prev) => prev?.day === p.day ? null : { day: p.day, x: 0 });
              }}
            >
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
        {tooltip && (() => {
          const p = ordered.find((o) => o.day === tooltip.day);
          if (!p || p.count === 0) return null;
          const h = Math.floor(p.avgDuration / 60);
          const m = p.avgDuration % 60;
          return (
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
              <p className="mb-1 font-semibold text-gray-700">{DAY_FULL[p.dayName] ?? p.dayName}</p>
              <p className="text-gray-600">평균 {h}시간{m > 0 ? ` ${m}분` : ''}</p>
              {p.avgBedtime !== 0 && (
                <p className="text-gray-500">
                  취침 {minsToTimeStr(p.avgBedtime)} · 기상 {minsToTimeStr(p.avgWakeTime)}
                </p>
              )}
              <p className="text-gray-400">기록 {p.count}일</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
