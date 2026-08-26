'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ExpenseRow, MonthSummary, AssetRow, FixedCostRow } from '@/features/budget/lib/types';
import { getCurrentBillingMonth, getBillingRange } from '@/features/budget/lib/billing/cycle';
import { getBillingMonthForExpense } from '@/features/budget/lib/billing/card-billing';

const FETCH_TIMEOUT_MS = 8000;

/** 타임아웃 포함 fetch wrapper */
async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function useBudget() {
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentBillingMonth(new Date()));
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expenseVersion, setExpenseVersion] = useState(0);

  const fetchJson = useCallback(async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }, []);

  interface RunwayResponse {
    free_per_month: number | null;
    dynamic_daily: number;
    month_budget_remaining: number;
    target_date: string | null;
    cycle_days: number;
    today_budget: number;
    today_recommended: number;
    today_flex_spent: number;
    today_remaining: number;
  }

  interface TodayV2Response {
    todayBudget: number;
    todayRecommended: number;
    todayRemaining: number;
    monthBudgetRemaining: number;
    todayFlexSpent: number;
    targetDate: string | null;
  }

  interface MonthlyV2Response {
    freePerMonth: number | null;
  }

  /** v2 today + monthly 응답을 RunwayResponse로 합성 */
  function buildRunwayFromV2(today: TodayV2Response, monthly: MonthlyV2Response): RunwayResponse {
    return {
      free_per_month: monthly.freePerMonth,
      dynamic_daily: today.todayRecommended,
      month_budget_remaining: today.monthBudgetRemaining,
      target_date: today.targetDate,
      cycle_days: 30,
      today_budget: today.todayBudget,
      today_recommended: today.todayRecommended,
      today_flex_spent: today.todayFlexSpent,
      today_remaining: today.todayRemaining,
    };
  }

  /** 런웨이 → 해당 월에 맞는 auto_budget/auto_daily 계산 */
  const applyAutoBudget = useCallback((sum: MonthSummary, rd: RunwayResponse, month: string) => {
    if (rd.free_per_month == null || !rd.target_date) return;

    const currentBilling = getCurrentBillingMonth(new Date());
    const [ty, tm] = rd.target_date.split('-').map(Number);
    const [sy, sm] = month.split('-').map(Number);
    const [cy, cm] = currentBilling.split('-').map(Number);
    const targetBilling = (ty - cy) * 12 + (tm - cm) + 1;
    const monthOffset = (sy - cy) * 12 + (sm - cm);

    if (monthOffset < 0 || monthOffset >= targetBilling) return;

    sum.auto_budget = rd.free_per_month;

    if (month === currentBilling) {
      sum.auto_daily = rd.dynamic_daily;
      sum.month_budget_remaining = rd.month_budget_remaining;
      sum.today_budget = rd.today_budget;
      sum.today_recommended = rd.today_recommended;
      sum.today_flex_spent = rd.today_flex_spent;
      sum.today_remaining = rd.today_remaining;
    } else {
      const { from, to } = getBillingRange(month);
      const cycFrom = new Date(`${from}T00:00:00`);
      const cycTo = new Date(`${to}T00:00:00`);
      const days = Math.round((cycTo.getTime() - cycFrom.getTime()) / 86400000) + 1;
      sum.auto_daily = days > 0 ? Math.round(rd.free_per_month / days) : null;
    }
  }, []);

  /** summary + 런웨이 재조회 (지출 추가/삭제/수정 후 호출) */
  const refreshBudget = useCallback(
    async (month: string) => {
      const [sumRes, todayRes, monthlyRes] = await Promise.all([
        fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
        fetchJson<{ data: TodayV2Response }>('/api/budget/today'),
        fetchJson<{ data: MonthlyV2Response }>('/api/budget/monthly'),
      ]);
      if (sumRes) {
        const updated = { ...sumRes.data };
        if (todayRes?.data && monthlyRes?.data) {
          applyAutoBudget(updated, buildRunwayFromV2(todayRes.data, monthlyRes.data), month);
        }
        setSummary(updated);
      }
    },
    [fetchJson, applyAutoBudget],
  );

  const fetchAll = useCallback(
    async (month: string) => {
      setLoading(true);
      setError(null);
      setExpenses([]);
      setSummary(null);
      try {
        // ── 1차: 핵심 데이터 (지출목록 + 요약 → 화면 즉시 표시) ──
        // billing_month 컬럼 기준 조회 → 카드별 대금기간(payment-methods.ts startDay) 자동 반영
        const [expData, sumData] = await Promise.all([
          fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?yearMonth=${month}`),
          fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
        ]);

        if (expData) setExpenses(expData.data);
        if (sumData) setSummary(sumData.data);

        if (!expData && !sumData) {
          // 둘 다 실패 시 1회 재시도
          const [retryExp, retrySum] = await Promise.all([
            fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?yearMonth=${month}`),
            fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
          ]);
          if (retryExp) setExpenses(retryExp.data);
          if (retrySum) setSummary(retrySum.data);
          if (!retryExp && !retrySum) setError('데이터 조회 실패 — 새로고침 해주세요');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '오류 발생');
      } finally {
        setLoading(false);
      }

      // ── 2차: 런웨이 + 보조 데이터 (로딩 해제 후 백그라운드) ──
      try {
        const [assetData, fixedData, todayData, monthlyData] = await Promise.all([
          fetchJson<{ data: AssetRow[] }>('/api/budget/assets'),
          fetchJson<{ data: FixedCostRow[] }>('/api/budget/fixed-costs'),
          fetchJson<{ data: TodayV2Response }>('/api/budget/today'),
          fetchJson<{ data: MonthlyV2Response }>('/api/budget/monthly'),
        ]);

        if (todayData?.data && monthlyData?.data) {
          const synthesized = buildRunwayFromV2(todayData.data, monthlyData.data);
          setSummary((prev) => {
            if (!prev) return prev;
            const updated = { ...prev };
            applyAutoBudget(updated, synthesized, month);
            return updated;
          });
        }
        if (assetData) setAssets(assetData.data);
        if (fixedData) setFixedCosts(fixedData.data);
      } catch {
        // 2차 실패는 무시 (핵심 데이터는 이미 표시됨)
      }
    },
    [fetchJson, applyAutoBudget],
  );

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
      installment_months?: number;
      exclude_from_budget?: boolean;
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
      const expBillingMonth = getBillingMonthForExpense(
        data.date,
        data.payment_method ?? '현대카드',
      );
      if (expBillingMonth === selectedMonth) {
        setExpenses((prev) => [newExpense, ...prev]);
        void refreshBudget(selectedMonth).catch(() => {});
      }
      setExpenseVersion((v) => v + 1);
      return newExpense;
    },
    [selectedMonth, refreshBudget],
  );

  const deleteExpense = useCallback(
    async (id: number): Promise<void> => {
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? '지출 삭제 실패');
      }
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      setExpenseVersion((v) => v + 1);
      void refreshBudget(selectedMonth).catch(() => {});
    },
    [selectedMonth, refreshBudget],
  );

  const updateExpense = useCallback(
    async (
      id: number,
      // 부분 수정 — 모달이 바뀐 필드만 보낸다 (#615)
      updates: {
        date?: string;
        amount?: number;
        category?: string;
        description?: string | null;
        exclude_from_budget?: boolean;
        planned_expense_id?: number | null;
      },
    ): Promise<void> => {
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
      setExpenseVersion((v) => v + 1);
      void refreshBudget(selectedMonth).catch(() => {});
    },
    [selectedMonth, refreshBudget],
  );

  const updateAssetBalance = useCallback(
    async (
      id: number,
      balance: number,
      available_amount: number,
      balanceAsOf?: string,
    ): Promise<void> => {
      const res = await fetch(`/api/budget/assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance, available_amount, balance_as_of: balanceAsOf }),
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
    expenseVersion,
    addExpense,
    deleteExpense,
    updateExpense,
    updateAssetBalance,
    refresh: () => void fetchAll(selectedMonth),
  };
}
