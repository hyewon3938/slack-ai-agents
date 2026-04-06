'use client';

import { useState } from 'react';
import { useBudget } from '@/features/budget/hooks/use-budget';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { MonthSummaryCard } from './month-summary';
import { ExpenseForm } from './expense-form';
import { ExpenseList } from './expense-list';
import { ExpenseEditModal } from './expense-edit-modal';
import { CategoryChart } from './category-chart';
import { RunwayCard } from './runway-card';
import { BudgetSettingsPage } from './budget-settings-page';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';

/** 결제주기 날짜 범위 계산 (표시용) */
function getBillingRangeLabel(yearMonth: string): string {
  const [, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevMonth}/16~${month}/15`;
}

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
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-2">
        <button onClick={prev} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ChevronLeftIcon size={18} />
        </button>
        <span className="min-w-[80px] text-center text-sm font-semibold text-gray-800">
          {month}월 대금
        </span>
        <button
          onClick={next}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>
      <span className="text-[10px] text-gray-400">{getBillingRangeLabel(selectedMonth)}</span>
    </div>
  );
}

type TabId = 'list' | 'chart' | 'runway' | 'settings';

export function BudgetPage() {
  const {
    selectedMonth, setSelectedMonth,
    expenses, summary,
    loading, error,
    addExpense, deleteExpense, updateExpense,
  } = useBudget();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('list');
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'list', label: '지출' },
    { id: 'chart', label: '카테고리' },
    { id: 'runway', label: '분석' },
    { id: 'settings', label: '설정' },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900">지출 관리</h1>
        {activeTab !== 'settings' && (
          <MonthNavigator selectedMonth={selectedMonth} onChange={setSelectedMonth} />
        )}
      </div>

      {error && activeTab !== 'settings' && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* 설정이 아닌 탭에서만 월간 요약 + 지출 폼 표시 */}
      {activeTab !== 'settings' && activeTab !== 'runway' && (
        <>
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
        </>
      )}

      {/* 탭 */}
      <div className="mb-3 flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 내용 */}
      {activeTab === 'list' && (
        loading ? (
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <ExpenseList
            expenses={expenses}
            onDelete={deleteExpense}
            onEdit={setEditingExpense}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
          />
        )
      )}

      {activeTab === 'chart' && summary && (
        <CategoryChart stats={summary.by_category} total={summary.variable_total} />
      )}

      {activeTab === 'runway' && <RunwayCard />}

      {activeTab === 'settings' && <BudgetSettingsPage />}

      {/* 수정 모달 */}
      {editingExpense && (
        <ExpenseEditModal
          expense={editingExpense}
          onSave={updateExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
