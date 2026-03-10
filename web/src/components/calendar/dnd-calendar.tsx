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

type DragType = 'move' | 'resize-left' | 'resize-right';

const DRAG_ID_PATTERN = /^(resize-r-|resize-|move-)(\d+)/;

function parseDragId(id: string | number): { type: DragType; scheduleId: number } {
  const str = String(id);
  const match = DRAG_ID_PATTERN.exec(str);

  if (match) {
    const prefix = match[1];
    const scheduleId = Number(match[2]);
    const type: DragType =
      prefix === 'resize-r-' ? 'resize-right' :
      prefix === 'resize-' ? 'resize-left' : 'move';
    return { type, scheduleId };
  }

  // 프리픽스 없는 경우 (숫자만)
  const numMatch = /^(\d+)/.exec(str);
  return { type: 'move', scheduleId: numMatch ? Number(numMatch[1]) : NaN };
}

interface DndCalendarProps {
  children: React.ReactNode;
  schedules: ScheduleRow[];
  categories: CategoryRow[];
  onDateChange: (id: number, newDate: string) => void;
  onEndDateChange?: (id: number, endDate: string | null) => void;
}

export function DndCalendar({
  children,
  schedules,
  categories,
  onDateChange,
  onEndDateChange,
}: DndCalendarProps) {
  const [activeSchedule, setActiveSchedule] = useState<ScheduleRow | null>(null);
  const [dragType, setDragType] = useState<DragType>('move');

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

      const scheduleDate = schedule.date ?? '';
      const endDate = schedule.end_date ?? '';

      if (currentDragType === 'resize-right') {
        // 오른쪽 핸들: end_date 변경
        if (targetDate <= scheduleDate) {
          // 시작일 이하로 당김 → 단일 일정으로 변환
          onEndDateChange?.(scheduleId, null);
        } else {
          onEndDateChange?.(scheduleId, targetDate);
        }
      } else if (currentDragType === 'resize-left') {
        // 왼쪽 핸들: 시작일 변경
        if (endDate && targetDate >= endDate) {
          // 종료일 이상으로 밀면 → 종료일 위치에서 단일 일정
          onDateChange(scheduleId, endDate);
          onEndDateChange?.(scheduleId, null);
        } else if (targetDate !== scheduleDate) {
          // 시작일 변경
          onDateChange(scheduleId, targetDate);
          if (!endDate) {
            // 기존 단일 일정 → 기간 설정
            onEndDateChange?.(scheduleId, scheduleDate);
          }
        }
      } else {
        // 이동
        if (schedule.date !== targetDate) {
          if (endDate && endDate > scheduleDate) {
            // 기간 일정: 기간 유지하면서 이동
            const durationMs =
              new Date(endDate + 'T12:00:00').getTime() -
              new Date(scheduleDate + 'T12:00:00').getTime();
            const newEndStr = new Date(
              new Date(targetDate + 'T12:00:00').getTime() + durationMs,
            )
              .toISOString()
              .slice(0, 10);
            onDateChange(scheduleId, targetDate);
            onEndDateChange?.(scheduleId, newEndStr);
          } else {
            onDateChange(scheduleId, targetDate);
          }
        }
      }
    },
    [schedules, dragType, onDateChange, onEndDateChange],
  );

  const isResize = dragType === 'resize-left' || dragType === 'resize-right';

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeSchedule && (
          <div className={`w-48 opacity-80 ${!isResize ? 'rotate-2' : ''}`}>
            {isResize ? (
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
