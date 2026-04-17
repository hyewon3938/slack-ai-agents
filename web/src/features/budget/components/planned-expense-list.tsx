'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PlannedExpenseRow } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { PlannedExpenseEditModal } from './planned-expense-edit-modal';

interface PlannedExpenseListProps {
  yearMonth: string;
  /** 지출 변경 시 리프레시 트리거 (카운터) */
  refreshTrigger?: number;
}

export function PlannedExpenseList({ yearMonth, refreshTrigger }: PlannedExpenseListProps) {
  const [items, setItems] = useState<PlannedExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingItem, setEditingItem] = useState<PlannedExpenseRow | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/planned-expenses?yearMonth=${yearMonth}`);
      if (res.ok) {
        const d = (await res.json()) as { data: PlannedExpenseRow[] };
        setItems(d.data);
      }
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  // yearMonth 변경 또는 지출 변경(refreshTrigger) 시 예정지출 목록 리프레시
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchItems(); }, [fetchItems, refreshTrigger]);

  const handleAdd = async () => {
    const amount = parseInt(amountInput.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/budget/planned-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: yearMonth, amount, memo: memoInput.trim() || null }),
      });
      if (res.ok) {
        const d = (await res.json()) as { data: PlannedExpenseRow };
        setItems((prev) => [...prev, d.data]);
        setAmountInput('');
        setMemoInput('');
        setShowForm(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (id: number, updates: { amount: number; memo: string | null }) => {
    const res = await fetch('/api/budget/planned-expenses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? '수정 실패');
    }
    const { data } = (await res.json()) as { data: PlannedExpenseRow };
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...data } : i)));
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/budget/planned-expenses?id=${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('삭제 실패');
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const totalPlanned = items.reduce((s, i) => s + i.amount, 0);
  const totalUsed = items.reduce((s, i) => s + (i.used_amount ?? 0), 0);

  if (loading) return null;

  // 항목이 없고 추가 폼도 안 열려 있으면 컴팩트하게 표시
  if (items.length === 0 && !showForm) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-200 px-4 py-2.5">
        <span className="text-xs text-gray-400">예정 지출 없음</span>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 transition"
        >
          + 추가
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded-t-xl">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">예정 지출</h2>
            {totalPlanned > 0 && (
              <span className="text-xs text-gray-400">
                {formatAmount(totalUsed)} / {formatAmount(totalPlanned)}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-md px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 transition"
          >
            {showForm ? '취소' : '+ 추가'}
          </button>
        </div>

        {/* 추가 폼 */}
        {showForm && (
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="금액"
                value={amountInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, '');
                  const num = parseInt(raw, 10);
                  setAmountInput(raw ? num.toLocaleString('ko-KR') : '');
                }}
                className="w-28 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
              <input
                type="text"
                placeholder="메모 (예: 영화제, 여행)"
                value={memoInput}
                onChange={(e) => setMemoInput(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
              <button
                onClick={() => void handleAdd()}
                disabled={saving || !amountInput}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-700 transition"
              >
                {saving ? '...' : '추가'}
              </button>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div className="divide-y divide-gray-100">
          {items.map((item) => {
            const used = item.used_amount ?? 0;
            const remaining = item.amount - used;
            const pct = item.amount > 0 ? Math.min((used / item.amount) * 100, 100) : 0;
            const isOver = used > item.amount;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setEditingItem(item)}
                className="w-full px-4 py-2.5 text-left transition hover:bg-gray-50"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {item.memo && (
                      <span className="text-sm font-medium text-gray-700">{item.memo}</span>
                    )}
                    <span className="text-sm text-gray-500">{formatAmount(item.amount)}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">수정</span>
                </div>
                {/* 사용 현황 바 */}
                {used > 0 && (
                  <>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${isOver ? 'bg-red-400' : 'bg-blue-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                      <span>사용 {formatAmount(used)}</span>
                      <span className={isOver ? 'text-red-500' : ''}>
                        {isOver ? `${formatAmount(Math.abs(remaining))} 초과` : `${formatAmount(remaining)} 남음`}
                      </span>
                    </div>
                  </>
                )}
                {used === 0 && (
                  <div className="text-[10px] text-gray-400">아직 사용 내역 없음</div>
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-4 py-2">
          <p className="text-[10px] text-gray-400">
            지출 기록 시 예정 지출을 선택하면 일일 예산에 영향 없이 별도 관리됩니다.
          </p>
        </div>
      </div>

      {/* 수정 모달 */}
      {editingItem && (
        <PlannedExpenseEditModal
          item={editingItem}
          yearMonth={yearMonth}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}
