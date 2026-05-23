'use client';

import { useState } from 'react';
import { useBudget } from '@/features/budget/hooks/use-budget';
import type { ExpenseRow } from '@/features/budget/lib/types';
import { MonthSummaryCard } from '@/features/budget/components/month-summary';
import { ExpenseForm } from '@/features/budget/components/expense-form';
import { ExpenseList, type TypeFilter } from '@/features/budget/components/expense-list';
import { ExpenseEditModal } from '@/features/budget/components/expense-edit-modal';
import { IncomeEditModal } from '@/features/budget/components/income-edit-modal';
import { CategoryChart } from '@/features/budget/components/category-chart';
import { DailyBudgetLogView } from '@/features/budget/components/daily-budget-log';
import { PlannedExpenseList } from '@/features/budget/components/planned-expense-list';
import { CategoryLimitTracker } from '@/features/budget/components/category-limit-tracker';
import { MonthNavigator } from '@/features/budget/components/month-navigator';
import { PillTabs } from '@/components/ui/tabs';
import { CardSkeleton, ListSkeleton } from '@/components/ui/skeleton';

type SubTab = 'list' | 'daily' | 'chart';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'list', label: '지출' },
  { id: 'daily', label: '일별 현황' },
  { id: 'chart', label: '카테고리' },
];

export default function ManagePage() {
  const {
    selectedMonth,
    setSelectedMonth,
    expenses,
    summary,
    loading,
    error,
    expenseVersion,
    addExpense,
    deleteExpense,
    updateExpense,
  } = useBudget();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<TypeFilter>('all');
  const [subTab, setSubTab] = useState<SubTab>('list');
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);

  const handleTypeChange = (t: TypeFilter) => {
    setSelectedType(t);
    setSelectedCategory(null); // 다른 type의 카테고리 잔존 방지
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      {/* 헤더: 월 네비게이터 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">지출 관리</h2>
        <MonthNavigator selectedMonth={selectedMonth} onChange={setSelectedMonth} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* 월간 요약 */}
      {loading ? (
        <div className="mb-4">
          <CardSkeleton className="h-52" />
        </div>
      ) : summary ? (
        <div className="mb-4">
          <MonthSummaryCard summary={summary} />
        </div>
      ) : null}

      {/* 카테고리 한도 트래커 */}
      <div className="mb-4">
        <CategoryLimitTracker yearMonth={selectedMonth} refreshTrigger={expenseVersion} />
      </div>

      {/* 예정 지출 */}
      <div className="mb-4">
        <PlannedExpenseList yearMonth={selectedMonth} refreshTrigger={expenseVersion} />
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
      {subTab === 'list' &&
        (loading ? (
          <ListSkeleton rows={6} rowHeight="h-14" />
        ) : (
          <ExpenseList
            expenses={expenses}
            onEdit={setEditingExpense}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedType={selectedType}
            onTypeChange={handleTypeChange}
          />
        ))}

      {subTab === 'daily' && (
        <DailyBudgetLogView yearMonth={selectedMonth} todayBudget={summary?.today_budget ?? null} />
      )}

      {subTab === 'chart' && summary && (
        <CategoryChart stats={summary.by_category} total={summary.variable_total} />
      )}

      {/* 수정 모달 */}
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
          yearMonth={selectedMonth}
          onSave={updateExpense}
          onDelete={deleteExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
