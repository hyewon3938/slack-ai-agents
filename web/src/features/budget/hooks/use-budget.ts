'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ExpenseRow, MonthSummary, AssetRow, FixedCostRow } from '@/features/budget/lib/types';

/** 현재 결제주기의 대금 월 반환. 16일 이후면 다음달 대금. */
function getCurrentBillingMonth(): string {
  const now = new Date();
  if (now.getDate() >= 16) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  return now.toISOString().slice(0, 7);
}

/**
 * 카드 결제주기 기준 날짜 범위 계산.
 * "N월" = 전월 16일 ~ 당월 15일.
 * 예: 2026-04 → 2026-03-16 ~ 2026-04-15
 */
function getBillingRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const from = `${prevYear}-${String(prevMonth).padStart(2, '0')}-16`;
  const to = `${year}-${String(month).padStart(2, '0')}-15`;
  return { from, to };
}

export function useBudget() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentBillingMonth);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    // 월 변경 시 이전 데이터 즉시 클리어
    setExpenses([]);
    setSummary(null);
    try {
      const { from, to } = getBillingRange(month);

      // 개별 요청 실패 시에도 나머지는 정상 처리 (DB 연결 불안정 대응)
      const fetchJson = async <T,>(url: string): Promise<T | null> => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return (await res.json()) as T;
        } catch {
          return null;
        }
      };

      const [expData, sumData, assetData, fixedData, runwayData] = await Promise.all([
        fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?from=${from}&to=${to}`),
        fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
        fetchJson<{ data: AssetRow[] }>('/api/budget/assets'),
        fetchJson<{ data: FixedCostRow[] }>('/api/budget/fixed-costs'),
        fetchJson<{ data: { free_per_month: number | null; dynamic_daily: number } }>('/api/budget/runway'),
      ]);

      // 핵심 데이터(지출, 요약) 실패 시 1회 재시도
      if (!expData || !sumData) {
        const [retryExp, retrySum] = await Promise.all([
          !expData ? fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?from=${from}&to=${to}`) : Promise.resolve(expData),
          !sumData ? fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`) : Promise.resolve(sumData),
        ]);
        if (retryExp) setExpenses(retryExp.data);
        if (retrySum) {
          const sum = retrySum.data;
          if (runwayData?.data.free_per_month != null) {
            sum.auto_budget = runwayData.data.free_per_month;
            sum.auto_daily = runwayData.data.dynamic_daily;
          }
          setSummary(sum);
        }
        if (!retryExp && !retrySum) setError('데이터 조회 실패 — 새로고침 해주세요');
      } else {
        setExpenses(expData.data);
        const sum = sumData.data;
        if (runwayData?.data.free_per_month != null) {
          sum.auto_budget = runwayData.data.free_per_month;
          sum.auto_daily = runwayData.data.dynamic_daily;
        }
        setSummary(sum);
      }

      if (assetData) setAssets(assetData.data);
      if (fixedData) setFixedCosts(fixedData.data);
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
      type?: 'expense' | 'income';
      planned_expense_id?: number | null;
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
      // 현재 보고 있는 결제주기에 해당하면 목록에 추가
      const { from, to } = getBillingRange(selectedMonth);
      if (data.date >= from && data.date <= to) {
        setExpenses((prev) => [newExpense, ...prev]);
        // 요약 재조회 (auto_budget/auto_daily 유지)
        void fetch(`/api/expenses/summary?yearMonth=${selectedMonth}`)
          .then((r) => r.json())
          .then((d: { data: MonthSummary }) =>
            setSummary((prev) => prev ? { ...d.data, auto_budget: prev.auto_budget, auto_daily: prev.auto_daily } : d.data),
          );
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
      .then((d: { data: MonthSummary }) =>
        setSummary((prev) => prev ? { ...d.data, auto_budget: prev.auto_budget, auto_daily: prev.auto_daily } : d.data),
      );
  }, [selectedMonth]);

  const updateExpense = useCallback(
    async (id: number, updates: { date: string; amount: number; category: string; description: string | null }): Promise<void> => {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? '지출 수정 실패');
      }
      const { data } = (await res.json()) as { data: ExpenseRow };
      setExpenses((prev) => prev.map((e) => (e.id === id ? data : e)));
      void fetch(`/api/expenses/summary?yearMonth=${selectedMonth}`)
        .then((r) => r.json())
        .then((d: { data: MonthSummary }) =>
          setSummary((prev) => prev ? { ...d.data, auto_budget: prev.auto_budget, auto_daily: prev.auto_daily } : d.data),
        );
    },
    [selectedMonth],
  );

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
    updateExpense,
    updateAssetBalance,
    refresh: () => void fetchAll(selectedMonth),
  };
}
