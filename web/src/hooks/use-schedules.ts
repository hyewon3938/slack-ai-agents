'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import type { CalendarView } from '@/components/calendar/calendar-header';

export function useSchedules() {
  const [view, setView] = useState<CalendarView>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const getDateRange = useCallback((): { from: string; to: string } => {
    let start: Date;
    let end: Date;

    switch (view) {
      case 'month':
        start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
        end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
        break;
      case 'week':
        start = startOfWeek(currentDate, { weekStartsOn: 0 });
        end = endOfWeek(currentDate, { weekStartsOn: 0 });
        break;
      case 'day':
        start = currentDate;
        end = currentDate;
        break;
    }

    return {
      from: format(start, 'yyyy-MM-dd'),
      to: format(end, 'yyyy-MM-dd'),
    };
  }, [view, currentDate]);

  const fetchData = useCallback(async () => {
    const { from, to } = getDateRange();
    try {
      const [schedulesRes, categoriesRes] = await Promise.all([
        fetch(`/api/schedules?from=${from}&to=${to}`),
        fetch('/api/categories'),
      ]);

      if (schedulesRes.status === 401 || categoriesRes.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (schedulesRes.ok) {
        const data = (await schedulesRes.json()) as { data: ScheduleRow[] };
        setSchedules(data.data);
      }
      if (categoriesRes.ok) {
        const data = (await categoriesRes.json()) as { data: CategoryRow[] };
        setCategories(data.data);
      }
    } catch {
      // 네트워크 에러 무시
    } finally {
      setLoading(false);
    }
  }, [getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 필터링
  const filteredSchedules = useMemo(
    () =>
      schedules.filter((s) => {
        if (selectedCategories.size > 0 && !selectedCategories.has(s.category ?? '미분류')) {
          return false;
        }
        if (selectedStatuses.size > 0 && !selectedStatuses.has(s.status)) {
          return false;
        }
        return true;
      }),
    [schedules, selectedCategories, selectedStatuses],
  );

  // 네비게이션
  const handlePrev = () => {
    switch (view) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(subDays(currentDate, 1));
        break;
    }
    setSelectedDate(null);
  };

  const handleNext = () => {
    switch (view) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(addDays(currentDate, 1));
        break;
    }
    setSelectedDate(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
  };

  // CRUD
  const handleStatusChange = async (id: number, status: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
      }
    } catch {
      // ignore
    }
  };

  const handleCreate = async (data: Partial<ScheduleRow>) => {
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      alert('일정 생성에 실패했어');
    }
  };

  const handleUpdate = async (data: Partial<ScheduleRow>) => {
    if (!editingSchedule) return;
    try {
      const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      alert('일정 수정에 실패했어');
    }
  };

  const handleDelete = async () => {
    if (!editingSchedule) return;
    try {
      const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setEditingSchedule(null);
        await fetchData();
      }
    } catch {
      alert('일정 삭제에 실패했어');
    }
  };

  const handleDateChange = async (id: number, newDate: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate }),
      });
      if (res.ok) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, date: newDate } : s)),
        );
      }
    } catch {
      // ignore
    }
  };

  const handleEndDateChange = async (id: number, endDate: string | null) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_date: endDate || null }),
      });
      if (res.ok) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, end_date: endDate } : s)),
        );
      }
    } catch {
      // ignore
    }
  };

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr === selectedDate ? null : dateStr);
  };

  const toggleCategory = (name: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedCategories(new Set());
    setSelectedStatuses(new Set());
  };

  return {
    view,
    setView,
    currentDate,
    categories,
    selectedDate,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    selectedCategories,
    selectedStatuses,
    loading,
    filteredSchedules,
    handlePrev,
    handleNext,
    handleToday,
    handleStatusChange,
    handleDateChange,
    handleEndDateChange,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleSelectDate,
    toggleCategory,
    toggleStatus,
    clearFilters,
  };
}
