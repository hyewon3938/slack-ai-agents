'use client';

import { useState } from 'react';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES } from '@/features/budget/lib/types';
import { XMarkIcon } from '@/components/ui/icons';

interface ExpenseEditModalProps {
  expense: ExpenseRow;
  onSave: (id: number, updates: { date: string; amount: number; category: string; description: string | null }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

export function ExpenseEditModal({ expense, onSave, onDelete, onClose }: ExpenseEditModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState(expense.date);
  const [amountStr, setAmountStr] = useState(expense.amount.toLocaleString('ko-KR'));
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
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
      await onSave(expense.id, {
        date,
        amount,
        category,
        description: description || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">지출 수정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition hover:text-gray-600"
          >
            <XMarkIcon size={18} />
          </button>
        </div>

        {/* Installment badge */}
        {expense.is_installment && expense.installment_num != null && expense.installment_total != null && (
          <div className="mb-3">
            <span className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
              {expense.installment_num}/{expense.installment_total} 할부
            </span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {/* 날짜 */}
          <div>
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
          <div>
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
          <div>
            <label className="mb-1 block text-xs text-gray-500">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* 내역 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">내역</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="메모"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-1 text-xs text-red-500">
              <XMarkIcon size={13} />
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                if (!confirm('이 내역을 삭제할까요?')) return;
                setDeleting(true);
                void onDelete(expense.id).then(onClose).finally(() => setDeleting(false));
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? '삭제 중...' : '삭제'}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-700"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
