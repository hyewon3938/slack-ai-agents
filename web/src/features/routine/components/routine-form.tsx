'use client';

import { useState } from 'react';
import type { RoutineTemplateRow } from '@/features/routine/lib/types';
import { ROUTINE_FREQUENCIES, ROUTINE_TIME_SLOTS } from '@/features/routine/lib/types';

interface RoutineFormProps {
  template?: RoutineTemplateRow;
  onSubmit: (data: { name: string; time_slot: string | null; frequency: string | null }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** 루틴 추가/수정 폼 */
export function RoutineForm({ template, onSubmit, onDelete, onClose }: RoutineFormProps) {
  const [name, setName] = useState(template?.name ?? '');
  const [timeSlot, setTimeSlot] = useState(template?.time_slot ?? '낮');
  const [frequency, setFrequency] = useState(template?.frequency ?? '매일');
  const [saving, setSaving] = useState(false);

  const isDirty = () => {
    if (!template) return name.trim().length > 0;
    return (
      name !== template.name ||
      timeSlot !== template.time_slot ||
      frequency !== template.frequency
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), time_slot: timeSlot, frequency });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!confirm('이 루틴을 삭제할까?')) return;
    onDelete?.();
  };

  return (
    <div className="space-y-5">
      {/* 이름 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">이름</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="루틴 이름"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          autoFocus
        />
      </div>

      {/* 시간대 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">시간대</label>
        <div className="flex gap-2">
          {ROUTINE_TIME_SLOTS.map((slot) => (
            <button
              key={slot.value}
              onClick={() => setTimeSlot(slot.value)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition ${
                timeSlot === slot.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {slot.value === '낮' ? '☀️' : '🌙'} {slot.label}
            </button>
          ))}
        </div>
      </div>

      {/* 빈도 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">빈도</label>
        <div className="flex flex-wrap gap-2">
          {ROUTINE_FREQUENCIES.map((freq) => (
            <button
              key={freq.value}
              onClick={() => setFrequency(freq.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                frequency === freq.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {freq.label}
            </button>
          ))}
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 pt-2">
        {template && onDelete && (
          <button
            onClick={handleDelete}
            className="rounded-lg px-4 py-2.5 text-sm text-red-500 hover:bg-red-50"
          >
            삭제
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || saving || !isDirty()}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '저장 중...' : template ? '수정' : '추가'}
        </button>
      </div>
    </div>
  );
}
