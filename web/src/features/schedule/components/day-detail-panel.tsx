'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import { compareSchedulePriority } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';
import { ScheduleCard } from './schedule-card';

interface DayDetailPanelProps {
  dateStr: string;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
  onClose: () => void;
}

// 날짜 클릭 시 보여줄 일간 상세 패널
export function DayDetailPanel({
  dateStr,
  schedules,
  categories,
  onScheduleClick,
  onStatusChange,
  onClose,
}: DayDetailPanelProps) {
  const date = new Date(dateStr + 'T12:00:00+09:00');
  const formatted = format(date, 'M월 d일 (EEE)', { locale: ko });
  const daySchedules = schedules
    .filter((s) => {
      if (s.date === dateStr) return true;
      if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
      return false;
    })
    .sort((a, b) => compareSchedulePriority(a, b, categories));

  return (
    <div className="min-h-full border-t border-b border-gray-200 bg-white p-4 md:border-l">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{formatted}</h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {daySchedules.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">일정 없음</p>
      ) : (
        <div className="space-y-2">
          {daySchedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              categories={categories}
              onStatusChange={onStatusChange}
              onClick={onScheduleClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
