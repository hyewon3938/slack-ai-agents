'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import type { ScheduleRow } from '@/features/schedule/lib/types';
import { lookupCategory } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';
import type { CalendarView } from '@/features/schedule/components/calendar-header';
import { WEEK_START } from '@/features/schedule/lib/calendar-utils';

function getInitialView(): CalendarView {
  if (typeof window === 'undefined') return 'day';
  return window.innerWidth >= 768 ? 'week' : 'day';
}

export function useSchedules(initialView?: CalendarView) {
  const [view, setView] = useState<CalendarView>(initialView ?? getInitialView);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // 카테고리 필터: 최상위 id 기준
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());
  // 하위 카테고리 필터: child id 기준
  const [selectedSubcategories, setSelectedSubcategories] = useState<Set<number>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const mutatingRef = useRef(0);

  const getDateRange = useCallback((): { from: string; to: string } => {
    let start: Date;
    let end: Date;

    switch (view) {
      case 'month':
        start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: WEEK_START });
        end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: WEEK_START });
        break;
      case 'week':
        start = startOfWeek(currentDate, { weekStartsOn: WEEK_START });
        end = endOfWeek(currentDate, { weekStartsOn: WEEK_START });
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
        if (mutatingRef.current === 0) setSchedules(data.data);
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

    // 15초 폴링 (탭이 보이는 동안만)
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }, 15_000);

    // 탭 복귀 시 날짜가 바뀌었으면 currentDate 갱신
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = new Date();
      if (format(now, 'yyyy-MM-dd') !== format(currentDate, 'yyyy-MM-dd')) {
        setCurrentDate(now);
        setSelectedDate(null);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData]);

  // 필터링: 최상위 카테고리 id 단위로 매칭, 하위 선택 시 child id로 매칭
  const filteredSchedules = useMemo(
    () =>
      schedules.filter((s) => {
        if (selectedStatuses.size > 0 && !selectedStatuses.has(s.status)) {
          return false;
        }
        if (selectedCategories.size > 0) {
          const lookup = lookupCategory(categories, s.category_id);
          const topId = lookup.topId;
          if (topId == null || !selectedCategories.has(topId)) return false;
          // 하위카테고리 필터: 같은 parent에서 child 선택이 있으면 그 child만 포함
          if (selectedSubcategories.size > 0) {
            const childIds = categories.filter((c) => c.parent_id === topId).map((c) => c.id);
            const activeForParent = childIds.filter((id) => selectedSubcategories.has(id));
            if (activeForParent.length > 0) {
              if (s.category_id == null || !selectedSubcategories.has(s.category_id)) {
                return false;
              }
            }
          }
        }
        return true;
      }),
    [schedules, selectedCategories, selectedSubcategories, selectedStatuses, categories],
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
    const prev = schedules;
    setSchedules((s) => s.map((item) => (item.id === id ? { ...item, status } : item)));
    mutatingRef.current++;
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setSchedules(prev);
        alert('상태 변경에 실패했어');
      }
    } catch {
      setSchedules(prev);
      alert('상태 변경에 실패했어');
    } finally {
      mutatingRef.current--;
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
        setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, date: newDate } : s)));
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
        setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, end_date: endDate } : s)));
      }
    } catch {
      // ignore
    }
  };

  const handleToggleImportant = async (id: number) => {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) return;
    const newImportant = !schedule.important;
    const prev = schedules;
    setSchedules((s) =>
      s.map((item) => (item.id === id ? { ...item, important: newImportant } : item)),
    );
    mutatingRef.current++;
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ important: newImportant }),
      });
      if (!res.ok) {
        setSchedules(prev);
        alert('중요 설정 변경에 실패했어');
      }
    } catch {
      setSchedules(prev);
      alert('중요 설정 변경에 실패했어');
    } finally {
      mutatingRef.current--;
    }
  };

  const handlePostpone = async (id: number) => {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule?.date) return;
    const next = format(addDays(new Date(schedule.date + 'T12:00:00'), 1), 'yyyy-MM-dd');
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: next, end_date: null }),
      });
      if (res.ok) await fetchData();
    } catch {
      // ignore
    }
  };

  const handleMoveToBacklog = async (id: number) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: null, end_date: null }),
      });
      if (res.ok) await fetchData();
    } catch {
      // ignore
    }
  };

  const handleDeleteById = async (id: number) => {
    if (!confirm('이 일정을 삭제할까?')) return;
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) await fetchData();
    } catch {
      alert('삭제에 실패했어');
    }
  };

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr === selectedDate ? null : dateStr);
  };

  /** 최상위 카테고리 id 토글. 해제 시 같은 부모의 자식 선택도 함께 정리 */
  const toggleCategory = (topId: number) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(topId)) {
        next.delete(topId);
        const childIds = categories.filter((c) => c.parent_id === topId).map((c) => c.id);
        setSelectedSubcategories((prev) => {
          const nextSub = new Set(prev);
          childIds.forEach((id) => nextSub.delete(id));
          return nextSub;
        });
      } else {
        next.add(topId);
      }
      return next;
    });
  };

  /** 하위 카테고리 id 토글 */
  const toggleSubcategory = (childId: number) => {
    setSelectedSubcategories((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
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
    setSelectedSubcategories(new Set());
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
    selectedSubcategories,
    selectedStatuses,
    loading,
    filteredSchedules,
    handlePrev,
    handleNext,
    handleToday,
    handleStatusChange,
    handleToggleImportant,
    handleDateChange,
    handleEndDateChange,
    handleCreate,
    handleUpdate,
    handleDelete,
    handlePostpone,
    handleMoveToBacklog,
    handleDeleteById,
    handleSelectDate,
    toggleCategory,
    toggleSubcategory,
    toggleStatus,
    clearFilters,
  };
}
