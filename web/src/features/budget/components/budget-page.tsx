'use client';

import { useState } from 'react';
import { useBudget } from '@/features/budget/hooks/use-budget';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { MonthSummaryCard } from './month-summary';
import { ExpenseForm } from './expense-form';
import { ExpenseList } from './expense-list';
import { ExpenseEditModal } from './expense-edit-modal';
import { IncomeEditModal } from './income-edit-modal';
import { CategoryChart } from './category-chart';
import { DailyBudgetLogView } from './daily-budget-log';
import { RunwayCard } from './runway-card';
import { BudgetSettingsPage } from './budget-settings-page';
import { PlannedExpenseList } from './planned-expense-list';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { TopTabs, PillTabs } from '@/components/ui/tabs';
import { TabsSkeleton, CardSkeleton, ListSkeleton } from '@/components/ui/skeleton';

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
type SubTab = 'list' | 'daily' | 'chart';

const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: 'manage', label: '관리' },
  { id: 'runway', label: '분석' },
  { id: 'settings', label: '설정' },
];

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'list', label: '지출' },
  { id: 'daily', label: '일별 현황' },
  { id: 'chart', label: '카테고리' },
];

export function BudgetPage() {
  const {
    selectedMonth, setSelectedMonth,
    expenses, summary,
    loading, error,
    addExpense, deleteExpense, updateExpense,
    refresh,
  } = useBudget();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<TopTab>('manage');
  const [subTab, setSubTab] = useState<SubTab>('list');
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);

  return (
    <div className="flex flex-1 flex-col">
      {/* 상단 탭 바 */}
      <TopTabs tabs={TOP_TABS} active={topTab} onChange={setTopTab} maxWidth="max-w-2xl" />

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
            <div className="mb-4">
              <CardSkeleton className="h-52" />
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
          <PillTabs tabs={SUB_TABS} active={subTab} onChange={setSubTab} className="mb-3" />

          {/* 서브 탭 내용 */}
          {subTab === 'list' && (
            loading ? (
              <ListSkeleton rows={6} rowHeight="h-14" />
            ) : (
              <ExpenseList
                expenses={expenses}
                onEdit={setEditingExpense}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
              />
            )
          )}

          {subTab === 'daily' && (
            <DailyBudgetLogView
              yearMonth={selectedMonth}
              todayBudget={summary?.today_budget ?? null}
            />
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
          <BudgetSettingsPage onSettingsChange={refresh} />
        </div>
      )}

      {/* 수정 모달: 수입/지출 타입에 따라 분기 */}
      {editingExpense && editingExpense.type === 'income' && (
        <IncomeEditModal
          income={editingExpense}
          onSave={updateExpense}
          onDelete={deleteExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
      {editingExpense && editingExpense.type !== 'income' && (
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
