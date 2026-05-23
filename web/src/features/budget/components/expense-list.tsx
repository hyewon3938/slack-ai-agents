'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { FunnelIcon, ChevronDownIcon } from '@/components/ui/icons';

export type TypeFilter = 'all' | 'expense' | 'income';

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'expense', label: '지출' },
  { value: 'income', label: '수입' },
];

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

const PAYMENT_LABELS: Record<string, string> = {
  현대카드: '현대',
  국민카드: '국민',
  현금: '현금',
};

function getPaymentLabel(method: string): string | null {
  return PAYMENT_LABELS[method] ?? null;
}

interface ExpenseListProps {
  expenses: ExpenseRow[];
  onEdit: (expense: ExpenseRow) => void;
  selectedCategory: string | null;
  onCategoryChange: (cat: string | null) => void;
  selectedType: TypeFilter;
  onTypeChange: (t: TypeFilter) => void;
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

export function ExpenseList({
  expenses,
  onEdit,
  selectedCategory,
  onCategoryChange,
  selectedType,
  onTypeChange,
}: ExpenseListProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  // type + 카테고리 AND 필터
  const filtered = expenses.filter((e) => {
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (selectedCategory && e.category !== selectedCategory) return false;
    return true;
  });

  const grouped = groupByDate(filtered);
  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  // 카테고리 풀 = selectedType에 맞춰 분기
  const categoryPool: readonly string[] =
    selectedType === 'income'
      ? INCOME_CATEGORIES
      : selectedType === 'expense'
        ? EXPENSE_CATEGORIES
        : [...new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];

  // 활성 카테고리도 type 적용 후 추출
  const typeScopedExpenses =
    selectedType === 'all' ? expenses : expenses.filter((e) => e.type === selectedType);
  const activeCategories = new Set(typeScopedExpenses.map((e) => e.category));
  const sortedCategories = categoryPool.filter((c) => activeCategories.has(c));

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* type 세그먼트 */}
      <div className="border-b border-gray-100 px-4 py-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onTypeChange(opt.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                selectedType === opt.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
                onClick={() => {
                  onCategoryChange(null);
                  setFilterOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${
                  selectedCategory === null
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
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
                    onClick={() => {
                      onCategoryChange(cat);
                      setFilterOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${
                      selectedCategory === cat
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
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
        <div className="py-12 text-center text-sm text-gray-400">지출 내역이 없습니다.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {sortedDates.map((date) => {
            const dayExpenses = grouped.get(date) ?? [];
            const dayTotal = dayExpenses.reduce(
              (s, e) => (e.type === 'income' ? s - e.amount : s + e.amount),
              0,
            );
            const dateObj = new Date(date + 'T00:00:00');
            return (
              <div key={date}>
                {/* 날짜 헤더 */}
                <div className="flex items-center justify-between bg-gray-50 px-4 py-1.5">
                  <span className="text-xs font-medium text-gray-500">
                    {format(dateObj, 'M월 d일 (E)', { locale: ko })}
                  </span>
                  <span className={`text-xs ${dayTotal < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                    {dayTotal < 0 ? '+' : ''}
                    {formatAmount(Math.abs(dayTotal))}
                  </span>
                </div>

                {/* 해당 날 지출 */}
                {dayExpenses.map((expense) => {
                  const color = getCategoryColor(expense.category);
                  return (
                    <div
                      key={expense.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      onClick={() => onEdit(expense)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-xs font-medium text-gray-700">
                            {expense.category}
                          </span>
                          {expense.is_installment &&
                            expense.installment_num !== null &&
                            expense.installment_total !== null && (
                              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-500">
                                {expense.installment_num}/{expense.installment_total}
                              </span>
                            )}
                          {expense.type === 'expense' &&
                            getPaymentLabel(expense.payment_method) && (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                                {getPaymentLabel(expense.payment_method)}
                              </span>
                            )}
                        </div>
                        {expense.description && (
                          <p className="mt-0.5 truncate text-xs text-gray-500">
                            {expense.description}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`text-sm font-semibold ${expense.type === 'income' ? 'text-green-600' : 'text-gray-800'}`}
                        >
                          {expense.type === 'income' ? '+' : ''}
                          {formatAmount(expense.amount)}
                        </div>
                      </div>
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
