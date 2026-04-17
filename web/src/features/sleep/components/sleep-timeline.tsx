'use client';

import { useRef, useState, useEffect } from 'react';
import type { SleepRecordWithEvents, SleepPeriod } from '../lib/types';
import { formatDateLabel, getDayOfWeek } from '../lib/chart-utils';

interface SleepTimelineProps {
  records: SleepRecordWithEvents[];
  period: SleepPeriod;
}

// 20:00(=0) ~ 12:00(=960) 범위를 Y축으로 매핑
const Y_START_HOUR = 20;
const Y_RANGE_MINUTES = 16 * 60;

function timeToY(time: string): number {
  const [h, m] = time.split(':').map(Number);
  let minutesFromStart = (h * 60 + (m ?? 0)) - (Y_START_HOUR * 60);
  if (minutesFromStart < 0) minutesFromStart += 1440;
  return minutesFromStart;
}

function yToRatio(y: number): number {
  return Math.max(0, Math.min(1, y / Y_RANGE_MINUTES));
}

const Y_LABELS = ['20', '22', '0', '2', '4', '6', '8', '10', '12'];
const Y_LABEL_MINUTES = [0, 120, 240, 360, 480, 600, 720, 840, 960];

interface Tooltip {
  x: number;
  y: number;
  record: SleepRecordWithEvents;
}

export function SleepTimeline({ records, period }: SleepTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setCw(el.clientWidth);
  }, []);

  const allowScroll = period === '1m';

  // 1개월일 때만 스크롤을 오른쪽(최신)으로 이동
  useEffect(() => {
    const el = containerRef.current;
    if (el && cw > 0 && allowScroll) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [cw, records, allowScroll]);

  const validRecords = records.filter((r) => r.bedtime && r.wake_time);

  if (validRecords.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">수면 타임라인</h3>
        <p className="py-8 text-center text-sm text-gray-400">기간 내 수면 기록이 없어</p>
      </div>
    );
  }

  const chartHeight = 280;
  const labelWidth = 28;
  const barGap = 2;
  const topPadding = 12;
  const minBarWidth = allowScroll ? 16 : 8;
  const minContentWidth = labelWidth + 8 + validRecords.length * (minBarWidth + barGap);
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 300);
  const availableWidth = chartWidth - labelWidth - 8;
  const barWidth = Math.max(minBarWidth, availableWidth / validRecords.length - barGap);
  const dateAreaHeight = 32;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <style>{`
        @media (hover: none) {
          .desktop-hover-target { display: none; }
          .desktop-tooltip { display: none; }
        }
      `}</style>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">수면 타임라인</h3>
      <div ref={containerRef} className={`relative ${allowScroll ? 'overflow-x-auto' : ''}`}>
        {cw > 0 && (
          <svg
            width={chartWidth}
            height={topPadding + chartHeight + dateAreaHeight}
            className="text-xs"
          >
            {Y_LABELS.map((label, i) => {
              const y = topPadding + ((Y_LABEL_MINUTES[i] ?? 0) / Y_RANGE_MINUTES) * chartHeight;
              return (
                <g key={label}>
                  <text x={labelWidth - 4} y={y + 4} textAnchor="end" className="fill-gray-400 text-[10px]">
                    {label}
                  </text>
                  <line
                    x1={labelWidth} y1={y} x2={chartWidth} y2={y}
                    stroke="#f3f4f6" strokeWidth={1}
                  />
                </g>
              );
            })}

            {validRecords.map((r, i) => {
              const x = labelWidth + i * (barWidth + barGap);
              const bedY = topPadding + yToRatio(timeToY(r.bedtime!)) * chartHeight;
              const wakeY = topPadding + yToRatio(timeToY(r.wake_time!)) * chartHeight;
              const barHeight = Math.max(4, wakeY - bedY);
              const dateLabel = formatDateLabel(r.date);
              const dayLabel = getDayOfWeek(r.date);

              return (
                <g key={r.id}>
                  {/* 투명 히트 영역 — 좁은 바도 hover 쉽게 */}
                  <rect
                    x={x - 2} y={topPadding}
                    width={barWidth + 4} height={chartHeight}
                    fill="transparent"
                    className="desktop-hover-target"
                    onMouseEnter={() => {
                      setTooltip({
                        x: x + barWidth / 2,
                        y: bedY,
                        record: r,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <rect
                    x={x} y={bedY} width={barWidth} height={barHeight}
                    rx={3} fill="#818cf8" opacity={0.8}
                    className="pointer-events-none"
                  />
                  {r.events.map((e) => {
                    const ey = topPadding + yToRatio(timeToY(e.event_time)) * chartHeight;
                    return (
                      <circle
                        key={e.id}
                        cx={x + barWidth / 2} cy={ey}
                        r={2.5} fill="#ef4444"
                        className="pointer-events-none"
                      />
                    );
                  })}
                  <text
                    x={x + barWidth / 2} y={topPadding + chartHeight + 12}
                    textAnchor="middle" className="fill-gray-500 text-[9px]"
                  >
                    {dateLabel}
                  </text>
                  <text
                    x={x + barWidth / 2} y={topPadding + chartHeight + 24}
                    textAnchor="middle" className="fill-gray-400 text-[8px]"
                  >
                    {dayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {tooltip && (() => {
        const r = tooltip.record;
        const hours = r.duration_minutes ? Math.floor(r.duration_minutes / 60) : 0;
        const mins = r.duration_minutes ? r.duration_minutes % 60 : 0;
        const alignRight = tooltip.x > chartWidth - 100;
        const alignLeft = tooltip.x < 100;
        const translateX = alignRight ? '-100%' : alignLeft ? '0%' : '-50%';
        return (
          <div
            className="desktop-tooltip pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 8, transform: `translate(${translateX}, -100%)` }}
          >
            <p className="mb-1 font-semibold text-gray-700">{r.date}</p>
            <p className="text-gray-600">취침 {r.bedtime} → 기상 {r.wake_time}</p>
            {r.duration_minutes != null && (
              <p className="text-gray-600">수면 {hours}시간{mins > 0 ? ` ${mins}분` : ''}</p>
            )}
            {r.events.length > 0 && (
              <div className="mt-1 border-t border-gray-100 pt-1">
                <p className="text-red-500">중간기상 {r.events.length}회</p>
                {r.events.map((e) => (
                  <p key={e.id} className="text-gray-500">&nbsp;&nbsp;{e.event_time}{e.memo ? ` — ${e.memo}` : ''}</p>
                ))}
              </div>
            )}
          </div>
        );
        })()}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-400" /> 수면
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> 중간 기상
        </span>
      </div>
    </div>
  );
}
