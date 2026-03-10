'use client';

import { startOfWeek, addDays, format, isToday, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from '../schedule/schedule-card';

interface WeekViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
}

export function WeekView({
  currentDate,
  schedules,
  categories,
  selectedDate,
  onSelectDate,
  onScheduleClick,
  onStatusChange,
}: WeekViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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
      {/* 데스크탑: 가로 7열 */}
      <div className="hidden md:grid md:grid-cols-7">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySchedules = getSchedulesForDate(day);
          const today = isToday(day);
          const selected = selectedDate === dateStr;
          const dayOfWeek = day.getDay();

          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`min-h-[300px] cursor-pointer border-r border-gray-100 p-2 ${
                selected ? 'bg-blue-50/50' : 'bg-white hover:bg-gray-50/50'
              }`}
            >
              <div className="mb-2 text-center">
                <div
                  className={`text-xs ${
                    dayOfWeek === 0 ? 'text-red-400' : dayOfWeek === 6 ? 'text-blue-400' : 'text-gray-500'
                  }`}
                >
                  {format(day, 'EEE', { locale: ko })}
                </div>
                <div
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    today ? 'bg-blue-500 text-white' : 'text-gray-700'
                  }`}
                >
                  {format(day, 'd')}
                </div>
              </div>

              <div className="space-y-1.5">
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
            </div>
          );
        })}
      </div>

      {/* 모바일: 세로 리스트 */}
      <div className="md:hidden">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySchedules = getSchedulesForDate(day);
          const today = isToday(day);
          const selected = selectedDate === dateStr;
          const dayOfWeek = day.getDay();

          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`border-b border-gray-100 ${selected ? 'bg-blue-50/30' : ''}`}
            >
              {/* 날짜 헤더 */}
              <div className="flex items-center gap-3 px-4 py-2">
                <div
                  className={`flex h-10 w-10 flex-col items-center justify-center rounded-full ${
                    today ? 'bg-blue-500 text-white' : 'bg-gray-100'
                  }`}
                >
                  <span className="text-[10px] leading-none">
                    {format(day, 'EEE', { locale: ko })}
                  </span>
                  <span className="text-sm font-bold leading-none">{format(day, 'd')}</span>
                </div>
                <span
                  className={`text-sm font-medium ${
                    today
                      ? 'text-blue-600'
                      : dayOfWeek === 0
                        ? 'text-red-500'
                        : dayOfWeek === 6
                          ? 'text-blue-500'
                          : 'text-gray-700'
                  }`}
                >
                  {format(day, 'M월 d일', { locale: ko })}
                </span>
                <span className="text-xs text-gray-400">{daySchedules.length}건</span>
              </div>

              {/* 일정 목록 */}
              {daySchedules.length > 0 && (
                <div className="space-y-1.5 px-4 pb-3 pl-[68px]">
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
        })}
      </div>
    </div>
  );
}
