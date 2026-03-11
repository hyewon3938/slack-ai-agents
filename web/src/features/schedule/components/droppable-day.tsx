'use client';

import { useDroppable } from '@dnd-kit/core';

interface DroppableDayProps {
  dateStr: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function DroppableDay({ dateStr, children, className, onClick }: DroppableDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/50' : ''}`}
    >
      {children}
    </div>
  );
}
