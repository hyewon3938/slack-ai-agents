'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import {
  compareByStatus,
  isMultiDaySchedule,
  lookupCategory,
  getScheduleType,
  getScheduleTopCategoryName,
} from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';
import { getDayPillar } from '@/lib/saju';
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
  const dayPillar = getDayPillar(dateStr);

  // 3단 섹션 분리: 기간 일정 → 중요 → 카테고리별
  const sections = buildDaySections(daySchedules, categories);

  const isTask = (s: ScheduleRow) => getScheduleType(s, categories) !== 'event';
  const totalTasks = daySchedules.filter(isTask).length;
  const doneTasks = daySchedules.filter((s) => isTask(s) && s.status === 'done').length;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 pb-24 md:flex-1 md:pb-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-gray-800">{formatted}</h2>
          <span className="flex items-baseline gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-blue-600">
            <span className="text-base font-semibold">{dayPillar.hanja}</span>
            <span className="text-xs">{dayPillar.hangul}</span>
          </span>
        </div>
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

/** 일정을 이벤트 → 기간 → 중요 → 카테고리별 섹션으로 분리 */
function buildDaySections(schedules: ScheduleRow[], categories: CategoryRow[]): Section[] {
  const isEvent = (s: ScheduleRow) => getScheduleType(s, categories) === 'event';

  const byCatThenStatus = (a: ScheduleRow, b: ScheduleRow) => {
    const orderA = lookupCategory(categories, a.category_id).sortOrder ?? 9999;
    const orderB = lookupCategory(categories, b.category_id).sortOrder ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    return compareByStatus(a, b);
  };

  // 0. 이벤트 (일정/이동 등)
  const events = schedules.filter(isEvent).sort(byCatThenStatus);

  // 1. 기간 일정 (이벤트 제외)
  const multiDay = schedules
    .filter((s) => !isEvent(s) && isMultiDaySchedule(s))
    .sort(byCatThenStatus);

  // 2. 중요 단일 일정 (기간·이벤트 제외)
  const importantSingle = schedules
    .filter((s) => !isEvent(s) && !isMultiDaySchedule(s) && s.important)
    .sort(byCatThenStatus);

  // 3. 나머지 → 최상위 카테고리별 그룹
  const regular = schedules
    .filter((s) => !isEvent(s) && !isMultiDaySchedule(s) && !s.important)
    .sort(compareByStatus);

  const grouped = new Map<string, ScheduleRow[]>();
  for (const s of regular) {
    const top = getScheduleTopCategoryName(s, categories) ?? '미분류';
    const list = grouped.get(top) ?? [];
    list.push(s);
    grouped.set(top, list);
  }

  const sortedCats = [...grouped.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    const catA = categories.find((c) => c.name === a && c.parent_id === null);
    const catB = categories.find((c) => c.name === b && c.parent_id === null);
    return (catA?.sort_order ?? 999) - (catB?.sort_order ?? 999);
  });

  const sections: Section[] = [];
  if (events.length > 0) sections.push({ title: '일정', items: events });
  if (multiDay.length > 0) sections.push({ title: '기간 일정', items: multiDay });
  if (importantSingle.length > 0) sections.push({ title: '중요', items: importantSingle });
  for (const cat of sortedCats) {
    sections.push({ title: cat, items: grouped.get(cat) ?? [] });
  }

  return sections;
}
