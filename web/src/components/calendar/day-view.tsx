'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from '../schedule/schedule-card';

interface DayViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
}

export function DayView({
  currentDate,
  schedules,
  categories,
  onScheduleClick,
  onStatusChange,
}: DayViewProps) {
  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const daySchedules = schedules.filter((s) => {
    if (s.date === dateStr) return true;
    if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
    return false;
  });

  const formatted = format(currentDate, 'yyyy년 M월 d일 (EEE)', { locale: ko });

  // 카테고리별 그룹핑
  const grouped = new Map<string, ScheduleRow[]>();
  for (const s of daySchedules) {
    const cat = s.category ?? '미분류';
    const list = grouped.get(cat) ?? [];
    list.push(s);
    grouped.set(cat, list);
  }

  // 카테고리 정렬 (미분류 맨 끝)
  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    return a.localeCompare(b, 'ko');
  });

  const totalTasks = daySchedules.filter((s) => s.category !== '약속').length;
  const doneTasks = daySchedules.filter(
    (s) => s.category !== '약속' && s.status === 'done',
  ).length;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">{formatted}</h2>
        {totalTasks > 0 && (
          <span className="text-sm text-gray-500">
            {doneTasks}/{totalTasks} 완료
          </span>
        )}
      </div>

      {daySchedules.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400">일정 없음</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedCategories.map((cat) => {
            const items = grouped.get(cat) ?? [];
            return (
              <div key={cat}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {cat}
                </h3>
                <div className="space-y-2">
                  {items.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      categories={categories}
                      onStatusChange={onStatusChange}
                      onClick={onScheduleClick}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
