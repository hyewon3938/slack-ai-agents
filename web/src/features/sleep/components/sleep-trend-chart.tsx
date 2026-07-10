'use client';

import { useRef, useState, useEffect } from 'react';
import type { DailySleep, SleepPeriod } from '../lib/types';
import { formatDateLabel, getDayOfWeek } from '../lib/chart-utils';

interface SleepTrendChartProps {
  dailies: DailySleep[];
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

function DurationChart({ dailies, allowScroll }: { dailies: DailySleep[]; allowScroll: boolean }) {
  const { ref, w: cw } = useContainerWidth();
  const valid = dailies.filter((d) => d.totalNightDurationMinutes > 0);
  useScrollToEnd(ref, cw, [valid.length], allowScroll);
  if (valid.length === 0) return null;

  const maxDur = Math.max(...valid.map((d) => d.totalNightDurationMinutes));
  const chartHeight = 120;
  const barGap = 3;
  const minBarWidth = allowScroll ? 16 : 6;
  const minContentWidth = 8 + dailies.length * (minBarWidth + barGap);
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 200);
  const barWidth = Math.max(minBarWidth, (chartWidth - 8) / dailies.length - barGap);
  const dateAreaHeight = 32;

  const idealMin = 420;
  const idealMax = 480;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">수면 시간 추이</h3>
      <div ref={ref} className={allowScroll ? 'overflow-x-auto' : ''}>
        {cw > 0 && (
          <svg width={chartWidth} height={chartHeight + 24 + dateAreaHeight} className="text-xs">
            <rect
              x={0}
              y={(1 - idealMax / (maxDur + 60)) * chartHeight}
              width={chartWidth}
              height={((idealMax - idealMin) / (maxDur + 60)) * chartHeight}
              fill="#d1fae5"
              opacity={0.3}
            />

            {dailies.map((d, i) => {
              const x = i * (barWidth + 3) + 2;
              if (d.totalNightDurationMinutes === 0) {
                const dateLabel = formatDateLabel(d.date);
                const dayLabel = getDayOfWeek(d.date);
                return (
                  <g key={d.date}>
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 12}
                      textAnchor="middle"
                      className="fill-gray-300 text-[9px]"
                    >
                      {dateLabel}
                    </text>
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 24}
                      textAnchor="middle"
                      className="fill-gray-200 text-[8px]"
                    >
                      {dayLabel}
                    </text>
                  </g>
                );
              }
              const dur = d.totalNightDurationMinutes;
              const h = (dur / (maxDur + 60)) * chartHeight;
              const y = chartHeight - h;
              const hours = Math.floor(dur / 60);
              const mins = dur % 60;
              const isLow = dur < idealMin;
              const color = isLow ? '#f87171' : '#818cf8';
              const dateLabel = formatDateLabel(d.date);
              const dayLabel = getDayOfWeek(d.date);

              return (
                <g key={d.date}>
                  <rect x={x} y={y} width={barWidth} height={h} rx={2} fill={color} opacity={0.8} />
                  <text
                    x={x + barWidth / 2}
                    y={y - 3}
                    textAnchor="middle"
                    className="fill-gray-500 text-[8px]"
                  >
                    {hours}h{mins > 0 ? mins : ''}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 12}
                    textAnchor="middle"
                    className="fill-gray-500 text-[9px]"
                  >
                    {dateLabel}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 24}
                    textAnchor="middle"
                    className="fill-gray-400 text-[8px]"
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

interface TrendTooltip {
  x: number;
  y: number;
  daily: DailySleep;
  type: 'bed' | 'wake';
}

function TimesTrendChart({
  dailies,
  allowScroll,
}: {
  dailies: DailySleep[];
  allowScroll: boolean;
}) {
  const { ref, w: cw } = useContainerWidth();
  const valid = dailies.filter((d) => d.nightSegments.length > 0);
  const [tooltip, setTooltip] = useState<TrendTooltip | null>(null);
  useScrollToEnd(ref, cw, [valid.length], allowScroll);

  // 외부 탭 시 툴팁 닫기 (모바일)
  useEffect(() => {
    if (!tooltip) return;
    const handler = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [tooltip, ref]);

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
    let mins = (h ?? 0) * 60 + (m ?? 0) - yStart;
    if (mins < 0) mins += 1440;
    return mins / yRange;
  }

  const bedPoints = valid.map((d, i) => ({
    x: padding.left + (i / Math.max(1, valid.length - 1)) * innerW,
    y: padding.top + timeToNorm(d.nightSegments[0]!.bedtime!) * innerH,
  }));
  const wakePoints = valid.map((d, i) => ({
    x: padding.left + (i / Math.max(1, valid.length - 1)) * innerW,
    y: d.effectiveWakeTime ? padding.top + timeToNorm(d.effectiveWakeTime) * innerH : null,
  }));

  const bedPath = bedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const wakePath = wakePoints
    .filter((p): p is { x: number; y: number } => p.y !== null)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');

  const yLabels = ['20', '0', '4', '8', '12'];
  const yLabelNorms = [0, 240 / 960, 480 / 960, 720 / 960, 1];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">취침 · 기상 시간 추이</h3>
      <div ref={ref} className={`relative ${allowScroll ? 'overflow-x-auto' : ''}`}>
        {cw > 0 && (
          <svg width={chartWidth} height={chartHeight + 12} className="text-xs">
            {yLabels.map((label, i) => {
              const y = padding.top + (yLabelNorms[i] ?? 0) * innerH;
              return (
                <g key={label}>
                  <text
                    x={padding.left - 4}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-gray-400 text-[10px]"
                  >
                    {label}시
                  </text>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={chartWidth - padding.right}
                    y2={y}
                    stroke="#f3f4f6"
                  />
                </g>
              );
            })}
            <path d={bedPath} fill="none" stroke="#818cf8" strokeWidth={1.5} />
            {bedPoints.map((p, i) => (
              <g key={`b${i}`}>
                <circle cx={p.x} cy={p.y} r={2.5} fill="#818cf8" className="pointer-events-none" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={12}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'touch') return;
                    setTooltip({ x: p.x, y: p.y, daily: valid[i], type: 'bed' });
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'touch') return;
                    setTooltip(null);
                  }}
                  onClick={() => {
                    setTooltip((prev) =>
                      prev?.daily.date === valid[i].date && prev.type === 'bed'
                        ? null
                        : { x: p.x, y: p.y, daily: valid[i], type: 'bed' },
                    );
                  }}
                />
              </g>
            ))}
            <path d={wakePath} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
            {wakePoints.map((p, i) => {
              if (p.y === null) return null;
              return (
                <g key={`w${i}`}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={2.5}
                    fill="#f59e0b"
                    className="pointer-events-none"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={12}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'touch') return;
                      setTooltip({ x: p.x, y: p.y!, daily: valid[i], type: 'wake' });
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === 'touch') return;
                      setTooltip(null);
                    }}
                    onClick={() => {
                      setTooltip((prev) =>
                        prev?.daily.date === valid[i].date && prev.type === 'wake'
                          ? null
                          : { x: p.x, y: p.y!, daily: valid[i], type: 'wake' },
                      );
                    }}
                  />
                </g>
              );
            })}
            {valid.map((d, i) => {
              const x = padding.left + (i / Math.max(1, valid.length - 1)) * innerW;
              const step = Math.max(1, Math.floor(valid.length / 7));
              if (i % step !== 0 && i !== valid.length - 1) return null;
              const dateLabel = formatDateLabel(d.date);
              const dayLabel = getDayOfWeek(d.date);
              return (
                <g key={d.date}>
                  <text
                    x={x}
                    y={chartHeight - padding.bottom + 14}
                    textAnchor="middle"
                    className="fill-gray-500 text-[9px]"
                  >
                    {dateLabel}
                  </text>
                  <text
                    x={x}
                    y={chartHeight - padding.bottom + 26}
                    textAnchor="middle"
                    className="fill-gray-400 text-[8px]"
                  >
                    {dayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {tooltip &&
          (() => {
            const d = tooltip.daily;
            const hasMorning = d.morningSleeps.length > 0;
            const alignRight = tooltip.x > chartWidth - 100;
            const alignLeft = tooltip.x < 100;
            const translateX = alignRight ? '-100%' : alignLeft ? '0%' : '-50%';
            return (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
                style={{
                  left: tooltip.x,
                  top: tooltip.y - 8,
                  transform: `translate(${translateX}, -100%)`,
                }}
              >
                <p className="mb-0.5 font-semibold text-gray-700">{d.date}</p>
                <p
                  style={{ color: tooltip.type === 'bed' ? '#818cf8' : undefined }}
                  className={tooltip.type === 'bed' ? 'font-medium' : 'text-gray-500'}
                >
                  취침 {d.nightSegments[0]?.bedtime ?? '--:--'}
                </p>
                <p
                  style={{ color: tooltip.type === 'wake' ? '#f59e0b' : undefined }}
                  className={tooltip.type === 'wake' ? 'font-medium' : 'text-gray-500'}
                >
                  기상 {d.effectiveWakeTime ?? '--:--'}
                  {hasMorning && tooltip.type === 'wake' && (
                    <span className="ml-1 text-gray-400 font-normal">※아침잠 포함</span>
                  )}
                </p>
              </div>
            );
          })()}
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

export function SleepTrendChart({ dailies, period }: SleepTrendChartProps) {
  const allowScroll = period === '1m';
  return (
    <div className="space-y-4">
      <DurationChart dailies={dailies} allowScroll={allowScroll} />
      <TimesTrendChart dailies={dailies} allowScroll={allowScroll} />
    </div>
  );
}
