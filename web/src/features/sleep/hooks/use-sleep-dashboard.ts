'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTodayISO, addDays } from '@/lib/kst';
import type {
  SleepDashboardData,
  SleepPeriod,
  SleepRecordInput,
  SleepEventInput,
} from '../lib/types';

const PERIOD_DAYS: Record<SleepPeriod, number> = {
  '1w': 6,
  '2w': 13,
  '1m': 29,
};

/** mutation 실패 시 서버가 준 메시지를 최대한 살려서 반환 */
async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `요청 실패 (${res.status})`;
  } catch {
    return `요청 실패 (${res.status})`;
  }
}

export function useSleepDashboard(initialPeriod: SleepPeriod = '1w') {
  const [period, setPeriod] = useState<SleepPeriod>(initialPeriod);
  const [data, setData] = useState<SleepDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (p: SleepPeriod) => {
    setLoading(true);
    const to = getTodayISO();
    const from = addDays(to, -PERIOD_DAYS[p]);
    try {
      const res = await fetch(`/api/sleep/dashboard?from=${from}&to=${to}`, {
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.ok) {
        const { data: d } = (await res.json()) as { data: SleepDashboardData };
        setData(d);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  const handlePeriodChange = useCallback((p: SleepPeriod) => {
    setPeriod(p);
  }, []);

  const refetch = useCallback(async () => {
    await fetchData(period);
  }, [fetchData, period]);

  // ─── 수면 기록/이벤트 mutation ─────────────────────
  // 각 mutation은 성공 후 현재 기간을 재조회해 대시보드를 갱신한다.
  // 실패 시 throw → 폼이 에러 메시지를 표시한다.

  const createRecord = useCallback(
    async (input: SleepRecordInput) => {
      const res = await fetch('/api/sleep/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(await parseError(res));
      await fetchData(period);
    },
    [fetchData, period],
  );

  const updateRecord = useCallback(
    async (id: number, input: SleepRecordInput) => {
      const res = await fetch(`/api/sleep/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(await parseError(res));
      await fetchData(period);
    },
    [fetchData, period],
  );

  const deleteRecord = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/sleep/records/${id}`, { method: 'DELETE' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      // 404 = 이미 삭제됨 → 목표(사라짐) 달성이므로 성공으로 취급
      if (!res.ok && res.status !== 404) throw new Error(await parseError(res));
      await fetchData(period);
    },
    [fetchData, period],
  );

  const createEvent = useCallback(
    async (input: SleepEventInput) => {
      const res = await fetch('/api/sleep/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(await parseError(res));
      await fetchData(period);
    },
    [fetchData, period],
  );

  const deleteEvent = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/sleep/events/${id}`, { method: 'DELETE' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok && res.status !== 404) throw new Error(await parseError(res));
      await fetchData(period);
    },
    [fetchData, period],
  );

  return {
    period,
    data,
    loading,
    handlePeriodChange,
    refetch,
    createRecord,
    updateRecord,
    deleteRecord,
    createEvent,
    deleteEvent,
  };
}
