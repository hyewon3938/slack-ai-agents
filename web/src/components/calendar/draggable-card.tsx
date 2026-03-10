'use client';

import { useDraggable } from '@dnd-kit/core';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from '../schedule/schedule-card';

interface DraggableCardProps {
  schedule: ScheduleRow;
  categories: CategoryRow[];
  onStatusChange?: (id: number, status: string) => void;
  onClick?: (schedule: ScheduleRow) => void;
  compact?: boolean;
}

export function DraggableCard({
  schedule,
  categories,
  onStatusChange,
  onClick,
  compact,
}: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `move-${schedule.id}`,
  });

  const {
    attributes: resizeAttrs,
    listeners: resizeListeners,
    setNodeRef: resizeRef,
    isDragging: isResizing,
  } = useDraggable({
    id: `resize-${schedule.id}`,
  });

  if (compact) {
    return (
      <div className={`group relative ${isDragging || isResizing ? 'opacity-30' : ''}`}>
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
        {/* 리사이즈 핸들 (우측 끝) */}
        <div
          ref={resizeRef}
          {...resizeListeners}
          {...resizeAttrs}
          className="absolute top-0 right-0 h-full w-2 cursor-col-resize opacity-0 group-hover:opacity-100"
          title="드래그하여 기간 설정"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto h-full w-0.5 rounded bg-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-30' : ''}
    >
      <ScheduleCard
        schedule={schedule}
        categories={categories}
        onStatusChange={onStatusChange}
        onClick={onClick}
      />
    </div>
  );
}
