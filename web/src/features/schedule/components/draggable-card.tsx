'use client';

import { useDraggable } from '@dnd-kit/core';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from './schedule-card';

interface DraggableCardProps {
  schedule: ScheduleRow;
  categories: CategoryRow[];
  onStatusChange?: (id: number, status: string) => void;
  onClick?: (schedule: ScheduleRow) => void;
  compact?: boolean;
  action?: React.ReactNode;
}

export function DraggableCard({
  schedule,
  categories,
  onStatusChange,
  onClick,
  compact,
  action,
}: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `move-${schedule.id}`,
  });

  const {
    attributes: resizeLAttrs,
    listeners: resizeLListeners,
    setNodeRef: resizeLRef,
    isDragging: isResizingL,
  } = useDraggable({
    id: `resize-${schedule.id}`,
  });

  const {
    attributes: resizeRAttrs,
    listeners: resizeRListeners,
    setNodeRef: resizeRRef,
    isDragging: isResizingR,
  } = useDraggable({
    id: `resize-r-${schedule.id}`,
  });

  if (compact) {
    const faded = isDragging || isResizingL || isResizingR;
    return (
      <div className={`group relative ${faded ? 'opacity-30' : ''}`}>
        {/* 리사이즈 핸들 (좌측) */}
        <div
          ref={resizeLRef}
          {...resizeLListeners}
          {...resizeLAttrs}
          className="absolute top-0 left-0 z-10 h-full w-2 cursor-col-resize opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
        </div>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
        >
          <ScheduleCard
            schedule={schedule}
            categories={categories}
            onStatusChange={onStatusChange}
            onClick={onClick}
            compact
          />
        </div>
        {/* 리사이즈 핸들 (우측) */}
        <div
          ref={resizeRRef}
          {...resizeRListeners}
          {...resizeRAttrs}
          className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
        </div>
      </div>
    );
  }

  const faded = isDragging || isResizingL || isResizingR;
  return (
    <div className={`group relative ${faded ? 'opacity-30' : ''}`}>
      {/* 리사이즈 핸들 (좌측) */}
      <div
        ref={resizeLRef}
        {...resizeLListeners}
        {...resizeLAttrs}
        className="absolute top-0 left-0 z-10 h-full w-3 cursor-col-resize opacity-0 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
      </div>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
      >
        <ScheduleCard
          schedule={schedule}
          categories={categories}
          onStatusChange={onStatusChange}
          onClick={onClick}
          action={action}
        />
      </div>
      {/* 리사이즈 핸들 (우측) */}
      <div
        ref={resizeRRef}
        {...resizeRListeners}
        {...resizeRAttrs}
        className="absolute top-0 right-0 z-10 h-full w-3 cursor-col-resize opacity-0 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
      </div>
    </div>
  );
}
