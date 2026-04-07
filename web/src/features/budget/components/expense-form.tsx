'use client';

import { useState } from 'react';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/features/budget/lib/types';
import { PlusIcon, XMarkIcon } from '@/components/ui/icons';

interface ExpenseFormProps {
  onAdd: (data: {
    date: string;
    amount: number;
    category: string;
    description?: string | null;
    type?: 'expense' | 'income';
  }) => Promise<ExpenseRow>;
}

export function ExpenseForm({ onAdd }: ExpenseFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [date, setDate] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTypeChange = (type: 'expense' | 'income') => {
    setEntryType(type);
    // 타입 변경 시 카테고리를 해당 타입의 첫 번째로 초기화
    setCategory(type === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseInt(amountStr.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
      setError('금액을 올바르게 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      await onAdd({ date, amount, category, description: description || null, type: entryType });
      setAmountStr('');
      setDescription('');
      setDate(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
  };

  const currentCategories = entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* 지출 / 수입 토글 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 p-0.5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'expense' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            지출
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'income' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            수입
          </button>
        </div>
        <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          <PlusIcon size={14} />
          {entryType === 'expense' ? '지출 추가' : '수입 추가'}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* 날짜 */}
        <div className="col-span-1">
          <label className="mb-1 block text-xs text-gray-500">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
            required
          />
        </div>

        {/* 금액 */}
        <div className="col-span-1">
          <label className="mb-1 block text-xs text-gray-500">금액 (원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={handleAmountChange}
            placeholder="0"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
            required
          />
        </div>

        {/* 카테고리 */}
        <div className="col-span-1">
          <label className="mb-1 block text-xs text-gray-500">카테고리</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            {currentCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* 내역 */}
        <div className="col-span-1">
          <label className="mb-1 block text-xs text-gray-500">내역 (선택)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="메모"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-500">
          <XMarkIcon size={13} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`mt-3 ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50 ${
          entryType === 'expense' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        <PlusIcon size={13} />
        {loading ? '추가 중...' : entryType === 'expense' ? '추가' : '수입 기록'}
      </button>
    </form>
  );
}
