'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ExpenseRow, MonthSummary, AssetRow, FixedCostRow } from '@/features/budget/lib/types';

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

  const fetchJson = useCallback(async <T,>(url: string): Promise<T | null> => {
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
    today_flex_spent: number;
    today_remaining: number;
  }

  /** 런웨이 → 해당 월에 맞는 auto_budget/auto_daily 계산 */
  const applyAutoBudget = useCallback((sum: MonthSummary, rd: RunwayResponse, month: string) => {
    if (rd.free_per_month == null || !rd.target_date) return;

    const currentBilling = getCurrentBillingMonth();
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
      sum.today_flex_spent = rd.today_flex_spent;
      sum.today_remaining = rd.today_remaining;
    } else {
      const [year, mon] = month.split('-').map(Number);
      const prevMon = mon === 1 ? 12 : mon - 1;
      const prevYear = mon === 1 ? year - 1 : year;
      const cycFrom = new Date(`${prevYear}-${String(prevMon).padStart(2, '0')}-16T00:00:00`);
      const cycTo = new Date(`${year}-${String(mon).padStart(2, '0')}-15T00:00:00`);
      const days = Math.round((cycTo.getTime() - cycFrom.getTime()) / 86400000) + 1;
      sum.auto_daily = days > 0 ? Math.round(rd.free_per_month / days) : null;
    }
  }, []);

  /** summary + 런웨이 재조회 (지출 추가/삭제/수정 후 호출) */
  const refreshBudget = useCallback(async (month: string) => {
    const [sumRes, runwayRes] = await Promise.all([
      fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
      fetchJson<{ data: RunwayResponse }>('/api/budget/runway'),
    ]);
    if (sumRes) {
      const updated = { ...sumRes.data };
      if (runwayRes?.data) applyAutoBudget(updated, runwayRes.data, month);
      setSummary(updated);
    }
  }, [fetchJson, applyAutoBudget]);

  const fetchAll = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    setExpenses([]);
    setSummary(null);
    try {
      const { from, to } = getBillingRange(month);

      // ── 1차: 핵심 데이터 (지출목록 + 요약 → 화면 즉시 표시) ──
      const [expData, sumData] = await Promise.all([
        fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?from=${from}&to=${to}`),
        fetchJson<{ data: MonthSummary }>(`/api/expenses/summary?yearMonth=${month}`),
      ]);

      if (expData) setExpenses(expData.data);
      if (sumData) setSummary(sumData.data);

      if (!expData && !sumData) {
        // 둘 다 실패 시 1회 재시도
        const [retryExp, retrySum] = await Promise.all([
          fetchJson<{ data: ExpenseRow[] }>(`/api/expenses?from=${from}&to=${to}`),
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
      const [assetData, fixedData, runwayData] = await Promise.all([
        fetchJson<{ data: AssetRow[] }>('/api/budget/assets'),
        fetchJson<{ data: FixedCostRow[] }>('/api/budget/fixed-costs'),
        fetchJson<{ data: RunwayResponse }>('/api/budget/runway'),
      ]);

      if (runwayData?.data) {
        setSummary((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          applyAutoBudget(updated, runwayData.data, month);
          return updated;
        });
      }
      if (assetData) setAssets(assetData.data);
      if (fixedData) setFixedCosts(fixedData.data);
    } catch {
      // 2차 실패는 무시 (핵심 데이터는 이미 표시됨)
    }
  }, [fetchJson, applyAutoBudget]);

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
        void refreshBudget(selectedMonth).catch(() => {});
      }
      return newExpense;
    },
    [selectedMonth, refreshBudget],
  );

  const deleteExpense = useCallback(async (id: number): Promise<void> => {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? '지출 삭제 실패');
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    void refreshBudget(selectedMonth).catch(() => {});
  }, [selectedMonth, refreshBudget]);

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
      void refreshBudget(selectedMonth).catch(() => {});
    },
    [selectedMonth, refreshBudget],
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
