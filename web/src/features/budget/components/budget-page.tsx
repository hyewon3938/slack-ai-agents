'use client';

import { useState } from 'react';
import { useBudget } from '@/features/budget/hooks/use-budget';
import { MonthSummaryCard } from './month-summary';
import { ExpenseForm } from './expense-form';
import { ExpenseList } from './expense-list';
import { CategoryChart } from './category-chart';
import { RunwayCard } from './runway-card';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';

function MonthNavigator({
  selectedMonth,
  onChange,
}: {
  selectedMonth: string;
  onChange: (month: string) => void;
}) {
  const [year, month] = selectedMonth.split('-').map(Number);

  const prev = () => {
    const d = new Date(year, month - 2, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const next = () => {
    const d = new Date(year, month, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={prev} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
        <ChevronLeftIcon size={18} />
      </button>
      <span className="min-w-[80px] text-center text-sm font-semibold text-gray-800">
        {year}년 {month}월
      </span>
      <button
        onClick={next}
        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <ChevronRightIcon size={18} />
      </button>
    </div>
  );
}

export function BudgetPage() {
  const { selectedMonth, setSelectedMonth, expenses, summary, loading, error, addExpense, deleteExpense } = useBudget();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'chart' | 'runway'>('list');

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900">지출 관리</h1>
        <MonthNavigator selectedMonth={selectedMonth} onChange={setSelectedMonth} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* 월간 요약 */}
      {loading ? (
        <div className="mb-4 h-40 animate-pulse rounded-xl bg-gray-100" />
      ) : summary ? (
        <div className="mb-4">
          <MonthSummaryCard summary={summary} />
        </div>
      ) : null}

      {/* 지출 추가 폼 */}
      <div className="mb-4">
        <ExpenseForm onAdd={addExpense} />
      </div>

      {/* 탭 */}
      <div className="mb-3 flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {(['list', 'chart', 'runway'] as const).map((tab) => {
          const labels = { list: '지출 목록', chart: '카테고리', runway: '런웨이' };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* 탭 내용 */}
      {activeTab === 'list' && (
        loading ? (
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <ExpenseList
            expenses={expenses}
            onDelete={deleteExpense}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
          />
        )
      )}

      {activeTab === 'chart' && summary && (
        <CategoryChart stats={summary.by_category} total={summary.variable_total} />
      )}

      {activeTab === 'runway' && <RunwayCard />}
    </div>
  );
}
