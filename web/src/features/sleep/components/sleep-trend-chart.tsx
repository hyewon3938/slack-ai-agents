'use client';

import { useRef, useState, useEffect } from 'react';
import type { SleepRecordWithEvents, SleepPeriod } from '../lib/types';
import { formatDateLabel, getDayOfWeek } from '../lib/chart-utils';

interface SleepTrendChartProps {
  records: SleepRecordWithEvents[];
  period: SleepPeriod;
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (ref.current) setW(ref.current.clientWidth);
  }, []);
  return { ref, w };
}

function useScrollToEnd(
  ref: React.RefObject<HTMLDivElement | null>,
  w: number,
  deps: unknown[],
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (el && w > 0 && enabled) {
      el.scrollLeft = el.scrollWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, enabled, ...deps]);
}

function DurationChart({ records, allowScroll }: { records: SleepRecordWithEvents[]; allowScroll: boolean }) {
  const { ref, w: cw } = useContainerWidth();
  const valid = records.filter((r) => r.duration_minutes != null);
  useScrollToEnd(ref, cw, [valid.length], allowScroll);
  if (valid.length === 0) return null;

  const maxDur = Math.max(...valid.map((r) => r.duration_minutes!));
  const chartHeight = 120;
  const barGap = 3;
  const minBarWidth = allowScroll ? 16 : 6;
  const minContentWidth = 8 + valid.length * (minBarWidth + barGap);
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 200);
  const barWidth = Math.max(minBarWidth, (chartWidth - 8) / valid.length - barGap);
  const dateAreaHeight = 32;

  const idealMin = 420;
  const idealMax = 480;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">수면 시간 추이</h3>
      <div ref={ref} className={allowScroll ? 'overflow-x-auto' : ''}>
        {cw > 0 && (
          <svg
            width={chartWidth}
            height={chartHeight + 24 + dateAreaHeight}
            className="text-xs"
          >
            <rect
              x={0} y={(1 - idealMax / (maxDur + 60)) * chartHeight}
              width={chartWidth} height={((idealMax - idealMin) / (maxDur + 60)) * chartHeight}
              fill="#d1fae5" opacity={0.3}
            />

            {valid.map((r, i) => {
              const x = i * (barWidth + 3) + 2;
              const h = (r.duration_minutes! / (maxDur + 60)) * chartHeight;
              const y = chartHeight - h;
              const hours = Math.floor(r.duration_minutes! / 60);
              const mins = r.duration_minutes! % 60;
              const isLow = r.duration_minutes! < idealMin;
              const color = isLow ? '#f87171' : '#818cf8';
              const dateLabel = formatDateLabel(r.date);
              const dayLabel = getDayOfWeek(r.date);

              return (
                <g key={r.id}>
                  <rect x={x} y={y} width={barWidth} height={h} rx={2} fill={color} opacity={0.8} />
                  <text x={x + barWidth / 2} y={y - 3} textAnchor="middle" className="fill-gray-500 text-[8px]">
                    {hours}h{mins > 0 ? mins : ''}
                  </text>
                  <text
                    x={x + barWidth / 2} y={chartHeight + 12}
                    textAnchor="middle" className="fill-gray-500 text-[9px]"
                  >
                    {dateLabel}
                  </text>
                  <text
                    x={x + barWidth / 2} y={chartHeight + 24}
                    textAnchor="middle" className="fill-gray-400 text-[8px]"
                  >
                    {dayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-green-100" /> 적정 (7~8h)
        </span>
      </div>
    </div>
  );
}

function TimesTrendChart({ records, allowScroll }: { records: SleepRecordWithEvents[]; allowScroll: boolean }) {
  const { ref, w: cw } = useContainerWidth();
  const valid = records.filter((r) => r.bedtime && r.wake_time);
  useScrollToEnd(ref, cw, [valid.length], allowScroll);
  if (valid.length === 0) return null;

  const chartHeight = 140;
  const minPointGap = allowScroll ? 18 : 0;
  const minContentWidth = 48 + valid.length * minPointGap;
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 200);
  const padding = { left: 36, right: 12, top: 8, bottom: 36 };
  const innerW = chartWidth - padding.left - padding.right;
  const innerH = chartHeight - padding.top - padding.bottom;

  const yStart = 20 * 60;
  const yRange = 16 * 60;

  function timeToNorm(time: string): number {
    const [h, m] = time.split(':').map(Number);
    let mins = h * 60 + (m ?? 0) - yStart;
    if (mins < 0) mins += 1440;
    return mins / yRange;
  }

  const bedPoints = valid.map((r, i) => ({
    x: padding.left + (i / Math.max(1, valid.length - 1)) * innerW,
    y: padding.top + timeToNorm(r.bedtime!) * innerH,
  }));
  const wakePoints = valid.map((r, i) => ({
    x: padding.left + (i / Math.max(1, valid.length - 1)) * innerW,
    y: padding.top + timeToNorm(r.wake_time!) * innerH,
  }));

  const bedPath = bedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const wakePath = wakePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  const yLabels = ['20', '0', '4', '8', '12'];
  const yLabelNorms = [0, 240 / 960, 480 / 960, 720 / 960, 1];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">취침 · 기상 시간 추이</h3>
      <div ref={ref} className={allowScroll ? 'overflow-x-auto' : ''}>
        {cw > 0 && (
          <svg width={chartWidth} height={chartHeight + 12} className="text-xs">
            {yLabels.map((label, i) => {
              const y = padding.top + (yLabelNorms[i] ?? 0) * innerH;
              return (
                <g key={label}>
                  <text x={padding.left - 4} y={y + 3} textAnchor="end" className="fill-gray-400 text-[10px]">
                    {label}시
                  </text>
                  <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#f3f4f6" />
                </g>
              );
            })}
            <path d={bedPath} fill="none" stroke="#818cf8" strokeWidth={1.5} />
            {bedPoints.map((p, i) => (
              <circle key={`b${i}`} cx={p.x} cy={p.y} r={2.5} fill="#818cf8" />
            ))}
            <path d={wakePath} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
            {wakePoints.map((p, i) => (
              <circle key={`w${i}`} cx={p.x} cy={p.y} r={2.5} fill="#f59e0b" />
            ))}
            {valid.map((r, i) => {
              const x = padding.left + (i / Math.max(1, valid.length - 1)) * innerW;
              const step = Math.max(1, Math.floor(valid.length / 7));
              if (i % step !== 0 && i !== valid.length - 1) return null;
              const dateLabel = formatDateLabel(r.date);
              const dayLabel = getDayOfWeek(r.date);
              return (
                <g key={r.id}>
                  <text x={x} y={chartHeight - padding.bottom + 14} textAnchor="middle" className="fill-gray-500 text-[9px]">
                    {dateLabel}
                  </text>
                  <text x={x} y={chartHeight - padding.bottom + 26} textAnchor="middle" className="fill-gray-400 text-[8px]">
                    {dayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-indigo-400" /> 취침
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-amber-400" /> 기상
        </span>
      </div>
    </div>
  );
}

export function SleepTrendChart({ records, period }: SleepTrendChartProps) {
  const allowScroll = period === '1m';
  return (
    <div className="space-y-4">
      <DurationChart records={records} allowScroll={allowScroll} />
      <TimesTrendChart records={records} allowScroll={allowScroll} />
    </div>
  );
}
