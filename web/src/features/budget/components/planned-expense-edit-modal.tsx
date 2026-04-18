'use client';

import { useState, useEffect } from 'react';
import type { PlannedExpenseRow, ExpenseRow } from '@/features/budget/lib/types';
import { getBillingRange } from '@/features/budget/lib/billing/cycle';
import { formatAmount } from '@/lib/types';
import { XMarkIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PlannedExpenseEditModalProps {
  item: PlannedExpenseRow;
  yearMonth: string;
  onSave: (id: number, updates: { amount: number; memo: string | null }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

export function PlannedExpenseEditModal({ item, yearMonth, onSave, onDelete, onClose }: PlannedExpenseEditModalProps) {
  const [amountStr, setAmountStr] = useState(item.amount.toLocaleString('ko-KR'));
  const [memo, setMemo] = useState(item.memo ?? '');
  const [linkedExpenses, setLinkedExpenses] = useState<ExpenseRow[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 연결된 지출 내역 로드
  useEffect(() => {
    const { from, to } = getBillingRange(yearMonth);

    void fetch(`/api/expenses?from=${from}&to=${to}&planned_expense_id=${item.id}`)
      .then((r) => r.json())
      .then((d: { data?: ExpenseRow[] }) => setLinkedExpenses(d.data ?? []))
      .catch(() => setLinkedExpenses([]))
      .finally(() => setLoadingExpenses(false));
  }, [item.id, yearMonth]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseInt(amountStr.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
      setError('금액을 올바르게 입력해주세요');
      return;
    }
    setSaving(true);
    try {
      await onSave(item.id, { amount, memo: memo.trim() || null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (linkedExpenses.length > 0) {
      if (!confirm(`연결된 지출 ${linkedExpenses.length}건이 일반 지출로 전환됩니다. 삭제할까요?`)) return;
    } else {
      if (!confirm('이 예정 지출을 삭제할까요?')) return;
    }
    setDeleting(true);
    try {
      await onDelete(item.id);
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const used = item.used_amount ?? 0;
  const remaining = item.amount - used;
  const isOver = used > item.amount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">예정 지출 수정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition hover:text-gray-600"
          >
            <XMarkIcon size={18} />
          </button>
        </div>

        {/* 사용 현황 */}
        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>사용 {formatAmount(used)} / {formatAmount(item.amount)}</span>
            <span className={isOver ? 'font-medium text-red-500' : ''}>
              {isOver ? `${formatAmount(Math.abs(remaining))} 초과` : `${formatAmount(remaining)} 남음`}
            </span>
          </div>
          {item.amount > 0 && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${isOver ? 'bg-red-400' : 'bg-blue-400'}`}
                style={{ width: `${Math.min((used / item.amount) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <Input
            label="예산 금액 (원)"
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={handleAmountChange}
            placeholder="0"
            required
          />

          <Input
            label="메모"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 여행, 선물"
          />

          {/* 연결된 지출 내역 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              연결된 지출 내역 ({linkedExpenses.length}건)
            </label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200">
              {loadingExpenses ? (
                <div className="px-3 py-2 text-xs text-gray-400">불러오는 중...</div>
              ) : linkedExpenses.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">연결된 지출 없음</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {linkedExpenses.map((exp) => (
                    <div key={exp.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{exp.date}</span>
                        <span className="text-xs text-gray-700">{exp.description ?? exp.category}</span>
                      </div>
                      <span className="text-xs font-medium text-gray-700">{formatAmount(exp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1 text-xs text-red-500">
              <XMarkIcon size={13} />
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
