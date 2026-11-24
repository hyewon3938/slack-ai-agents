'use client';

/** 캘린더 화면의 일정 조회·폴링과 생성·수정·삭제를 맡고, 날짜 이동·필터·내비게이션 훅을 묶어 돌려준다. */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import type { DeleteReason } from '@/features/schedule/lib/delete-reasons';
import type { CategoryRow } from '@/lib/types';
import type { CalendarView } from '@/features/schedule/components/calendar-header';
import { useCalendarNavigation } from '@/features/schedule/hooks/use-calendar-navigation';
import { useScheduleFilters } from '@/features/schedule/hooks/use-schedule-filters';
import { useScheduleMoves } from '@/features/schedule/hooks/use-schedule-moves';
import { sendJson } from '@/lib/send-json';

export function useSchedules(initialView?: CalendarView) {
  const navigation = useCalendarNavigation(initialView);
  const { range } = navigation;
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // 삭제 사유 모달 대상 일정 id — null이면 모달 닫힘 (#590)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const mutatingRef = useRef(0);

  const fetchData = useCallback(async () => {
    const { from, to } = range;
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
  }, [range]);

  useEffect(() => {
    fetchData();

    // 15초 폴링 (탭이 보이는 동안만)
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }, 15_000);

    return () => clearInterval(id);
  }, [fetchData]);

  const filters = useScheduleFilters(schedules, categories);
  const moves = useScheduleMoves({ schedules, setSchedules, mutatingRef, fetchData });

  // CRUD
  const handleStatusChange = async (id: number, status: string) => {
    const prev = schedules;
    setSchedules((s) => s.map((item) => (item.id === id ? { ...item, status } : item)));
    mutatingRef.current++;
    try {
      const res = await sendJson(`/api/schedules/${id}`, 'PATCH', { status });
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
      const res = await sendJson('/api/schedules', 'POST', data);
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
      const res = await sendJson(`/api/schedules/${editingSchedule.id}`, 'PATCH', data);
      if (res.ok) {
        await fetchData();
      }
    } catch {
      alert('일정 수정에 실패했어');
    }
  };

  /** 삭제 요청 — 사유 모달을 연다. 실제 삭제는 confirmDelete가 수행 */
  const requestDelete = (id: number) => setDeleteTarget(id);

  /** 사유 모달 확정 — 사유를 body에 담아 삭제 (API가 tombstone 사유 enrichment까지 수행) */
  const confirmDelete = async (reason: DeleteReason) => {
    if (deleteTarget === null) return;
    try {
      const res = await sendJson(`/api/schedules/${deleteTarget}`, 'DELETE', {
        reason_category: reason.category,
        reason_text: reason.text,
      });
      if (res.ok) {
        if (editingSchedule?.id === deleteTarget) setEditingSchedule(null);
        setDeleteTarget(null);
        await fetchData();
      } else {
        alert('일정 삭제에 실패했어');
      }
    } catch {
      alert('일정 삭제에 실패했어');
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
      const res = await sendJson(`/api/schedules/${id}`, 'PATCH', { important: newImportant });
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

  return {
    view: navigation.view,
    setView: navigation.setView,
    currentDate: navigation.currentDate,
    categories,
    selectedDate: navigation.selectedDate,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    selectedCategories: filters.selectedCategories,
    selectedSubcategories: filters.selectedSubcategories,
    selectedStatuses: filters.selectedStatuses,
    loading,
    filteredSchedules: filters.filteredSchedules,
    handlePrev: navigation.handlePrev,
    handleNext: navigation.handleNext,
    handleToday: navigation.handleToday,
    handleStatusChange,
    handleToggleImportant,
    handleMove: moves.handleMove,
    undoLastMove: moves.undoLastMove,
    toast: moves.toast,
    dismissToast: moves.dismissToast,
    handleCreate,
    handleUpdate,
    handlePostpone: moves.handlePostpone,
    handleMoveToBacklog: moves.handleMoveToBacklog,
    deleteTarget,
    setDeleteTarget,
    requestDelete,
    confirmDelete,
    handleSelectDate: navigation.handleSelectDate,
    toggleCategory: filters.toggleCategory,
    toggleSubcategory: filters.toggleSubcategory,
    toggleStatus: filters.toggleStatus,
    clearFilters: filters.clearFilters,
  };
}
