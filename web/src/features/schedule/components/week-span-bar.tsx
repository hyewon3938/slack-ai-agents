'use client';

import { useDraggable } from '@dnd-kit/core';
import { lookupCategory, NEXT_STATUS } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';
import { getTodayISO } from '@/lib/kst';
import type { WeekSpan } from '@/features/schedule/lib/calendar-utils';
import { StatusBadge } from './status-badge';
import { ActionMenu } from './action-menu';
import { CategoryBadge } from './category-badge';
import { STATUS_BG } from './status-bg';

export function WeekSpanBar({
  span,
  categories,
  dateRowHeight,
  laneTop,
  barHeight,
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
  laneTop: number;
  barHeight: number;
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

  const cat =
    span.schedule.category_id != null
      ? (categories.find((c) => c.id === span.schedule.category_id) ?? null)
      : null;
  const parentCat = cat?.parent_id != null ? categories.find((c) => c.id === cat.parent_id) : null;
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const lookup = lookupCategory(categories, span.schedule.category_id);
  const isEvent = lookup.type === 'event';
  const topName = lookup.topName;
  const isDone = span.schedule.status === 'done' || span.schedule.status === 'cancelled';
  const isOverdue =
    !isEvent &&
    !isDone &&
    span.schedule.date &&
    new Date(span.schedule.date + 'T12:00:00+09:00') <
      new Date(getTodayISO() + 'T12:00:00+09:00') &&
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
    top: `${dateRowHeight + laneTop}px`,
    height: `${barHeight - 4}px`,
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

      {/* 카드 본체 */}
      {isEvent ? (
        <div
          ref={moveRef}
          {...moveListeners}
          {...moveAttrs}
          className={`flex h-full items-center truncate rounded border-l-2 px-2 py-1 text-xs leading-tight ${isDone ? 'line-through opacity-60' : ''}`}
          style={{
            backgroundColor: catStyle.bg,
            color: catStyle.text,
            borderLeftColor: catStyle.border,
          }}
        >
          <span className="mr-0.5">📅</span>
          {span.schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
          {topName && <span className="mr-0.5 text-[10px] opacity-50">{topName}</span>}
          {span.schedule.title}
        </div>
      ) : (
        <div
          ref={moveRef}
          {...moveListeners}
          {...moveAttrs}
          className={`h-full overflow-visible rounded-lg border p-3 transition hover:shadow-sm ${
            STATUS_BG[span.schedule.status] ?? 'bg-white'
          } ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}
        >
          <div className="flex items-start gap-2">
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

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`truncate text-sm font-medium ${isDone ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                >
                  {span.schedule.important && <span className="mr-1 text-amber-500">★</span>}
                  {span.schedule.title}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={span.schedule.status} />
                {parentCat && <CategoryBadge colorKey={parentCat.color} label={parentCat.name} />}
                {cat && (cat.parent_id == null || span.endCol - span.startCol >= 2) && (
                  <CategoryBadge colorKey={cat.color} label={cat.name} />
                )}
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
      )}

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
