'use client';

import { useRef, useState, useEffect } from 'react';
import type { DailySleep, SleepPeriod } from '../lib/types';
import { formatDateLabel, getDayOfWeek } from '../lib/chart-utils';

interface SleepTimelineProps {
  dailies: DailySleep[];
  period: SleepPeriod;
}

// 20:00(=0) ~ 12:00(=960) 범위를 Y축으로 매핑
const Y_START_HOUR = 20;
const Y_RANGE_MINUTES = 16 * 60;

function timeToY(time: string): number {
  const [h, m] = time.split(':').map(Number);
  let minutesFromStart = ((h ?? 0) * 60 + (m ?? 0)) - (Y_START_HOUR * 60);
  if (minutesFromStart < 0) minutesFromStart += 1440;
  return minutesFromStart;
}

function yToRatio(y: number): number {
  return Math.max(0, Math.min(1, y / Y_RANGE_MINUTES));
}

const Y_LABELS = ['20', '22', '0', '2', '4', '6', '8', '10', '12'];
const Y_LABEL_MINUTES = [0, 120, 240, 360, 480, 600, 720, 840, 960];

interface Session {
  bedY: number;
  wakeY: number;
  kind: 'night' | 'morning';
}

interface Tooltip {
  x: number;
  y: number;
  daily: DailySleep;
}

function buildSessions(
  d: DailySleep,
  topPadding: number,
  chartHeight: number,
): Session[] {
  const sessions: Session[] = [];
  if (d.nightSleep?.bedtime && d.nightSleep?.wake_time) {
    sessions.push({
      bedY: topPadding + yToRatio(timeToY(d.nightSleep.bedtime)) * chartHeight,
      wakeY: topPadding + yToRatio(timeToY(d.nightSleep.wake_time)) * chartHeight,
      kind: 'night',
    });
  }
  for (const m of d.morningSleeps) {
    if (!m.bedtime || !m.wake_time) continue;
    sessions.push({
      bedY: topPadding + yToRatio(timeToY(m.bedtime)) * chartHeight,
      wakeY: topPadding + yToRatio(timeToY(m.wake_time)) * chartHeight,
      kind: 'morning',
    });
  }
  return sessions;
}

export function SleepTimeline({ dailies, period }: SleepTimelineProps) {
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

  const validDailies = dailies.filter(
    (d) => d.nightSleep?.bedtime || d.morningSleeps.length > 0,
  );

  if (validDailies.length === 0) {
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
  const minContentWidth = labelWidth + 8 + dailies.length * (minBarWidth + barGap);
  const chartWidth = allowScroll ? Math.max(cw, minContentWidth) : Math.max(cw, 300);
  const availableWidth = chartWidth - labelWidth - 8;
  const barWidth = Math.max(minBarWidth, availableWidth / dailies.length - barGap);
  const dateAreaHeight = 32;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
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

            {dailies.map((d, i) => {
              const x = labelWidth + i * (barWidth + barGap);
              const sessions = buildSessions(d, topPadding, chartHeight);
              const dateLabel = formatDateLabel(d.date);
              const dayLabel = getDayOfWeek(d.date);

              return (
                <g key={d.date}>
                  {/* 히트 영역 — 좁은 바도 hover/tap 쉽게 */}
                  <rect
                    x={x - 2} y={topPadding}
                    width={barWidth + 4} height={chartHeight}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      if (e.pointerType === 'touch') return;
                      setTooltip({ x: x + barWidth / 2, y: topPadding, daily: d });
                    }}
                    onMouseLeave={(e) => {
                      if (e.pointerType === 'touch') return;
                      setTooltip(null);
                    }}
                    onClick={() => {
                      setTooltip((prev) =>
                        prev?.daily.date === d.date ? null : { x: x + barWidth / 2, y: topPadding, daily: d },
                      );
                    }}
                  />
                  {/* 세션 블록들 (밤잠·아침잠 모두 인디고) */}
                  {sessions.map((s, si) => (
                    <rect
                      key={si}
                      x={x} y={s.bedY}
                      width={barWidth} height={Math.max(4, s.wakeY - s.bedY)}
                      rx={3} fill="#818cf8" opacity={0.8}
                      className="pointer-events-none"
                    />
                  ))}
                  {/* 밤잠 중간 기상 이벤트 */}
                  {d.nightSleep?.events.map((e) => {
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
          const d = tooltip.daily;
          const totalH = Math.floor(d.totalNightDurationMinutes / 60);
          const totalM = d.totalNightDurationMinutes % 60;
          const hasMorning = d.morningSleeps.length > 0;
          const alignRight = tooltip.x > chartWidth - 120;
          const alignLeft = tooltip.x < 120;
          const translateX = alignRight ? '-100%' : alignLeft ? '0%' : '-50%';
          return (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: tooltip.x, top: 0, transform: `translateX(${translateX})` }}
            >
              <p className="mb-1 font-semibold text-gray-700">{d.date}</p>
              {d.nightSleep?.bedtime && (
                <p className="text-gray-600">
                  밤잠 {d.nightSleep.bedtime} → {d.nightSleep.wake_time ?? '?'}
                </p>
              )}
              {d.morningSleeps.map((m, i) => (
                <p key={i} className="text-indigo-500">
                  아침잠 {m.bedtime} → {m.wake_time ?? '?'}
                </p>
              ))}
              {d.totalNightDurationMinutes > 0 && (
                <p className="text-gray-600">
                  총 {totalH}시간{totalM > 0 ? ` ${totalM}분` : ''}
                  {hasMorning ? ' (합산)' : ''}
                </p>
              )}
              {(d.nightSleep?.events.length ?? 0) > 0 && (
                <div className="mt-1 border-t border-gray-100 pt-1">
                  <p className="text-red-500">중간기상 {d.nightSleep!.events.length}회</p>
                  {d.nightSleep!.events.map((e) => (
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
