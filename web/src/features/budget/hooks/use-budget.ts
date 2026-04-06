'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ExpenseRow, MonthSummary, AssetRow, FixedCostRow } from '@/features/budget/lib/types';

function getCurrentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function getMonthRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const from = `${yearMonth}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10);
  return { from, to };
}

export function useBudget() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getMonthRange(month);
      const [expensesRes, summaryRes, assetsRes, fixedRes] = await Promise.all([
        fetch(`/api/expenses?from=${from}&to=${to}`),
        fetch(`/api/expenses/summary?yearMonth=${month}`),
        fetch('/api/budget/assets'),
        fetch('/api/budget/fixed-costs'),
      ]);

      if (!expensesRes.ok || !summaryRes.ok || !assetsRes.ok || !fixedRes.ok) {
        throw new Error('데이터 조회 실패');
      }

      const [expData, sumData, assetData, fixedData] = await Promise.all([
        expensesRes.json() as Promise<{ data: ExpenseRow[] }>,
        summaryRes.json() as Promise<{ data: MonthSummary }>,
        assetsRes.json() as Promise<{ data: AssetRow[] }>,
        fixedRes.json() as Promise<{ data: FixedCostRow[] }>,
      ]);

      setExpenses(expData.data);
      setSummary(sumData.data);
      setAssets(assetData.data);
      setFixedCosts(fixedData.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll(selectedMonth);
  }, [selectedMonth, fetchAll]);

  const addExpense = useCallback(
    async (data: {
      date: string;
      amount: number;
      category: string;
      description?: string | null;
      payment_method?: string;
    }): Promise<ExpenseRow> => {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? '지출 추가 실패');
      }
      const { data: newExpense } = (await res.json()) as { data: ExpenseRow };
      // 현재 보고 있는 달이면 목록에 추가
      if (data.date.startsWith(selectedMonth)) {
        setExpenses((prev) => [newExpense, ...prev]);
        // 요약 재조회
        void fetch(`/api/expenses/summary?yearMonth=${selectedMonth}`)
          .then((r) => r.json())
          .then((d: { data: MonthSummary }) => setSummary(d.data));
      }
      return newExpense;
    },
    [selectedMonth],
  );

  const deleteExpense = useCallback(async (id: number): Promise<void> => {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? '지출 삭제 실패');
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    void fetch(`/api/expenses/summary?yearMonth=${selectedMonth}`)
      .then((r) => r.json())
      .then((d: { data: MonthSummary }) => setSummary(d.data));
  }, [selectedMonth]);

  const updateAssetBalance = useCallback(
    async (id: number, balance: number, available_amount: number): Promise<void> => {
      const res = await fetch(`/api/budget/assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance, available_amount }),
      });
      if (!res.ok) throw new Error('자산 수정 실패');
      const { data } = (await res.json()) as { data: AssetRow };
      setAssets((prev) => prev.map((a) => (a.id === id ? data : a)));
    },
    [],
  );

  return {
    selectedMonth,
    setSelectedMonth,
    expenses,
    summary,
    assets,
    fixedCosts,
    loading,
    error,
    addExpense,
    deleteExpense,
    updateAssetBalance,
    refresh: () => void fetchAll(selectedMonth),
  };
}
