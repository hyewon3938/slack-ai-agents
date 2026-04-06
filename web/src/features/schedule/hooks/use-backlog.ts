'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';

export function useBacklog() {
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [schedulesRes, categoriesRes] = await Promise.all([
        fetch('/api/schedules?backlog=true'),
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
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // 카테고리별 그룹핑
  const grouped = new Map<string, ScheduleRow[]>();
  for (const s of schedules) {
    const cat = s.category ?? '미분류';
    const list = grouped.get(cat) ?? [];
    list.push(s);
    grouped.set(cat, list);
  }

  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    const catA = categories.find((c) => c.name === a);
    const catB = categories.find((c) => c.name === b);
    return (catA?.sort_order ?? 999) - (catB?.sort_order ?? 999);
  });

  const handleAssignDate = async (id: number, date: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, status: 'todo' }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      alert('날짜 지정에 실패했어');
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
        setEditingSchedule(null);
        await fetchData();
      }
    } catch {
      alert('일정 수정에 실패했어');
    }
  };

  const handleDelete = async () => {
    if (!editingSchedule) return;
    try {
      const res = await fetch(`/api/schedules/${editingSchedule.id}`, { method: 'DELETE' });
      if (res.ok) {
        setEditingSchedule(null);
        await fetchData();
      }
    } catch {
      alert('일정 삭제에 실패했어');
    }
  };

  const handleCreate = async (data: Partial<ScheduleRow>) => {
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, date: null }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      alert('일정 생성에 실패했어');
    }
  };

  return {
    schedules,
    categories,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    loading,
    grouped,
    sortedCategories,
    handleAssignDate,
    handleUpdate,
    handleDelete,
    handleCreate,
  };
}
