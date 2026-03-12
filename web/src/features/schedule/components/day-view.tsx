'use client';

import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { compareByStatus } from '@/lib/types';
import { ScheduleCard } from './schedule-card';

interface DayViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}

function ActionMenu({
  scheduleId,
  onPostpone,
  onMoveToBacklog,
  onDelete,
}: {
  scheduleId: number;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onPostpone(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            내일로 미루기
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBacklog(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            백로그로 이동
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

export function DayView({
  currentDate,
  schedules,
  categories,
  onScheduleClick,
  onStatusChange,
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

  // 카테고리별 그룹핑 (그룹 내 상태순 정렬)
  const sorted = [...daySchedules].sort(compareByStatus);
  const grouped = new Map<string, ScheduleRow[]>();
  for (const s of sorted) {
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
          {sortedCategories.map((cat) => {
            const items = grouped.get(cat) ?? [];
            return (
              <div key={cat}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {cat}
                </h3>
                <div className="space-y-2">
                  {items.map((s) => (
                    <div key={s.id} className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <ScheduleCard
                          schedule={s}
                          categories={categories}
                          onStatusChange={onStatusChange}
                          onClick={onScheduleClick}
                        />
                      </div>
                      <ActionMenu
                        scheduleId={s.id}
                        onPostpone={onPostpone}
                        onMoveToBacklog={onMoveToBacklog}
                        onDelete={onDelete}
                      />
                    </div>
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
