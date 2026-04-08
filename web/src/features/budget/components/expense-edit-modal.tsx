'use client';

import { useState } from 'react';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES, BUDGET_EXCLUDED_CATEGORIES } from '@/features/budget/lib/types';
import { XMarkIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

interface ExpenseEditModalProps {
  expense: ExpenseRow;
  onSave: (id: number, updates: { date: string; amount: number; category: string; description: string | null; exclude_from_budget: boolean }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

export function ExpenseEditModal({ expense, onSave, onDelete, onClose }: ExpenseEditModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState(expense.date);
  const [amountStr, setAmountStr] = useState(expense.amount.toLocaleString('ko-KR'));
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description ?? '');
  const [excludeFromBudget, setExcludeFromBudget] = useState(expense.exclude_from_budget);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setExcludeFromBudget(BUDGET_EXCLUDED_CATEGORIES.has(cat));
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
        exclude_from_budget: excludeFromBudget,
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
          <Input
            label="날짜"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          {/* 금액 */}
          <Input
            label="금액 (원)"
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={handleAmountChange}
            placeholder="0"
            required
          />

          {/* 카테고리 */}
          <Select
            label="카테고리"
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>

          {/* 내역 */}
          <Input
            label="내역"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="메모"
          />

          {/* 예산 포함/제외 토글 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">예산</label>
            <div className="flex rounded-lg border border-gray-200 p-0.5 w-fit">
              <button
                type="button"
                onClick={() => setExcludeFromBudget(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  !excludeFromBudget ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                포함
              </button>
              <button
                type="button"
                onClick={() => setExcludeFromBudget(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  excludeFromBudget ? 'bg-gray-500 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                제외
              </button>
            </div>
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
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (!confirm('이 내역을 삭제할까요?')) return;
                setDeleting(true);
                void onDelete(expense.id).then(onClose).finally(() => setDeleting(false));
              }}
            >
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
