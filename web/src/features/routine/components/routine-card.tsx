'use client';

import { useState } from 'react';
import type { RoutineRecordRow } from '@/features/routine/lib/types';

interface RoutineCardProps {
  record: RoutineRecordRow;
  onToggle: (id: number, completed: boolean) => void;
  onMemoClick: (record: RoutineRecordRow) => void;
  onEdit: (templateId: number) => void;
}

/** 개별 루틴 체크 카드 */
export function RoutineCard({ record, onToggle, onMemoClick, onEdit }: RoutineCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 transition hover:shadow-sm ${
        record.completed
          ? 'border-green-300 bg-green-50/60'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* 체크박스 */}
      <button
        onClick={() => onToggle(record.id, !record.completed)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs transition ${
          record.completed
            ? 'border-green-400 bg-green-100 text-green-600'
            : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
        }`}
      >
        {record.completed && '✓'}
      </button>

      {/* 이름 */}
      <span
        className={`flex-1 text-sm font-medium ${
          record.completed ? 'text-gray-400 line-through' : 'text-gray-900'
        }`}
      >
        {record.name}
      </span>

      {/* 빈도 배지 */}
      {record.frequency && record.frequency !== '매일' && (
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {record.frequency}
        </span>
      )}

      {/* 메모 표시 */}
      {record.memo && (
        <button onClick={() => onMemoClick(record)} className="text-sm text-gray-400">
          📝
        </button>
      )}

      {/* 더보기 메뉴 */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="px-1 text-gray-400 hover:text-gray-600"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => { onMemoClick(record); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              📝 메모
            </button>
            <button
              onClick={() => { onEdit(record.template_id); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              ✏️ 수정
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
