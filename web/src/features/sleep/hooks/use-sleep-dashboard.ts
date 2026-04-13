'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTodayISO, addDays } from '@/lib/kst';
import type { SleepDashboardData, SleepPeriod } from '../lib/types';

const PERIOD_DAYS: Record<SleepPeriod, number> = {
  '1w': 6,
  '2w': 13,
  '1m': 29,
};

export function useSleepDashboard() {
  const [period, setPeriod] = useState<SleepPeriod>('1m');
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
      if (res.status === 401) { window.location.href = '/login'; return; }
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

  return { period, data, loading, handlePeriodChange };
}
