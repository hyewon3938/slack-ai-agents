'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { TrashIcon, FunnelIcon, ChevronDownIcon } from '@/components/ui/icons';

/** 카테고리별 색상 맵 */
const CATEGORY_COLORS: Record<string, string> = {
  식재료: '#22c55e',
  배달음식: '#f97316',
  외식비: '#ef4444',
  카페: '#92400e',
  생필품: '#06b6d4',
  쇼핑: '#a855f7',
  미용: '#ec4899',
  교통비: '#3b82f6',
  '의료/건강': '#14b8a6',
  구독료: '#6366f1',
  통신비: '#64748b',
  공과금: '#78716c',
  문화생활: '#f59e0b',
  여행: '#0ea5e9',
  경조사: '#d946ef',
  고양이: '#fb923c',
  '리커밋 사업': '#84cc16',
  '리커밋 택배': '#65a30d',
  환불: '#10b981',
  기타: '#9ca3af',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#9ca3af';
}

interface ExpenseListProps {
  expenses: ExpenseRow[];
  onDelete: (id: number) => Promise<void>;
  onEdit: (expense: ExpenseRow) => void;
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

export function ExpenseList({ expenses, onDelete, onEdit, selectedCategory, onCategoryChange }: ExpenseListProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

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

  // 현재 expenses에 실제 존재하는 카테고리만 필터에 표시
  const activeCategories = [...new Set(expenses.map((e) => e.category))];
  const sortedCategories = EXPENSE_CATEGORIES.filter((c) => activeCategories.includes(c));

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* 카테고리 필터 버튼 */}
      <div className="relative border-b border-gray-100 px-4 py-2">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            selectedCategory
              ? 'bg-blue-50 text-blue-700'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          }`}
        >
          <FunnelIcon size={13} />
          {selectedCategory ?? '필터'}
          <ChevronDownIcon size={13} />
        </button>

        {filterOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
            <div className="absolute left-4 top-full z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button
                onClick={() => { onCategoryChange(null); setFilterOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${
                  selectedCategory === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                전체
              </button>
              {sortedCategories.map((cat) => {
                const color = getCategoryColor(cat);
                const count = expenses.filter((e) => e.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => { onCategoryChange(cat); setFilterOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${
                      selectedCategory === cat ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="flex-1 text-left">{cat}</span>
                    <span className="text-gray-400">{count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
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
                {dayExpenses.map((expense) => {
                  const color = getCategoryColor(expense.category);
                  return (
                    <div key={expense.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer" onClick={() => onEdit(expense)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-xs font-medium text-gray-700">
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
                      </div>
                      {expense.source !== 'import' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleDelete(expense.id); }}
                          disabled={deletingId === expense.id}
                          className="shrink-0 rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-400 disabled:opacity-50"
                        >
                          <TrashIcon size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
