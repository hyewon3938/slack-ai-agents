'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { RoutineHeatmapData } from '@/features/routine/lib/types';
import { getTodayISO } from '@/lib/kst';

interface RoutineHeatmapProps {
  templateId: number;
  templateName: string;
}

const DAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'];

type DayStatus = 'completed' | 'missed' | 'inactive' | 'future' | 'before';

export function RoutineHeatmap({ templateId, templateName }: RoutineHeatmapProps) {
  const today = getTodayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)));
  const [data, setData] = useState<RoutineHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/routines/${templateId}/heatmap?year=${y}&month=${m}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const { data: d } = (await res.json()) as { data: RoutineHeatmapData };
        setData(d);
      }
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    fetchData(year, month);
  }, [fetchData, year, month]);

  const handlePrev = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const handleNext = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // 날짜별 상태 맵 생성
  const dayStatusMap = useMemo((): Map<string, DayStatus> => {
    if (!data) return new Map();
    const map = new Map<string, DayStatus>();
    const recordMap = new Map(data.records.map((r) => [r.date, r.completed]));

    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      if (dateStr < data.startDate) { map.set(dateStr, 'before'); continue; }
      if (dateStr > today) { map.set(dateStr, 'future'); continue; }

      const isInactive = data.inactivePeriods.some(
        (ip) => dateStr >= ip.start_date && (ip.end_date === null || dateStr <= ip.end_date),
      );
      if (isInactive) { map.set(dateStr, 'inactive'); continue; }

      const completed = recordMap.get(dateStr);
      map.set(dateStr, completed === true ? 'completed' : 'missed');
    }
    return map;
  }, [data, year, month, today]);

  // 월간 통계 (비활성 제외)
  const monthStats = useMemo(() => {
    let total = 0;
    let completed = 0;
    for (const status of dayStatusMap.values()) {
      if (status === 'completed') { total++; completed++; }
      else if (status === 'missed') { total++; }
    }
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, rate };
  }, [dayStatusMap]);

  // 월별 달력 그리드
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

  function rateColor(rate: number): string {
    if (rate >= 70) return '#16a34a';
    if (rate >= 30) return '#d97706';
    return '#dc2626';
  }

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">{templateName} 히트맵</span>
        <div className="flex items-center gap-2">
          <button onClick={handlePrev} className="text-xs text-gray-400 hover:text-gray-600">◀</button>
          <span className="text-xs font-medium text-gray-600">{year}년 {month}월</span>
          <button onClick={handleNext} className="text-xs text-gray-400 hover:text-gray-600">▶</button>
        </div>
      </div>

      {/* 월간 통계 */}
      {!loading && data && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">{monthStats.completed}/{monthStats.total}일 완료</span>
          <span className="font-semibold" style={{ color: rateColor(monthStats.rate) }}>
            {monthStats.rate}%
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-400" />
        </div>
      ) : (
        <>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 gap-1">
            {DAY_HEADERS.map((d, i) => (
              <div
                key={d}
                className={`text-center text-[10px] font-medium ${
                  i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 달력 그리드 */}
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((day, di) => {
                  if (day === null) return <div key={di} className="flex h-7 items-center justify-center" />;
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const status = dayStatusMap.get(dateStr);
                  return (
                    <div key={di} className="flex flex-col items-center gap-0.5">
                      <DayCircle status={status} />
                      <span className="text-[9px] text-gray-300">{day}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" /> 완료
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-red-300" /> 미완료
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-200" /> 비활성
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function DayCircle({ status }: { status?: DayStatus }) {
  switch (status) {
    case 'completed':
      return <div className="h-5 w-5 rounded-full bg-green-500" />;
    case 'missed':
      return <div className="h-5 w-5 rounded-full border-2 border-red-300" />;
    case 'inactive':
      return <div className="h-5 w-5 rounded-full bg-gray-200" />;
    default:
      return <div className="h-5 w-5" />;
  }
}
