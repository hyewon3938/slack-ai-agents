'use client';

import { useState } from 'react';
import type { RoutineRecordRow } from '@/lib/types';

interface RoutineRecordDetailProps {
  record: RoutineRecordRow;
  onSaveMemo: (id: number, memo: string | null) => void;
  onClose: () => void;
}

/** 기록 상세 — 메모 확인/편집 */
export function RoutineRecordDetail({ record, onSaveMemo, onClose }: RoutineRecordDetailProps) {
  const [memo, setMemo] = useState(record.memo ?? '');
  const [saving, setSaving] = useState(false);

  const isDirty = memo !== (record.memo ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveMemo(record.id, memo.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`text-base font-semibold ${record.completed ? 'text-green-600' : 'text-gray-900'}`}>
          {record.completed ? '✓ ' : '○ '}
          {record.name}
        </span>
        {record.completed_at && (
          <span className="text-xs text-gray-400">
            {record.completed_at.slice(11, 16)} 완료
          </span>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모를 입력해봐"
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          닫기
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
