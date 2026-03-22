'use client';

import { useRef, useEffect } from 'react';
import { startOfWeek, addDays, format, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useDraggable } from '@dnd-kit/core';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { getCategoryStyle, compareSchedulePriority } from '@/lib/types';
import { computeWeekLayout, WEEK_START, type WeekSpan } from '@/features/schedule/lib/calendar-utils';
import { StatusBadge } from './status-badge';
import { DroppableDay } from './droppable-day';
import { DraggableCard } from './draggable-card';
import { ActionMenu } from './action-menu';

interface WeekViewProps {
  currentDate: Date;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
  onStatusChange: (id: number, status: string) => void;
  onToggleImportant: (id: number) => void;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}

const LANE_HEIGHT = 76;
const DATE_ROW_HEIGHT = 72;

const NEXT_STATUS: Record<string, string> = {
  todo: 'in-progress',
  'in-progress': 'done',
  done: 'todo',
};

const STATUS_BG: Record<string, string> = {
  todo: 'bg-white',
  'in-progress': 'bg-blue-50',
  done: 'bg-green-50',
  cancelled: 'bg-gray-50',
};

export function WeekView({
  currentDate,
  schedules,
  categories,
  selectedDate,
  onSelectDate,
  onScheduleClick,
  onStatusChange,
  onToggleImportant,
  onPostpone,
  onMoveToBacklog,
  onDelete,
}: WeekViewProps) {
  const todayRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_START });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const layout = computeWeekLayout(days, schedules, categories);

  // 모바일: 오늘 날짜로 자동 스크롤 (뷰 진입, 오늘 버튼, 주 이동 시)
  useEffect(() => {
    const timer = setTimeout(() => {
      todayRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentDate]);

  return (
    <div className="flex flex-col md:flex-1">
      {/* 데스크탑: 가로 7열 + 스패닝 바 */}
      <div className="relative hidden bg-white md:grid md:flex-1 md:grid-cols-7">
        {days.map((day, colIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySingles = layout.singleDay.get(dateStr) ?? [];
          const today = isToday(day);
          const selected = selectedDate === dateStr;
          const dayOfWeek = day.getDay();
          const daySpanHeight = (layout.laneCountPerDay[colIndex] ?? 0) * LANE_HEIGHT;

          return (
            <DroppableDay
              key={dateStr}
              dateStr={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`min-h-[300px] cursor-pointer border-r border-gray-100 p-2 ${
                selected ? 'bg-blue-50/50' : 'bg-white hover:bg-gray-50/50'
              }`}
            >
              <div className="relative z-20 mb-3 text-center">
                <div
                  className={`text-xs ${
                    dayOfWeek === 0 ? 'text-red-400' : dayOfWeek === 6 ? 'text-blue-400' : 'text-gray-500'
                  }`}
                >
                  {format(day, 'EEE', { locale: ko })}
                </div>
                <div className="relative my-3 flex items-center justify-center">
                  {today && (
                    <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
                  )}
                  <span className={`relative text-sm font-medium ${today ? 'text-white' : 'text-gray-700'}`}>
                    {format(day, 'd')}
                  </span>
                </div>
              </div>

              {/* 스패닝 바 공간 확보 — 열별 실제 레인 수 기준 */}
              {daySpanHeight > 0 && <div className="mb-1.5" style={{ height: `${daySpanHeight}px` }} />}

              {/* 단일 일정 */}
              <div className="space-y-1.5">
                {daySingles.map((s) => (
                  <DraggableCard
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
            onStatusChange={onStatusChange}
            onClick={() => onScheduleClick(span.schedule)}
            onToggleImportant={onToggleImportant}
            onPostpone={onPostpone}
            onMoveToBacklog={onMoveToBacklog}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* 모바일: 세로 리스트 (DroppableDay 미사용 — 데스크탑과 ID 충돌 방지) */}
      <div className="pb-24 md:hidden md:pb-0">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySchedules = getMobileSchedules(day, schedules, categories);
          const today = isToday(day);
          const selected = selectedDate === dateStr;

          return (
            <div
              key={dateStr}
              ref={today ? todayRef : undefined}
              onClick={() => onSelectDate(dateStr)}
              className={`border-b border-gray-100 px-4 py-3 ${selected ? 'bg-blue-50/30' : ''}`}
            >
              <div className="flex items-start gap-3">
                {/* 날짜 + 건수 */}
                <div className="flex shrink-0 flex-col items-center">
                  <div
                    className={`flex h-12 w-12 flex-col items-center justify-center rounded-full ${
                      today ? 'bg-blue-500 text-white' : 'bg-gray-100'
                    }`}
                  >
                    <span className="text-[10px] font-medium leading-none">
                      {format(day, 'EEE', { locale: ko })}
                    </span>
                    <span className="text-base font-bold leading-tight">{format(day, 'd')}</span>
                  </div>
                  {daySchedules.length > 0 && (
                    <span className="mt-1 text-[10px] text-gray-400">{daySchedules.length}건</span>
                  )}
                </div>

                {/* 일정 카드 */}
                {daySchedules.length > 0 && (
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {daySchedules.map((s) => (
                      <DraggableCard
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
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 모바일용: 해당 날짜의 모든 일정 (다일 포함, 우선순위 정렬) */
function getMobileSchedules(date: Date, schedules: ScheduleRow[], categories: CategoryRow[]): ScheduleRow[] {
  const dateStr = format(date, 'yyyy-MM-dd');
  return schedules
    .filter((s) => {
      if (s.date === dateStr) return true;
      if (s.date && s.end_date && s.date <= dateStr && s.end_date >= dateStr) return true;
      return false;
    })
    .sort((a, b) => compareSchedulePriority(a, b, categories));
}

function WeekSpanBar({
  span,
  categories,
  dateRowHeight,
  laneHeight,
  onStatusChange,
  onClick,
  onToggleImportant,
  onPostpone,
  onMoveToBacklog,
  onDelete,
}: {
  span: WeekSpan;
  categories: CategoryRow[];
  dateRowHeight: number;
  laneHeight: number;
  onStatusChange: (id: number, status: string) => void;
  onClick: () => void;
  onToggleImportant: (id: number) => void;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const {
    setNodeRef: moveRef,
    listeners: moveListeners,
    attributes: moveAttrs,
    isDragging,
  } = useDraggable({ id: `move-${span.schedule.id}-wk` });
  const {
    setNodeRef: resizeLRef,
    listeners: resizeLListeners,
    attributes: resizeLAttrs,
  } = useDraggable({ id: `resize-${span.schedule.id}-wk` });
  const {
    setNodeRef: resizeRRef,
    listeners: resizeRListeners,
    attributes: resizeRAttrs,
  } = useDraggable({ id: `resize-r-${span.schedule.id}-wk` });

  const showLeftHandle = !span.startsBeforeWeek;
  const showRightHandle = !span.endsAfterWeek;

  const cat = categories.find((c) => c.name === span.schedule.category);
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const isEvent = cat?.type === 'event';
  const isDone = span.schedule.status === 'done' || span.schedule.status === 'cancelled';
  const isOverdue =
    !isEvent &&
    !isDone &&
    span.schedule.date &&
    new Date(span.schedule.date + 'T12:00:00+09:00') <
      new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00+09:00') &&
    span.schedule.status === 'todo';

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = NEXT_STATUS[span.schedule.status];
    if (next) onStatusChange(span.schedule.id, next);
  };

  const barStyle: React.CSSProperties = {
    position: 'absolute',
    left: `calc(${(span.startCol / 7) * 100}% + 4px)`,
    width: `calc(${((span.endCol - span.startCol + 1) / 7) * 100}% - 8px)`,
    top: `${dateRowHeight + span.lane * laneHeight}px`,
    height: `${laneHeight - 4}px`,
    zIndex: 10,
  };

  // ScheduleCard 풀 모드와 완전 동일한 구조
  return (
    <div
      style={barStyle}
      onClick={onClick}
      className={`group pointer-events-auto cursor-pointer ${isDragging ? 'opacity-30' : ''}`}
    >
      {/* 리사이즈 핸들 (좌) */}
      {showLeftHandle && (
        <div
          ref={resizeLRef}
          {...resizeLListeners}
          {...resizeLAttrs}
          className="absolute top-0 left-0 z-20 h-full w-3 cursor-col-resize opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-200" />
        </div>
      )}

      {/* 카드 본체 — ScheduleCard 풀 모드 */}
      <div
        ref={moveRef}
        {...moveListeners}
        {...moveAttrs}
        className={`h-full overflow-visible rounded-lg border p-3 transition hover:shadow-sm ${
          STATUS_BG[span.schedule.status] ?? 'bg-white'
        } ${isEvent ? 'border-l-[3px]' : isOverdue ? 'border-red-300' : 'border-gray-200'}`}
        style={isEvent ? { borderLeftColor: catStyle.border } : undefined}
      >
        <div className="flex items-start gap-2">
          {isEvent ? (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sm">📅</span>
          ) : (
            <button
              onClick={handleStatusClick}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs transition ${
                isDone
                  ? 'border-green-400 bg-green-100 text-green-600'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              {isDone && '✓'}
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`truncate text-sm font-medium ${isDone && !isEvent ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {span.schedule.important && <span className="mr-1 text-amber-500">★</span>}
                {span.schedule.title}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {!isEvent && <StatusBadge status={span.schedule.status} />}
              {span.schedule.category && (
                <CategoryBadge colorKey={colorKey} label={span.schedule.category} />
              )}
              {span.schedule.subcategory && span.endCol - span.startCol >= 2 && (() => {
                const sub = categories.find((c) => c.name === span.schedule.subcategory && c.parent_id !== null);
                const subColor = sub?.color ?? 'gray';
                return <CategoryBadge colorKey={subColor} label={span.schedule.subcategory} />;
              })()}
            </div>
          </div>

          <div className="shrink-0">
            <ActionMenu
              scheduleId={span.schedule.id}
              important={span.schedule.important}
              onToggleImportant={onToggleImportant}
              onPostpone={onPostpone}
              onMoveToBacklog={onMoveToBacklog}
              onDelete={onDelete}
            />
          </div>
        </div>
      </div>

      {/* 리사이즈 핸들 (우) */}
      {showRightHandle && (
        <div
          ref={resizeRRef}
          {...resizeRListeners}
          {...resizeRAttrs}
          className="absolute top-0 right-0 z-20 h-full w-3 cursor-col-resize opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-200" />
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ colorKey, label }: { colorKey: string; label: string }) {
  const style = getCategoryStyle(colorKey);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {label}
    </span>
  );
}
