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
import { PlannedExpenseList } from './planned-expense-list';
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

type TopTab = 'manage' | 'runway' | 'settings';
type SubTab = 'list' | 'chart';

export function BudgetPage() {
  const {
    selectedMonth, setSelectedMonth,
    expenses, summary,
    loading, error,
    addExpense, deleteExpense, updateExpense,
  } = useBudget();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<TopTab>('manage');
  const [subTab, setSubTab] = useState<SubTab>('list');
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);

  const topTabs: { id: TopTab; label: string }[] = [
    { id: 'manage', label: '관리' },
    { id: 'runway', label: '분석' },
    { id: 'settings', label: '설정' },
  ];

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'list', label: '지출' },
    { id: 'chart', label: '카테고리' },
  ];

  return (
    <div className="flex flex-1 flex-col">
      {/* 상단 탭 바 */}
      <div className="border-b border-gray-200 bg-white px-4 pt-2">
        <div className="mx-auto flex max-w-2xl gap-1">
          {topTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTopTab(tab.id)}
              className={`rounded-t-lg px-4 py-2 text-xs font-medium transition ${
                topTab === tab.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'border-b-2 border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 관리 탭 */}
      {topTab === 'manage' && (
        <div className="mx-auto w-full max-w-2xl px-4 py-4">
          {/* 헤더: 월 네비게이터 */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">지출 관리</h2>
            <MonthNavigator selectedMonth={selectedMonth} onChange={setSelectedMonth} />
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* 월간 요약 (항상 표시) */}
          {loading ? (
            <div className="mb-4 space-y-3">
              <div className="h-52 animate-pulse rounded-xl bg-gray-100" />
            </div>
          ) : summary ? (
            <div className="mb-4">
              <MonthSummaryCard summary={summary} />
            </div>
          ) : null}

          {/* 예정 지출 */}
          <div className="mb-4">
            <PlannedExpenseList yearMonth={selectedMonth} />
          </div>

          {/* 지출 추가 폼 */}
          {subTab === 'list' && (
            <div className="mb-4">
              <ExpenseForm onAdd={addExpense} yearMonth={selectedMonth} />
            </div>
          )}

          {/* 서브 탭 */}
          <div className="mb-3 flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {subTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                  subTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 서브 탭 내용 */}
          {subTab === 'list' && (
            loading ? (
              <div className="space-y-px rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="h-9 bg-gray-50" />
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-14 animate-pulse bg-gray-50 border-t border-gray-100" />
                ))}
              </div>
            ) : (
              <ExpenseList
                expenses={expenses}
                onEdit={setEditingExpense}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
              />
            )
          )}

          {subTab === 'chart' && summary && (
            <CategoryChart stats={summary.by_category} total={summary.variable_total} />
          )}
        </div>
      )}

      {/* 분석 탭 */}
      {topTab === 'runway' && (
        <div className="mx-auto w-full max-w-2xl px-4 py-4">
          <RunwayCard />
        </div>
      )}

      {/* 설정 탭 */}
      {topTab === 'settings' && (
        <div className="mx-auto w-full max-w-2xl px-4 py-4">
          <BudgetSettingsPage />
        </div>
      )}

      {/* 수정 모달 */}
      {editingExpense && (
        <ExpenseEditModal
          expense={editingExpense}
          onSave={updateExpense}
          onDelete={deleteExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
