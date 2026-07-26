'use client';

import { useState } from 'react';
import type { RoutineTemplateRow, RoutineTrackingMode } from '@/features/routine/lib/types';
import { ROUTINE_FREQUENCIES, ROUTINE_TIME_SLOTS } from '@/features/routine/lib/types';
import { InactivePeriodList } from './inactive-period-list';

interface RoutineFormData {
  name: string;
  time_slot: string | null;
  frequency: string | null;
  tracking_mode: RoutineTrackingMode;
  start_date?: string;
}

/** 추적 방식 옵션 (ADR-0061) */
const TRACKING_MODES: { value: RoutineTrackingMode; label: string; hint: string }[] = [
  { value: 'scheduled', label: '주기형', hint: '빈도대로 매일 체크리스트에 올라와' },
  { value: 'free', label: '자율', hint: '주기 없이 할 때마다 기록해. 달성률은 안 매겨' },
];

interface RoutineFormProps {
  template?: RoutineTemplateRow;
  onSubmit: (data: RoutineFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** 루틴 추가/수정 폼 */
export function RoutineForm({ template, onSubmit, onDelete, onClose }: RoutineFormProps) {
  const [name, setName] = useState(template?.name ?? '');
  const [timeSlot, setTimeSlot] = useState(template?.time_slot ?? '낮');
  const [frequency, setFrequency] = useState(template?.frequency ?? '매일');
  const [trackingMode, setTrackingMode] = useState<RoutineTrackingMode>(
    template?.tracking_mode ?? 'scheduled',
  );
  const [startDate, setStartDate] = useState(template?.start_date ?? '');
  const [saving, setSaving] = useState(false);

  // 자율 모드에서는 주기 전용 항목을 숨기지만 값은 보존한다 — 주기형으로 되돌리면 되살아난다 (ADR-0061)
  const isFree = trackingMode === 'free';

  const isDirty = () => {
    if (!template) return name.trim().length > 0;
    return (
      name !== template.name ||
      timeSlot !== template.time_slot ||
      frequency !== template.frequency ||
      trackingMode !== template.tracking_mode ||
      startDate !== (template.start_date ?? '')
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data: RoutineFormData = {
        name: name.trim(),
        time_slot: timeSlot,
        frequency,
        tracking_mode: trackingMode,
      };
      // 수정 모드: 변경된 경우에만 전송
      if (template && startDate && startDate !== template.start_date) {
        data.start_date = startDate;
      }
      // 생성 모드: startDate가 있으면 전송
      if (!template && startDate) {
        data.start_date = startDate;
      }
      await onSubmit(data);
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

      {/* 추적 방식 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">추적 방식</label>
        <div className="flex gap-2">
          {TRACKING_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setTrackingMode(mode.value)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition ${
                trackingMode === mode.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {TRACKING_MODES.find((m) => m.value === trackingMode)?.hint}
        </p>
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

      {/* 빈도 (주기형 전용) */}
      {!isFree && (
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
      )}

      {/* 시작일 (주기형 전용) */}
      {!isFree && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">시작일</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            {template
              ? '시작일 이전 기록은 통계에서 제외돼'
              : '간격 빈도(격일 등)는 시작일 기준으로 주기가 정해져'}
          </p>
        </div>
      )}

      {/* 비활성 기간 (주기형 수정 모드에서만) */}
      {template && !isFree && <InactivePeriodList templateId={template.id} />}

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
