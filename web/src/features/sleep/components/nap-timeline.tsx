'use client';

import { useRef, useState, useEffect } from 'react';
import type { DailySleep, SleepRecord, SleepPeriod } from '../lib/types';
import { formatDateLabel, getDayOfWeek } from '../lib/chart-utils';

interface NapTimelineProps {
  dailies: DailySleep[];
  period: SleepPeriod;
}

// 12:00(=0) ~ 24:00(=720) 범위를 Y축으로 매핑
const Y_START_MINUTES = 12 * 60;
const Y_RANGE_MINUTES = 12 * 60;

const Y_LABELS = ['12', '14', '16', '18', '20', '22', '24'];
const Y_LABEL_MINUTES = [0, 120, 240, 360, 480, 600, 720];

function timeToNapY(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const totalMins = (h ?? 0) * 60 + (m ?? 0);
  return Math.max(0, totalMins - Y_START_MINUTES);
}

function yToRatio(y: number): number {
  return Math.max(0, Math.min(1, y / Y_RANGE_MINUTES));
}

interface Tooltip {
  x: number;
  y: number;
  date: string;
  naps: SleepRecord[];
}

export function NapTimeline({ dailies, period }: NapTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setCw(el.clientWidth);
  }, []);

  const allowScroll = period === '1m';

  useEffect(() => {
    const el = containerRef.current;
    if (el && cw > 0 && allowScroll) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [cw, dailies, allowScroll]);

  // 외부 탭 시 툴팁 닫기 (모바일)
  useEffect(() => {
    if (!tooltip) return;
    const handler = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [tooltip]);

  const hasAnyNap = dailies.some((d) => d.afternoonNaps.length > 0);

  if (!hasAnyNap) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">낮잠 타임라인</h3>
        <p className="py-8 text-center text-sm text-gray-400">이 기간에 낮잠 기록이 없어</p>
      </div>
    );
  }

  const chartHeight = 200;
  const labelWidth = 28;
  const barGap = 2;
  const topPadding = 12;
  const minBarWidth = allowScroll ? 16 : 8;
  const minContentWidth = labelWidth + 8 + dailies.length * (minBarWidth + barGap);
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 300);
  const availableWidth = chartWidth - labelWidth - 8;
  const barWidth = Math.max(minBarWidth, availableWidth / dailies.length - barGap);
  const dateAreaHeight = 32;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">낮잠 타임라인</h3>
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

            {dailies.map((d, i) => {
              const x = labelWidth + i * (barWidth + barGap);
              const dateLabel = formatDateLabel(d.date);
              const dayLabel = getDayOfWeek(d.date);

              return (
                <g key={d.date}>
                  {d.afternoonNaps.length > 0 && (
                    <rect
                      x={x - 2} y={topPadding}
                      width={barWidth + 4} height={chartHeight}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        if (e.pointerType === 'touch') return;
                        setTooltip({ x: x + barWidth / 2, y: topPadding, date: d.date, naps: d.afternoonNaps });
                      }}
                      onMouseLeave={(e) => {
                        if (e.pointerType === 'touch') return;
                        setTooltip(null);
                      }}
                      onClick={() => {
                        setTooltip((prev) =>
                          prev?.date === d.date ? null : { x: x + barWidth / 2, y: topPadding, date: d.date, naps: d.afternoonNaps },
                        );
                      }}
                    />
                  )}
                  {d.afternoonNaps.map((nap, ni) => {
                    if (!nap.bedtime || !nap.wake_time) return null;
                    const bedY = topPadding + yToRatio(timeToNapY(nap.bedtime)) * chartHeight;
                    const wakeY = topPadding + yToRatio(timeToNapY(nap.wake_time)) * chartHeight;
                    return (
                      <rect
                        key={ni}
                        x={x} y={bedY}
                        width={barWidth} height={Math.max(4, wakeY - bedY)}
                        rx={3} fill="#a78bfa" opacity={0.8}
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
          const alignRight = tooltip.x > chartWidth - 120;
          const alignLeft = tooltip.x < 120;
          const translateX = alignRight ? '-100%' : alignLeft ? '0%' : '-50%';
          return (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: tooltip.x, top: 0, transform: `translateX(${translateX})` }}
            >
              <p className="mb-1 font-semibold text-gray-700">{tooltip.date}</p>
              {tooltip.naps.map((nap, i) => {
                const h = nap.duration_minutes ? Math.floor(nap.duration_minutes / 60) : 0;
                const m = nap.duration_minutes ? nap.duration_minutes % 60 : 0;
                return (
                  <div key={i}>
                    <p className="text-violet-500">
                      {nap.bedtime} → {nap.wake_time ?? '?'}
                    </p>
                    {nap.duration_minutes != null && (
                      <p className="text-gray-500">{h}시간{m > 0 ? ` ${m}분` : ''}</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" /> 낮잠
        </span>
      </div>
    </div>
  );
}
