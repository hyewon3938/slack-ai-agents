'use client';

import { useState, useEffect } from 'react';
import type { ExpenseRow, PlannedExpenseRow } from '@/features/budget/lib/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/features/budget/lib/types';
import { PlusIcon, XMarkIcon } from '@/components/ui/icons';
import { formatAmount } from '@/lib/types';
import { Input, Select } from '@/components/ui/input';

interface ExpenseFormProps {
  onAdd: (data: {
    date: string;
    amount: number;
    category: string;
    description?: string | null;
    type?: 'expense' | 'income';
    planned_expense_id?: number | null;
  }) => Promise<ExpenseRow>;
  /** 현재 보고 있는 결제주기 월 (예정 지출 목록용) */
  yearMonth?: string;
}

export function ExpenseForm({ onAdd, yearMonth }: ExpenseFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [date, setDate] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [selectedPlanned, setSelectedPlanned] = useState<number | null>(null);
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpenseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 예정 지출 목록 로드
  useEffect(() => {
    if (!yearMonth) return;
    void fetch(`/api/budget/planned-expenses?yearMonth=${yearMonth}`)
      .then((r) => r.json())
      .then((d: { data: PlannedExpenseRow[] }) => setPlannedExpenses(d.data))
      .catch(() => setPlannedExpenses([]));
  }, [yearMonth]);

  const handleTypeChange = (type: 'expense' | 'income') => {
    setEntryType(type);
    // 타입 변경 시 카테고리를 해당 타입의 첫 번째로 초기화
    setCategory(type === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseInt(amountStr.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
      setError('금액을 올바르게 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      await onAdd({
        date,
        amount,
        category,
        description: description || null,
        type: entryType,
        planned_expense_id: selectedPlanned,
      });
      setAmountStr('');
      setDescription('');
      setDate(today);
      setSelectedPlanned(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
  };

  const currentCategories = entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* 지출 / 수입 토글 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 p-0.5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'expense' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            지출
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'income' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            수입
          </button>
        </div>
        <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          <PlusIcon size={14} />
          {entryType === 'expense' ? '지출 추가' : '수입 추가'}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* 날짜 */}
        <div className="col-span-1">
          <Input label="날짜" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        {/* 금액 */}
        <div className="col-span-1">
          <Input
            label="금액 (원)"
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={handleAmountChange}
            placeholder="0"
            required
          />
        </div>

        {/* 카테고리 */}
        <div className="col-span-1">
          <Select label="카테고리" value={category} onChange={(e) => setCategory(e.target.value)}>
            {currentCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>

        {/* 내역 */}
        <div className="col-span-1">
          <Input
            label="내역 (선택)"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="메모"
          />
        </div>
      </div>

      {/* 예정 지출 연결 (지출 모드 + 예정 지출이 있을 때만) */}
      {entryType === 'expense' && plannedExpenses.length > 0 && (
        <div className="mt-2">
          <Select
            label="예정 지출 연결 (선택)"
            value={selectedPlanned ?? ''}
            onChange={(e) => setSelectedPlanned(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">일반 지출 (일일 예산 차감)</option>
            {plannedExpenses.map((p) => (
              <option key={p.id} value={p.id}>
                {p.memo ?? '예정 지출'} — {formatAmount(p.amount)}
                {(p.used_amount ?? 0) > 0 && ` (사용 ${formatAmount(p.used_amount ?? 0)})`}
              </option>
            ))}
          </Select>
          {selectedPlanned && (
            <p className="mt-1 text-[10px] text-blue-500">이 지출은 일일 예산에 영향을 주지 않습니다</p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-500">
          <XMarkIcon size={13} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`mt-3 ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50 ${
          entryType === 'expense' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        <PlusIcon size={13} />
        {loading ? '추가 중...' : entryType === 'expense' ? '추가' : '수입 기록'}
      </button>
    </form>
  );
}
