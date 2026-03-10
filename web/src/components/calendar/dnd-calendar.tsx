'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { ScheduleCard } from '../schedule/schedule-card';

function parseDragId(id: string | number): { type: 'move' | 'resize'; scheduleId: number } {
  const str = String(id);
  if (str.startsWith('resize-')) {
    return { type: 'resize', scheduleId: Number(str.slice(7)) };
  }
  if (str.startsWith('move-')) {
    return { type: 'move', scheduleId: Number(str.slice(5)) };
  }
  return { type: 'move', scheduleId: Number(str) };
}

interface DndCalendarProps {
  children: React.ReactNode;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onDateChange: (id: number, newDate: string) => void;
  onEndDateChange?: (id: number, endDate: string) => void;
}

export function DndCalendar({
  children,
  schedules,
  categories,
  onDateChange,
  onEndDateChange,
}: DndCalendarProps) {
  const [activeSchedule, setActiveSchedule] = useState<ScheduleRow | null>(null);
  const [dragType, setDragType] = useState<'move' | 'resize'>('move');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { type, scheduleId } = parseDragId(event.active.id);
      setDragType(type);
      const schedule = schedules.find((s) => s.id === scheduleId);
      if (schedule) setActiveSchedule(schedule);
    },
    [schedules],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentDragType = dragType;
      setActiveSchedule(null);
      const { active, over } = event;
      if (!over) return;

      const { scheduleId } = parseDragId(active.id);
      const targetDate = String(over.id);
      const schedule = schedules.find((s) => s.id === scheduleId);
      if (!schedule) return;

      if (currentDragType === 'resize') {
        // 기간 설정: end_date 변경
        if (targetDate > (schedule.date ?? '')) {
          onEndDateChange?.(scheduleId, targetDate);
        }
      } else {
        // 날짜 이동
        if (schedule.date !== targetDate) {
          onDateChange(scheduleId, targetDate);
        }
      }
    },
    [schedules, dragType, onDateChange, onEndDateChange],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeSchedule && (
          <div className={`w-48 opacity-80 ${dragType === 'move' ? 'rotate-2' : ''}`}>
            {dragType === 'resize' ? (
              <div className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                {activeSchedule.title} — 기간 설정 중
              </div>
            ) : (
              <ScheduleCard
                schedule={activeSchedule}
                categories={categories}
                compact
              />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
