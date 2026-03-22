'use client';

import { useState } from 'react';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';
import { StatusBadge } from './status-badge';

interface ScheduleCardProps {
  schedule: ScheduleRow;
  categories: CategoryRow[];
  onStatusChange?: (id: number, status: string) => void;
  onClick?: (schedule: ScheduleRow) => void;
  compact?: boolean;
  action?: React.ReactNode;
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
  action,
}: ScheduleCardProps) {
  const [memoExpanded, setMemoExpanded] = useState(false);
  const cat = categories.find((c) => c.name === schedule.category);
  const colorKey = cat?.color ?? 'gray';
  const catStyle = getCategoryStyle(colorKey);
  const isEvent = cat?.type === 'event';
  const isDone = schedule.status === 'done' || schedule.status === 'cancelled';

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = NEXT_STATUS[schedule.status];
    if (next && onStatusChange) {
      onStatusChange(schedule.id, next);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(schedule);
  };

  if (compact) {
    return (
      <div
        onClick={handleCardClick}
        className={`cursor-pointer truncate rounded border-l-2 px-1.5 py-0.5 text-xs leading-tight ${isDone ? 'line-through opacity-60' : ''}`}
        style={{ backgroundColor: catStyle.bg, color: catStyle.text, borderLeftColor: catStyle.border }}
      >
        {schedule.important && <span className="mr-0.5 text-amber-500">★</span>}
        {schedule.title}
      </div>
    );
  }

  return (
    <div
      onClick={handleCardClick}
      className={`cursor-pointer rounded-lg border p-3 transition hover:shadow-sm ${STATUS_BG[schedule.status] ?? 'bg-white'} ${
        isEvent
          ? 'border-l-[3px]'
          : !isDone && schedule.date && new Date(schedule.date + 'T12:00:00+09:00') < new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00+09:00') && schedule.status === 'todo'
            ? 'border-red-300'
            : 'border-gray-200'
      }`}
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
            <span className={`text-sm font-medium ${isDone && !isEvent ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
              {schedule.important && <span className="mr-1 text-amber-500">★</span>}
              {schedule.title}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {!isEvent && <StatusBadge status={schedule.status} />}
            {schedule.category && <CategoryBadge colorKey={colorKey} label={schedule.category} />}
            {schedule.subcategory && (() => {
              const sub = categories.find((c) => c.name === schedule.subcategory && c.parent_id !== null);
              const subColor = sub?.color ?? 'gray';
              return <CategoryBadge colorKey={subColor} label={schedule.subcategory} />;
            })()}
            {schedule.end_date && schedule.end_date !== schedule.date && (
              <span className="text-xs text-gray-400">
                {formatDateRange(schedule.date, schedule.end_date)}
              </span>
            )}
          </div>

          {schedule.memo && (
            <div className="mt-1.5">
              <p className={`whitespace-pre-wrap text-xs leading-relaxed ${isDone ? 'text-gray-300' : 'text-gray-500'} ${memoExpanded ? '' : 'line-clamp-3'}`}>
                {schedule.memo}
              </p>
              {schedule.memo.split('\n').length > 3 || schedule.memo.length > 120 ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setMemoExpanded(!memoExpanded); }}
                  className="mt-0.5 text-xs text-blue-500 hover:text-blue-600"
                >
                  {memoExpanded ? '줄이기' : '더보기'}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

function formatDateRange(date: string | null, endDate: string): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${Number(m)}/${Number(day)}`;
  };
  return date ? `${fmt(date)} - ${fmt(endDate)}` : fmt(endDate);
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
