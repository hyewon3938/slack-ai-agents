'use client';

import { startOfWeek, addDays, format, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';
import { computeWeekLayout, type WeekSpan } from '@/lib/calendar-utils';
import { ScheduleCard } from '../schedule/schedule-card';
import { DroppableDay } from './droppable-day';
import { DraggableCard } from './draggable-card';

interface WeekViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
}

const LANE_HEIGHT = 24;
const DATE_ROW_HEIGHT = 56;

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
  const layout = computeWeekLayout(days, schedules);
  const spanAreaHeight = layout.laneCount * LANE_HEIGHT;

  return (
    <div className="flex flex-col">
      {/* 데스크탑: 가로 7열 + 스패닝 바 */}
      <div className="relative hidden md:grid md:grid-cols-7">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySingles = layout.singleDay.get(dateStr) ?? [];
          const today = isToday(day);
          const selected = selectedDate === dateStr;
          const dayOfWeek = day.getDay();

          return (
            <DroppableDay
              key={dateStr}
              dateStr={dateStr}
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

              {/* 스패닝 바 공간 확보 */}
              {spanAreaHeight > 0 && <div style={{ height: `${spanAreaHeight}px` }} />}

              {/* 단일 일정 */}
              <div className="space-y-1.5">
                {daySingles.map((s) => (
                  <DraggableCard
                    key={s.id}
                    schedule={s}
                    categories={categories}
                    onStatusChange={onStatusChange}
                    onClick={onScheduleClick}
                  />
                ))}
              </div>
            </DroppableDay>
          );
        })}

        {/* 스패닝 바 */}
        {layout.spans.map((span) => (
          <WeekSpanBar
            key={`span-${span.schedule.id}`}
            span={span}
            categories={categories}
            dateRowHeight={DATE_ROW_HEIGHT}
            laneHeight={LANE_HEIGHT}
            onClick={() => onScheduleClick(span.schedule)}
          />
        ))}
      </div>

      {/* 모바일: 세로 리스트 (스패닝 없이 기존 방식) */}
      <div className="md:hidden">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySchedules = getMobileSchedules(day, schedules);
          const today = isToday(day);
          const selected = selectedDate === dateStr;

          return (
            <DroppableDay
              key={dateStr}
              dateStr={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`border-b border-gray-100 ${selected ? 'bg-blue-50/30' : ''}`}
            >
              {/* 날짜 헤더 */}
              <div className="flex items-center gap-4 px-4 py-3">
                <div
                  className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full ${
                    today ? 'bg-blue-500 text-white' : 'bg-gray-100'
                  }`}
                >
                  <span className="text-[10px] font-medium leading-none">
                    {format(day, 'EEE', { locale: ko })}
                  </span>
                  <span className="text-base font-bold leading-tight">{format(day, 'd')}</span>
                </div>
                {daySchedules.length > 0 && (
                  <span className="text-xs text-gray-400">{daySchedules.length}건</span>
                )}
              </div>

              {/* 일정 목록 */}
              {daySchedules.length > 0 && (
                <div className="space-y-1.5 px-4 pb-3 pl-[76px]">
                  {daySchedules.map((s) => (
                    <DraggableCard
                      key={s.id}
                      schedule={s}
                      categories={categories}
                      onStatusChange={onStatusChange}
                      onClick={onScheduleClick}
                    />
                  ))}
                </div>
              )}
            </DroppableDay>
          );
        })}
      </div>
    </div>
  );
}

/** 모바일용: 해당 날짜의 모든 일정 (다일 포함) */
function getMobileSchedules(date: Date, schedules: ScheduleRow[]): ScheduleRow[] {
  const dateStr = format(date, 'yyyy-MM-dd');
  return schedules.filter((s) => {
    if (s.date === dateStr) return true;
    if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
    return false;
  });
}

function WeekSpanBar({
  span,
  categories,
  dateRowHeight,
  laneHeight,
  onClick,
}: {
  span: WeekSpan;
  categories: CategoryRow[];
  dateRowHeight: number;
  laneHeight: number;
  onClick: () => void;
}) {
  const cat = categories.find((c) => c.name === span.schedule.category);
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const isDone = span.schedule.status === 'done' || span.schedule.status === 'cancelled';

  const barStyle: React.CSSProperties = {
    position: 'absolute',
    left: `calc(${(span.startCol / 7) * 100}% + 4px)`,
    width: `calc(${((span.endCol - span.startCol + 1) / 7) * 100}% - 8px)`,
    top: `${dateRowHeight + span.lane * laneHeight}px`,
    height: `${laneHeight - 2}px`,
    zIndex: 10,
  };

  const textClasses = `h-full truncate rounded px-2 text-xs leading-[22px] font-medium ${isDone ? 'line-through opacity-60' : ''}`;

  if (catStyle.isPreset && catStyle.classes) {
    return (
      <div style={barStyle} onClick={onClick} className="pointer-events-auto cursor-pointer">
        <div className={`${textClasses} ${catStyle.classes.bg} ${catStyle.classes.text}`}>
          {span.schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
          {span.schedule.title}
        </div>
      </div>
    );
  }

  return (
    <div style={barStyle} onClick={onClick} className="pointer-events-auto cursor-pointer">
      <div
        className={textClasses}
        style={{ backgroundColor: catStyle.styles?.bg, color: catStyle.styles?.text }}
      >
        {span.schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
        {span.schedule.title}
      </div>
    </div>
  );
}
