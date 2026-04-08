'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RoutineInactivePeriod } from '@/features/routine/lib/types';

interface InactivePeriodListProps {
  templateId: number;
}

export function InactivePeriodList({ templateId }: InactivePeriodListProps) {
  const [periods, setPeriods] = useState<RoutineInactivePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchPeriods = useCallback(async () => {
    const res = await fetch(`/api/routines/${templateId}/inactive-periods`);
    if (res.ok) {
      const { data } = (await res.json()) as { data: RoutineInactivePeriod[] };
      setPeriods(data);
    }
  }, [templateId]);

  useEffect(() => {
    fetchPeriods().finally(() => setLoading(false));
  }, [fetchPeriods]);

  const handleCreate = async (startDate: string, endDate: string | null) => {
    const res = await fetch(`/api/routines/${templateId}/inactive-periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate }),
    });
    if (res.ok) {
      setAdding(false);
      await fetchPeriods();
    }
  };

  const handleUpdate = async (periodId: number, startDate: string, endDate: string | null) => {
    const res = await fetch(`/api/routines/${templateId}/inactive-periods/${periodId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate }),
    });
    if (res.ok) {
      setEditingId(null);
      await fetchPeriods();
    }
  };

  const handleDelete = async (periodId: number) => {
    if (!confirm('이 비활성 기간을 삭제할까?')) return;
    const res = await fetch(`/api/routines/${templateId}/inactive-periods/${periodId}`, {
      method: 'DELETE',
    });
    if (res.ok) await fetchPeriods();
  };

  if (loading) return <div className="h-6 animate-pulse rounded bg-gray-100" />;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">비활성 기간</label>
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          + 추가
        </button>
      </div>

      {periods.length === 0 && !adding && (
        <p className="text-xs text-gray-400">설정된 비활성 기간이 없어</p>
      )}

      <div className="space-y-2">
        {periods.map((p) =>
          editingId === p.id ? (
            <PeriodForm
              key={p.id}
              defaultStart={p.start_date}
              defaultEnd={p.end_date}
              onSave={(s, e) => handleUpdate(p.id, s, e)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
            >
              <span className="flex-1 text-gray-700">
                {p.start_date} ~ {p.end_date ?? '진행 중'}
              </span>
              <button
                onClick={() => setEditingId(p.id)}
                className="text-xs text-gray-400 hover:text-blue-500"
              >
                수정
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                삭제
              </button>
            </div>
          ),
        )}
        {adding && (
          <PeriodForm
            onSave={handleCreate}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  );
}

interface PeriodFormProps {
  defaultStart?: string;
  defaultEnd?: string | null;
  onSave: (start: string, end: string | null) => void;
  onCancel: () => void;
}

function PeriodForm({ defaultStart, defaultEnd, onSave, onCancel }: PeriodFormProps) {
  const [start, setStart] = useState(defaultStart ?? '');
  const [end, setEnd] = useState(defaultEnd ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <span className="text-xs text-gray-400">~</span>
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        placeholder="진행 중"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        onClick={() => onSave(start, end || null)}
        disabled={!start}
        className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
      >
        저장
      </button>
      <button
        onClick={onCancel}
        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
      >
        취소
      </button>
    </div>
  );
}
