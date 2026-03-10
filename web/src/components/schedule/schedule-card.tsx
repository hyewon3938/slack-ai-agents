'use client';

import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';
import { StatusBadge } from './status-badge';

interface ScheduleCardProps {
  schedule: ScheduleRow;
  categories: CategoryRow[];
  onStatusChange?: (id: number, status: string) => void;
  onClick?: (schedule: ScheduleRow) => void;
  compact?: boolean;
}

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

export function ScheduleCard({
  schedule,
  categories,
  onStatusChange,
  onClick,
  compact,
}: ScheduleCardProps) {
  const cat = categories.find((c) => c.name === schedule.category);
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const isDone = schedule.status === 'done' || schedule.status === 'cancelled';

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = NEXT_STATUS[schedule.status];
    if (next && onStatusChange) {
      onStatusChange(schedule.id, next);
    }
  };

  if (compact) {
    if (catStyle.isPreset && catStyle.classes) {
      return (
        <div
          onClick={() => onClick?.(schedule)}
          className={`cursor-pointer truncate rounded px-1.5 py-0.5 text-xs leading-tight ${catStyle.classes.bg} ${catStyle.classes.text} border-l-2 ${catStyle.classes.border} ${isDone ? 'line-through opacity-60' : ''}`}
        >
          {schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
          {schedule.title}
        </div>
      );
    }
    return (
      <div
        onClick={() => onClick?.(schedule)}
        className={`cursor-pointer truncate rounded border-l-2 px-1.5 py-0.5 text-xs leading-tight ${isDone ? 'line-through opacity-60' : ''}`}
        style={{ backgroundColor: catStyle.styles?.bg, color: catStyle.styles?.text, borderLeftColor: catStyle.styles?.border }}
      >
        {schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
        {schedule.title}
      </div>
    );
  }

  return (
    <div
      onClick={() => onClick?.(schedule)}
      className={`cursor-pointer rounded-lg border p-3 transition hover:shadow-sm ${STATUS_BG[schedule.status] ?? 'bg-white'} ${
        !isDone && schedule.date && new Date(schedule.date + 'T12:00:00+09:00') < new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00+09:00') && schedule.status === 'todo'
          ? 'border-red-300'
          : 'border-gray-200'
      }`}
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
            <span className={`text-sm font-medium ${isDone ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
              {schedule.important && <span className="mr-1 text-amber-500">★</span>}
              {schedule.title}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={schedule.status} />
            {schedule.category && <CategoryBadge colorKey={colorKey} label={schedule.category} />}
          </div>

          {schedule.memo && (
            <p className={`mt-1.5 text-xs leading-relaxed ${isDone ? 'text-gray-300' : 'text-gray-500'}`}>
              {schedule.memo.length > 80 ? schedule.memo.slice(0, 80) + '...' : schedule.memo}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryBadge({ colorKey, label }: { colorKey: string; label: string }) {
  const style = getCategoryStyle(colorKey);
  if (style.isPreset && style.classes) {
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${style.classes.bg} ${style.classes.text}`}>
        {label}
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: style.styles?.bg, color: style.styles?.text }}
    >
      {label}
    </span>
  );
}
