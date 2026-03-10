'use client';

import { useState } from 'react';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { SCHEDULE_STATUSES, STATUS_LABELS } from '@/lib/types';

interface ScheduleFormProps {
  schedule?: ScheduleRow | null;
  categories: CategoryRow[];
  defaultDate?: string | null;
  onSubmit: (data: Partial<ScheduleRow>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function ScheduleForm({
  schedule,
  categories,
  defaultDate,
  onSubmit,
  onDelete,
  onClose,
}: ScheduleFormProps) {
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [date, setDate] = useState(schedule?.date ?? defaultDate ?? '');
  const [endDate, setEndDate] = useState(schedule?.end_date ?? '');
  const [status, setStatus] = useState(schedule?.status ?? 'todo');
  const [category, setCategory] = useState(schedule?.category ?? '');
  const [memo, setMemo] = useState(schedule?.memo ?? '');
  const [important, setImportant] = useState(schedule?.important ?? false);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      const finalCategory = showNewCategory ? newCategory.trim() : category;
      await onSubmit({
        title: title.trim(),
        date: date || null,
        end_date: endDate || null,
        status,
        category: finalCategory || null,
        memo: memo || null,
        important,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 제목 */}
      <div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="일정 제목"
          autoFocus
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
      </div>

      {/* 날짜 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">시작일</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">종료일</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* 상태 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">상태</label>
        <div className="flex gap-1">
          {SCHEDULE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                status === s
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* 카테고리 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">카테고리</label>
        {!showNewCategory ? (
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">없음</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCategory(true)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100"
            >
              + 새로
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="새 카테고리 이름"
              autoFocus
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowNewCategory(false);
                setNewCategory('');
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100"
            >
              취소
            </button>
          </div>
        )}
      </div>

      {/* 중요 */}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={important}
          onChange={(e) => setImportant(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-200"
        />
        <span className="text-sm text-gray-700">중요 표시 ★</span>
      </label>

      {/* 메모 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택)"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* 버튼 */}
      <div className="flex gap-2">
        {onDelete && schedule && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
          >
            삭제
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '저장중...' : schedule ? '수정' : '추가'}
        </button>
      </div>
    </form>
  );
}
