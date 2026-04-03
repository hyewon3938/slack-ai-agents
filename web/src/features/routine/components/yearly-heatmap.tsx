'use client';

import { useMemo, useRef, useEffect } from 'react';
import type { RoutineDayStat } from '@/lib/types';
import { getTodayISO, addDays } from '@/lib/kst';

interface YearlyHeatmapProps {
  stats: RoutineDayStat[];
}

const DAY_LABELS = ['', '월', '', '수', '', '금', ''];
const LEGEND_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

function heatColor(rate: number | undefined): string {
  if (rate === undefined) return '#ebedf0';
  if (rate === 0) return '#ebedf0';
  if (rate < 25) return '#9be9a8';
  if (rate < 50) return '#40c463';
  if (rate < 75) return '#30a14e';
  return '#216e39';
}

/** GitHub 잔디 스타일 1년 히트맵 */
export function YearlyHeatmap({ stats }: YearlyHeatmapProps) {
  const today = getTodayISO();
  const scrollRef = useRef<HTMLDivElement>(null);

  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    stats.forEach((s) => m.set(s.date, s.rate));
    return m;
  }, [stats]);

  const { weeks, monthLabels, totalCompleted } = useMemo(() => {
    const startDate = addDays(today, -364);
    const startDow = new Date(startDate + 'T12:00:00+09:00').getUTCDay();
    const gridStart = addDays(startDate, -startDow);

    const cols: { date: string; rate: number | undefined }[][] = [];
    const months: { label: string; col: number }[] = [];
    let d = gridStart;
    let col: { date: string; rate: number | undefined }[] = [];
    let lastMonth = -1;
    let colIdx = 0;
    let total = 0;

    while (d <= today) {
      const rate = rateMap.get(d);
      col.push({ date: d, rate });
      if (rate !== undefined && rate > 0) total++;

      const m = Number(d.slice(5, 7));
      if (m !== lastMonth) {
        months.push({ label: `${m}월`, col: colIdx });
        lastMonth = m;
      }

      if (col.length === 7) { cols.push(col); col = []; colIdx++; }
      d = addDays(d, 1);
    }
    if (col.length > 0) cols.push(col);

    return { weeks: cols, monthLabels: months, totalCompleted: total };
  }, [today, rateMap]);

  // 모바일: 최신(오른쪽 끝)으로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2">
        <span className="text-xs font-medium text-gray-500">
          지난 1년간 {totalCompleted}일 달성
        </span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto md:overflow-visible">
        <div className="inline-flex flex-col md:w-full">
          {/* 월 라벨 */}
          <div className="mb-0.5 flex" style={{ paddingLeft: 28 }}>
            {monthLabels.map((m, i) => {
              const nextCol = monthLabels[i + 1]?.col ?? weeks.length;
              const span = nextCol - m.col;
              return (
                <div
                  key={`${m.label}-${m.col}`}
                  className="shrink-0 text-xs text-gray-400 md:shrink md:basis-0"
                  style={{ flexGrow: span }}
                >
                  {span >= 3 ? m.label : ''}
                </div>
              );
            })}
          </div>

          {/* 그리드 */}
          <div className="flex gap-[2px]">
            <div className="flex shrink-0 flex-col gap-[2px] pr-[2px]" style={{ width: 24 }}>
              {DAY_LABELS.map((label, i) => (
                <div key={i} className="flex h-[13px] items-center text-[10px] text-gray-400 md:h-auto md:aspect-square">
                  {label}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} className="flex shrink-0 flex-col gap-[2px] md:flex-1 md:shrink">
                {Array.from({ length: 7 }, (_, di) => {
                  const cell = week[di];
                  if (!cell || cell.date > today) {
                    return <div key={di} className="h-[13px] w-[13px] md:aspect-square md:h-auto md:w-auto" />;
                  }
                  return (
                    <div
                      key={di}
                      className="h-[13px] w-[13px] rounded-sm md:aspect-square md:h-auto md:w-auto"
                      style={{ backgroundColor: heatColor(cell.rate) }}
                      title={`${cell.date}: ${cell.rate !== undefined ? cell.rate + '%' : '기록 없음'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* 범례 */}
          <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-gray-400">
            <span>Less</span>
            {LEGEND_COLORS.map((c) => (
              <div key={c} className="h-[11px] w-[11px] rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
