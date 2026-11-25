'use client';

import { useState } from 'react';
import { ALL_EXPENSE_CATEGORIES } from '@/features/budget/lib/types';

export function CategoryLimitAddForm({
  existingCategories,
  onAdd,
}: {
  existingCategories: string[];
  onAdd: (data: { category: string; target_count: number }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [target, setTarget] = useState('5');
  const [saving, setSaving] = useState(false);

  const available = ALL_EXPENSE_CATEGORIES.filter((c) => !existingCategories.includes(c));

  const handleSubmit = async () => {
    const t = Number(target);
    if (!category || !Number.isInteger(t) || t < 1 || t > 50) return;
    setSaving(true);
    try {
      await onAdd({ category, target_count: t });
      setCategory('');
      setTarget('5');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={available.length === 0}
        className="w-full border-t border-gray-100 px-4 py-2.5 text-left text-xs text-blue-500 hover:bg-blue-50 disabled:text-gray-300 disabled:hover:bg-transparent"
      >
        {available.length === 0 ? '모든 카테고리에 한도가 설정됨' : '+ 카테고리 한도 추가'}
      </button>
    );
  }

  return (
    <div className="space-y-2 border-t border-gray-100 px-4 py-3">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
      >
        <option value="">카테고리 선택</option>
        {available.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">주기당</label>
        <input
          type="number"
          min="1"
          max="50"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-20 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
        <span className="text-xs text-gray-400">회까지</span>
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={saving || !category}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? '추가 중...' : '추가'}
        </button>
      </div>
    </div>
  );
}
