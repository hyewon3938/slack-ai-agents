'use client';

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  isSameDay,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from '../schedule/schedule-card';

interface MonthViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_VISIBLE = 3;

export function MonthView({
  currentDate,
  schedules,
  categories,
  selectedDate,
  onSelectDate,
  onScheduleClick,
  onStatusChange,
}: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const getSchedulesForDate = (date: Date): ScheduleRow[] => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return schedules.filter((s) => {
      if (s.date === dateStr) return true;
      if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
      return false;
    });
  };

  return (
    <div className="flex flex-col">
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {DAY_NAMES.map((name, i) => (
          <div
            key={name}
            className={`py-2 text-center text-xs font-medium ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid flex-1 grid-cols-7">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySchedules = getSchedulesForDate(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          const selected = selectedDate === dateStr;
          const dayOfWeek = day.getDay();

          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`min-h-[80px] cursor-pointer border-b border-r border-gray-100 p-1 transition md:min-h-[100px] ${
                !isCurrentMonth ? 'bg-gray-50/50' : 'bg-white hover:bg-blue-50/30'
              } ${selected ? 'ring-2 ring-inset ring-blue-400' : ''}`}
            >
              <div
                className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  today
                    ? 'bg-blue-500 text-white'
                    : !isCurrentMonth
                      ? 'text-gray-300'
                      : dayOfWeek === 0
                        ? 'text-red-500'
                        : dayOfWeek === 6
                          ? 'text-blue-500'
                          : 'text-gray-700'
                }`}
              >
                {format(day, 'd')}
              </div>

              <div className="space-y-0.5">
                {daySchedules.slice(0, MAX_VISIBLE).map((s) => (
                  <ScheduleCard
                    key={s.id}
                    schedule={s}
                    categories={categories}
                    onStatusChange={onStatusChange}
                    onClick={onScheduleClick}
                    compact
                  />
                ))}
                {daySchedules.length > MAX_VISIBLE && (
                  <div className="px-1 text-xs text-gray-400">
                    +{daySchedules.length - MAX_VISIBLE}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 날짜 클릭 시 보여줄 일간 상세 패널
export function DayDetailPanel({
  dateStr,
  schedules,
  categories,
  onScheduleClick,
  onStatusChange,
  onClose,
}: {
  dateStr: string;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
  onClose: () => void;
}) {
  const date = new Date(dateStr + 'T12:00:00+09:00');
  const formatted = format(date, 'M월 d일 (EEE)', { locale: ko });
  const daySchedules = schedules.filter((s) => {
    if (s.date === dateStr) return true;
    if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
    return false;
  });

  return (
    <div className="border-t border-gray-200 bg-white p-4 md:border-t-0 md:border-l">
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
