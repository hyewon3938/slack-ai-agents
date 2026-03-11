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
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { useDraggable } from '@dnd-kit/core';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { getCategoryStyle, compareByStatus } from '@/lib/types';
import { computeWeekLayout, WEEK_START, type WeekSpan } from '@/features/schedule/lib/calendar-utils';
import { ScheduleCard } from './schedule-card';
import { DroppableDay } from './droppable-day';
import { DraggableCard } from './draggable-card';

interface MonthViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
}

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
const MAX_VISIBLE = 3;
const LANE_HEIGHT = 22;
const DATE_ROW_HEIGHT = 34;

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
  const calStart = startOfWeek(monthStart, { weekStartsOn: WEEK_START });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: WEEK_START });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // 주 단위로 분할
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col md:flex-1">
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {DAY_NAMES.map((name, i) => (
          <div
            key={name}
            className={`py-2 text-center text-xs font-medium ${
              i === 6 ? 'text-red-400' : i === 5 ? 'text-blue-400' : 'text-gray-500'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* 주 단위 렌더링 */}
      {weeks.map((weekDays, weekIdx) => {
        const layout = computeWeekLayout(weekDays, schedules);
        const spanAreaHeight = layout.laneCount * LANE_HEIGHT;

        return (
          <div key={weekIdx} className="relative grid grid-cols-7">
            {/* 날짜 셀 */}
            {weekDays.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const daySingles = layout.singleDay.get(dateStr) ?? [];
              const isCurrentMonth = isSameMonth(day, currentDate);
              const today = isToday(day);
              const selected = selectedDate === dateStr;
              const dayOfWeek = day.getDay();

              return (
                <DroppableDay
                  key={dateStr}
                  dateStr={dateStr}
                  onClick={() => onSelectDate(dateStr)}
                  className={`min-h-[80px] cursor-pointer border-b border-r border-gray-100 p-1 transition md:min-h-[100px] ${
                    !isCurrentMonth ? 'bg-gray-50/50' : 'bg-white hover:bg-blue-50/30'
                  } ${selected ? 'ring-2 ring-inset ring-blue-400' : ''}`}
                >
                  <div
                    className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
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

                  {/* 스패닝 바 공간 확보 */}
                  {spanAreaHeight > 0 && <div style={{ height: `${spanAreaHeight}px` }} />}

                  {/* 단일 일정 */}
                  <div className="space-y-0.5">
                    {daySingles.slice(0, MAX_VISIBLE).map((s) => (
                      <DraggableCard
                        key={s.id}
                        schedule={s}
                        categories={categories}
                        onStatusChange={onStatusChange}
                        onClick={onScheduleClick}
                        compact
                      />
                    ))}
                    {daySingles.length > MAX_VISIBLE && (
                      <div className="px-1 text-xs text-gray-400">
                        +{daySingles.length - MAX_VISIBLE}
                      </div>
                    )}
                  </div>
                </DroppableDay>
              );
            })}

            {/* 스패닝 바 (절대 위치) */}
            {layout.spans.map((span) => (
              <SpanningBar
                key={`span-${span.schedule.id}-${weekIdx}`}
                span={span}
                categories={categories}
                dateRowHeight={DATE_ROW_HEIGHT}
                laneHeight={LANE_HEIGHT}
                weekIdx={weekIdx}
                onClick={() => onScheduleClick(span.schedule)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SpanningBar({
  span,
  categories,
  dateRowHeight,
  laneHeight,
  weekIdx,
  onClick,
}: {
  span: WeekSpan;
  categories: CategoryRow[];
  dateRowHeight: number;
  laneHeight: number;
  weekIdx: number;
  onClick: () => void;
}) {
  const suffix = `-m${weekIdx}`;
  const {
    setNodeRef: moveRef,
    listeners: moveListeners,
    attributes: moveAttrs,
    isDragging,
  } = useDraggable({ id: `move-${span.schedule.id}${suffix}` });
  const {
    setNodeRef: resizeLRef,
    listeners: resizeLListeners,
    attributes: resizeLAttrs,
  } = useDraggable({ id: `resize-${span.schedule.id}${suffix}` });
  const {
    setNodeRef: resizeRRef,
    listeners: resizeRListeners,
    attributes: resizeRAttrs,
  } = useDraggable({ id: `resize-r-${span.schedule.id}${suffix}` });

  const showLeftHandle = !span.startsBeforeWeek;
  const showRightHandle = !span.endsAfterWeek;

  const cat = categories.find((c) => c.name === span.schedule.category);
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const isDone = span.schedule.status === 'done' || span.schedule.status === 'cancelled';

  const barStyle: React.CSSProperties = {
    position: 'absolute',
    left: `calc(${(span.startCol / 7) * 100}% + 2px)`,
    width: `calc(${((span.endCol - span.startCol + 1) / 7) * 100}% - 4px)`,
    top: `${dateRowHeight + span.lane * laneHeight}px`,
    height: `${laneHeight - 2}px`,
    zIndex: 10,
  };

  const textClasses = `h-full truncate rounded px-1.5 text-xs leading-5 ${isDone ? 'line-through opacity-60' : ''}`;

  const inner = catStyle.isPreset && catStyle.classes ? (
    <div
      ref={moveRef}
      {...moveListeners}
      {...moveAttrs}
      className={`${textClasses} ${catStyle.classes.bg} ${catStyle.classes.text}`}
    >
      {span.schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
      {span.schedule.title}
    </div>
  ) : (
    <div
      ref={moveRef}
      {...moveListeners}
      {...moveAttrs}
      className={textClasses}
      style={{ backgroundColor: catStyle.styles?.bg, color: catStyle.styles?.text }}
    >
      {span.schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
      {span.schedule.title}
    </div>
  );

  return (
    <div
      style={barStyle}
      onClick={onClick}
      className={`group pointer-events-auto cursor-pointer ${isDragging ? 'opacity-30' : ''}`}
    >
      {showLeftHandle && (
        <div
          ref={resizeLRef}
          {...resizeLListeners}
          {...resizeLAttrs}
          className="absolute top-0 left-0 z-20 h-full w-2 cursor-col-resize opacity-0 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
        </div>
      )}
      {inner}
      {showRightHandle && (
        <div
          ref={resizeRRef}
          {...resizeRListeners}
          {...resizeRAttrs}
          className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize opacity-0 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
        </div>
      )}
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
  const daySchedules = schedules
    .filter((s) => {
      if (s.date === dateStr) return true;
      if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
      return false;
    })
    .sort(compareByStatus);

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
