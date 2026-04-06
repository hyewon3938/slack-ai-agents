'use client';

import type { RoutineRecordRow } from '@/features/routine/lib/types';
import { RoutineCard } from './routine-card';

interface RoutineChecklistProps {
  records: RoutineRecordRow[];
  onToggle: (id: number, completed: boolean) => void;
  onMemoClick: (record: RoutineRecordRow) => void;
  onEditTemplate: (templateId: number) => void;
}

/** 시간대별 그룹 체크리스트 */
export function RoutineChecklist({
  records, onToggle, onMemoClick, onEditTemplate,
}: RoutineChecklistProps) {
  const dayRecords = records.filter((r) => r.time_slot === '낮' || !r.time_slot);
  const nightRecords = records.filter((r) => r.time_slot === '밤');
  const completed = records.filter((r) => r.completed).length;

  if (records.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        오늘 루틴이 없어. 루틴을 추가해볼까?
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dayRecords.length > 0 && (
        <Group title="☀️ 낮" records={dayRecords} onToggle={onToggle} onMemoClick={onMemoClick} onEditTemplate={onEditTemplate} />
      )}
      {nightRecords.length > 0 && (
        <Group title="🌙 밤" records={nightRecords} onToggle={onToggle} onMemoClick={onMemoClick} onEditTemplate={onEditTemplate} />
      )}

      {/* 달성률 바 */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-gray-600">달성률</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${records.length > 0 ? (completed / records.length) * 100 : 0}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-900">
          {completed}/{records.length} ({records.length > 0 ? Math.round((completed / records.length) * 100) : 0}%)
        </span>
      </div>
    </div>
  );
}

function Group({
  title, records, onToggle, onMemoClick, onEditTemplate,
}: {
  title: string;
  records: RoutineRecordRow[];
  onToggle: (id: number, completed: boolean) => void;
  onMemoClick: (record: RoutineRecordRow) => void;
  onEditTemplate: (templateId: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">{title}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      {records.map((r) => (
        <RoutineCard
          key={r.id}
          record={r}
          onToggle={onToggle}
          onMemoClick={onMemoClick}
          onEdit={onEditTemplate}
        />
      ))}
    </div>
  );
}
