'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { compareByStatus, isMultiDaySchedule } from '@/lib/types';
import { ScheduleCard } from './schedule-card';
import { ActionMenu } from './action-menu';

interface DayViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
  onToggleImportant: (id: number) => void;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}

interface Section {
  title: string;
  items: ScheduleRow[];
}

export function DayView({
  currentDate,
  schedules,
  categories,
  onScheduleClick,
  onStatusChange,
  onToggleImportant,
  onPostpone,
  onMoveToBacklog,
  onDelete,
}: DayViewProps) {
  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const daySchedules = schedules.filter((s) => {
    if (s.date === dateStr) return true;
    if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
    return false;
  });

  const formatted = format(currentDate, 'yyyy년 M월 d일 (EEE)', { locale: ko });

  // 3단 섹션 분리: 기간 일정 → 중요 → 카테고리별
  const sections = buildDaySections(daySchedules, categories);

  const totalTasks = daySchedules.filter((s) => s.category !== '약속').length;
  const doneTasks = daySchedules.filter(
    (s) => s.category !== '약속' && s.status === 'done',
  ).length;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:flex-1">
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
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.items.map((s) => (
                  <ScheduleCard
                    key={s.id}
                    schedule={s}
                    categories={categories}
                    onStatusChange={onStatusChange}
                    onClick={onScheduleClick}
                    action={
                      <ActionMenu
                        scheduleId={s.id}
                        important={s.important}
                        onToggleImportant={onToggleImportant}
                        onPostpone={onPostpone}
                        onMoveToBacklog={onMoveToBacklog}
                        onDelete={onDelete}
                      />
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 일정을 기간 → 중요 → 카테고리별 섹션으로 분리 */
function buildDaySections(schedules: ScheduleRow[], categories: CategoryRow[]): Section[] {
  const byCatThenStatus = (a: ScheduleRow, b: ScheduleRow) => {
    const catA = categories.find((c) => c.name === a.category);
    const catB = categories.find((c) => c.name === b.category);
    const orderA = a.category ? (catA?.sort_order ?? 999) : 9999;
    const orderB = b.category ? (catB?.sort_order ?? 999) : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return compareByStatus(a, b);
  };

  // 1. 기간 일정
  const multiDay = schedules.filter(isMultiDaySchedule).sort(byCatThenStatus);

  // 2. 중요 단일 일정 (기간 제외)
  const importantSingle = schedules
    .filter((s) => !isMultiDaySchedule(s) && s.important)
    .sort(byCatThenStatus);

  // 3. 나머지 → 카테고리별 그룹
  const regular = schedules
    .filter((s) => !isMultiDaySchedule(s) && !s.important)
    .sort(compareByStatus);

  const grouped = new Map<string, ScheduleRow[]>();
  for (const s of regular) {
    const cat = s.category ?? '미분류';
    const list = grouped.get(cat) ?? [];
    list.push(s);
    grouped.set(cat, list);
  }

  const sortedCats = [...grouped.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    const catA = categories.find((c) => c.name === a);
    const catB = categories.find((c) => c.name === b);
    return (catA?.sort_order ?? 999) - (catB?.sort_order ?? 999);
  });

  const sections: Section[] = [];
  if (multiDay.length > 0) sections.push({ title: '기간 일정', items: multiDay });
  if (importantSingle.length > 0) sections.push({ title: '중요', items: importantSingle });
  for (const cat of sortedCats) {
    sections.push({ title: cat, items: grouped.get(cat) ?? [] });
  }

  return sections;
}
