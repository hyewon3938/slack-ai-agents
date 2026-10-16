'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  MouseSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import {
  computeDragResult,
  type DateRange,
  type DragType,
} from '@/features/schedule/lib/date-move';

const DRAG_ID_PATTERN = /^(resize-r-|resize-|move-)(\d+)/;

function parseDragId(id: string | number): { type: DragType; scheduleId: number } {
  const str = String(id);
  const match = DRAG_ID_PATTERN.exec(str);

  if (match) {
    const prefix = match[1];
    const scheduleId = Number(match[2]);
    const type: DragType =
      prefix === 'resize-r-' ? 'resize-right' : prefix === 'resize-' ? 'resize-left' : 'move';
    return { type, scheduleId };
  }

  // 프리픽스 없는 경우 (숫자만)
  const numMatch = /^(\d+)/.exec(str);
  return { type: 'move', scheduleId: numMatch ? Number(numMatch[1]) : NaN };
}

interface DndCalendarProps {
  children: React.ReactNode;
  schedules: ScheduleRow[];
  /** 드래그로 바뀐 시작일·종료일을 한 번에 전달 */
  onMove: (id: number, next: DateRange) => void;
}

export function DndCalendar({ children, schedules, onMove }: DndCalendarProps) {
  const [activeSchedule, setActiveSchedule] = useState<ScheduleRow | null>(null);
  const [dragType, setDragType] = useState<DragType>('move');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (isDragging.current) {
        setMousePos({ x: e.clientX, y: e.clientY });
      }
    };
    document.addEventListener('mousemove', handler);
    return () => document.removeEventListener('mousemove', handler);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { type, scheduleId } = parseDragId(event.active.id);
      setDragType(type);
      const schedule = schedules.find((s) => s.id === scheduleId);
      if (schedule) {
        isDragging.current = true;
        const e = event.activatorEvent as MouseEvent;
        setMousePos({ x: e.clientX, y: e.clientY });
        setActiveSchedule(schedule);
      }
    },
    [schedules],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentDragType = dragType;
      isDragging.current = false;
      setActiveSchedule(null);
      const { active, over } = event;
      if (!over) return;

      const { scheduleId } = parseDragId(active.id);
      const targetDate = String(over.id);
      const schedule = schedules.find((s) => s.id === scheduleId);
      if (!schedule) return;

      const next = computeDragResult(
        currentDragType,
        { date: schedule.date, end_date: schedule.end_date },
        targetDate,
      );
      if (next) onMove(scheduleId, next);
    },
    [schedules, dragType, onMove],
  );

  const isResize = dragType === 'resize-left' || dragType === 'resize-right';

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {children}
      </DndContext>
      {activeSchedule &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: mousePos.x + 12,
              top: mousePos.y - 16,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <div className="w-48 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg ring-1 ring-gray-200">
              {isResize ? (
                <span className="text-blue-600">{activeSchedule.title} — 기간 설정 중</span>
              ) : (
                <span className="truncate block">{activeSchedule.title}</span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
