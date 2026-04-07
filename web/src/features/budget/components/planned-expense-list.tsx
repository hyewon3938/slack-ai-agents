'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PlannedExpenseRow } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { XMarkIcon } from '@/components/ui/icons';

interface PlannedExpenseListProps {
  yearMonth: string;
}

export function PlannedExpenseList({ yearMonth }: PlannedExpenseListProps) {
  const [items, setItems] = useState<PlannedExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { void fetchItems(); }, [fetchItems]);

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

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/budget/planned-expenses?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    } catch {
      // 삭제 실패 시 무시
    }
  };

  const totalPlanned = items.reduce((s, i) => s + i.amount, 0);

  if (loading) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded-t-xl">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">예정 지출</h2>
          {totalPlanned > 0 && (
            <span className="text-xs text-gray-400">{formatAmount(totalPlanned)}</span>
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
              placeholder="메모 (선택)"
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
      {items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-gray-400">
          이번 달 예정된 지출이 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800">{formatAmount(item.amount)}</span>
                {item.memo && (
                  <span className="text-xs text-gray-400">{item.memo}</span>
                )}
              </div>
              <button
                onClick={() => void handleDelete(item.id)}
                className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition"
              >
                <XMarkIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
