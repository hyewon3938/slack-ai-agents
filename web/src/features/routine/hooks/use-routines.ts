'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTodayISO, addDays } from '@/lib/kst';
import type { RoutineTemplateRow, RoutineRecordRow, RoutineDayStat } from '@/lib/types';

export type RoutineView = 'checklist' | 'stats';

export function useRoutines() {
  const [view, setView] = useState<RoutineView>('checklist');
  const [selectedDate, setSelectedDate] = useState(getTodayISO);
  const [templates, setTemplates] = useState<RoutineTemplateRow[]>([]);
  const [records, setRecords] = useState<RoutineRecordRow[]>([]);
  const [stats, setStats] = useState<RoutineDayStat[]>([]);
  const [yearlyStats, setYearlyStats] = useState<RoutineDayStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RoutineTemplateRow | null>(null);
  const [editingRecord, setEditingRecord] = useState<RoutineRecordRow | null>(null);
  const mutatingRef = useRef(0);

  // ─── 데이터 페칭 ───────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    const res = await fetch('/api/routines');
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutineTemplateRow[] };
      setTemplates(data);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    const res = await fetch(`/api/routines/records?date=${selectedDate}`);
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutineRecordRow[] };
      if (mutatingRef.current === 0) setRecords(data);
    }
  }, [selectedDate]);

  const fetchStats = useCallback(async (from: string, to: string) => {
    const res = await fetch(`/api/routines/stats?from=${from}&to=${to}`);
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutineDayStat[] };
      setStats(data);
    }
  }, []);

  const fetchYearlyStats = useCallback(async () => {
    const today = getTodayISO();
    const from = addDays(today, -364);
    const res = await fetch(`/api/routines/stats?from=${from}&to=${today}`);
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutineDayStat[] };
      setYearlyStats(data);
    }
  }, []);

  const fetchData = useCallback(async () => {
    await Promise.all([fetchTemplates(), fetchRecords()]);
  }, [fetchTemplates, fetchRecords]);

  // 초기 로드
  useEffect(() => {
    Promise.all([fetchData(), fetchYearlyStats()]).finally(() => setLoading(false));
  }, [fetchData, fetchYearlyStats]);

  // 15초 폴링 (탭 활성 시)
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 15_000);
    return () => clearInterval(poll);
  }, [fetchData]);

  // ─── 날짜 네비게이션 ──────────────────────────────

  const handlePrevDate = useCallback(() => {
    setSelectedDate((d) => addDays(d, -1));
  }, []);
  const handleNextDate = useCallback(() => {
    setSelectedDate((d) => addDays(d, 1));
  }, []);
  const handleToday = useCallback(() => {
    setSelectedDate(getTodayISO());
  }, []);

  // ─── 템플릿 CRUD ──────────────────────────────────

  const handleCreateTemplate = useCallback(
    async (data: { name: string; time_slot: string | null; frequency: string | null }) => {
      const res = await fetch('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setShowForm(false);
        await fetchData();
      }
    },
    [fetchData],
  );

  const handleUpdateTemplate = useCallback(
    async (id: number, data: Record<string, unknown>) => {
      const res = await fetch(`/api/routines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditingTemplate(null);
        await fetchData();
      }
    },
    [fetchData],
  );

  const handleDeleteTemplate = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setEditingTemplate(null);
        await fetchData();
      }
    },
    [fetchData],
  );

  // ─── 기록 토글/메모 ────────────────────────────────

  const handleToggleRecord = useCallback(
    async (id: number, completed: boolean) => {
      // Optimistic update
      mutatingRef.current++;
      setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, completed } : r)));

      try {
        await fetch(`/api/routines/records/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed }),
        });
      } finally {
        mutatingRef.current--;
        await fetchRecords();
      }
    },
    [fetchRecords],
  );

  const handleUpdateMemo = useCallback(
    async (id: number, memo: string | null) => {
      await fetch(`/api/routines/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo }),
      });
      await fetchRecords();
    },
    [fetchRecords],
  );

  return {
    // state
    view, selectedDate, templates, records, stats, yearlyStats, loading,
    showForm, editingTemplate, editingRecord,
    // setters
    setView, setSelectedDate, setShowForm, setEditingTemplate, setEditingRecord,
    // date nav
    handlePrevDate, handleNextDate, handleToday,
    // templates
    handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate,
    // records
    handleToggleRecord, handleUpdateMemo,
    // stats
    fetchStats,
  };
}
