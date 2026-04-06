'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { TrashIcon, TagIcon } from '@/components/ui/icons';

interface ExpenseListProps {
  expenses: ExpenseRow[];
  onDelete: (id: number) => Promise<void>;
  selectedCategory: string | null;
  onCategoryChange: (cat: string | null) => void;
}

/** 날짜별로 그룹핑 */
function groupByDate(expenses: ExpenseRow[]): Map<string, ExpenseRow[]> {
  const map = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
}

export function ExpenseList({ expenses, onDelete, selectedCategory, onCategoryChange }: ExpenseListProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filtered = selectedCategory
    ? expenses.filter((e) => e.category === selectedCategory)
    : expenses;

  const grouped = groupByDate(filtered);
  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  const handleDelete = async (id: number) => {
    if (!confirm('이 지출을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* 카테고리 필터 */}
      <div className="overflow-x-auto border-b border-gray-100 px-4 py-2">
        <div className="flex gap-1.5">
          <button
            onClick={() => onCategoryChange(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
              selectedCategory === null ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            전체
          </button>
          {EXPENSE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat === selectedCategory ? null : cat)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                selectedCategory === cat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 지출 목록 */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          지출 내역이 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {sortedDates.map((date) => {
            const dayExpenses = grouped.get(date) ?? [];
            const dayTotal = dayExpenses.reduce((s, e) => s + e.amount, 0);
            const dateObj = new Date(date + 'T00:00:00');
            return (
              <div key={date}>
                {/* 날짜 헤더 */}
                <div className="flex items-center justify-between bg-gray-50 px-4 py-1.5">
                  <span className="text-xs font-medium text-gray-500">
                    {format(dateObj, 'M월 d일 (E)', { locale: ko })}
                  </span>
                  <span className="text-xs text-gray-500">{formatAmount(dayTotal)}</span>
                </div>

                {/* 해당 날 지출 */}
                {dayExpenses.map((expense) => (
                  <div key={expense.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                          <TagIcon size={11} />
                          {expense.category}
                        </span>
                        {expense.is_installment && expense.installment_num !== null && expense.installment_total !== null && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">
                            {expense.installment_num}/{expense.installment_total}
                          </span>
                        )}
                      </div>
                      {expense.description && (
                        <p className="mt-0.5 truncate text-xs text-gray-500">{expense.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-gray-800">{formatAmount(expense.amount)}</div>
                      {expense.source === 'import' && (
                        <div className="text-xs text-gray-300">위플</div>
                      )}
                    </div>
                    {expense.source !== 'import' && (
                      <button
                        onClick={() => void handleDelete(expense.id)}
                        disabled={deletingId === expense.id}
                        className="shrink-0 rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-400 disabled:opacity-50"
                      >
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
