'use client';

import { useState, useEffect } from 'react';
import type { ExpenseRow, PlannedExpenseRow } from '@/features/budget/lib/types';
import { ALL_EXPENSE_CATEGORIES, BUDGET_EXCLUDED_CATEGORIES } from '@/features/budget/lib/types';
import { computeLastInstallmentBillingMonth } from '@/features/budget/lib/billing/card-billing';
import { formatAmount } from '@/lib/types';
import { XMarkIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

interface ExpenseEditModalProps {
  expense: ExpenseRow;
  /** 현재 보고 있는 결제주기 월 (예정 지출 목록용) */
  yearMonth?: string;
  onSave: (
    id: number,
    updates: {
      date: string;
      amount: number;
      category: string;
      description: string | null;
      exclude_from_budget: boolean;
      planned_expense_id: number | null;
      distribute_to_runway?: boolean;
    },
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

export function ExpenseEditModal({
  expense,
  yearMonth,
  onSave,
  onDelete,
  onClose,
}: ExpenseEditModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState(expense.date);
  const [amountStr, setAmountStr] = useState(expense.amount.toLocaleString('ko-KR'));
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description ?? '');
  const [excludeFromBudget, setExcludeFromBudget] = useState(expense.exclude_from_budget);
  const [selectedPlanned, setSelectedPlanned] = useState<number | null>(expense.planned_expense_id);
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpenseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ADR 0018: 할부 자산 차감 범위 토글 (그룹 전체에 적용)
  const [distributeToRunway, setDistributeToRunway] = useState(expense.distribute_to_runway);
  const [targetDate, setTargetDate] = useState<string | null>(null);

  const showPlannedSelect = yearMonth && !expense.is_installment && expense.type !== 'income';

  // target_date 로드 — 할부 토글 조건부 노출 판단용
  useEffect(() => {
    if (!expense.is_installment) return;
    void fetch('/api/budget/settings')
      .then((r) => r.json())
      .then((d: { data?: { target_date: string | null } }) =>
        setTargetDate(d.data?.target_date ?? null),
      )
      .catch(() => setTargetDate(null));
  }, [expense.is_installment]);

  // 이 회차로부터 첫 회차 date 역산 후 마지막 회차 billing_month 계산
  const lastInstallmentBillingMonth =
    expense.is_installment &&
    expense.installment_num != null &&
    expense.installment_total != null &&
    expense.payment_method
      ? (() => {
          const baseDate = new Date(`${expense.date}T00:00:00`);
          baseDate.setMonth(baseDate.getMonth() - (expense.installment_num - 1));
          const firstDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
          return computeLastInstallmentBillingMonth(
            firstDate,
            expense.installment_total,
            expense.payment_method,
          );
        })()
      : null;

  const showRunwayToggle =
    expense.is_installment &&
    expense.type !== 'income' &&
    !expense.exclude_from_budget &&
    targetDate !== null &&
    lastInstallmentBillingMonth !== null &&
    lastInstallmentBillingMonth > targetDate;

  useEffect(() => {
    if (!showPlannedSelect) return;
    void fetch(`/api/budget/planned-expenses?yearMonth=${yearMonth}`)
      .then((r) => r.json())
      .then((d: { data?: PlannedExpenseRow[] }) => setPlannedExpenses(d.data ?? []))
      .catch(() => setPlannedExpenses([]));
  }, [yearMonth, showPlannedSelect]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setAmountStr(raw ? num.toLocaleString('ko-KR') : '');
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setExcludeFromBudget(BUDGET_EXCLUDED_CATEGORIES.has(cat));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseInt(amountStr.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
      setError('금액을 올바르게 입력해주세요');
      return;
    }

    // 할부 자산 차감 범위 변경은 그룹 전체에 적용 — 사용자 확인
    const runwayChanged = showRunwayToggle && distributeToRunway !== expense.distribute_to_runway;
    if (runwayChanged) {
      const msg = distributeToRunway
        ? '자산 차감 범위를 "전체 회차 즉시 차감"으로 변경합니다.\n같은 할부 그룹의 모든 회차에 적용되며, 자산이 추가로 차감됩니다.\n계속할까요?'
        : '자산 차감 범위를 "목표 기간 이내만"으로 변경합니다.\n같은 할부 그룹의 모든 회차에 적용되며, 목표 기간 이후 회차분이 자산에 환원됩니다.\n계속할까요?';
      if (!confirm(msg)) return;
    }

    setLoading(true);
    try {
      await onSave(expense.id, {
        date,
        amount,
        category,
        description: description || null,
        exclude_from_budget: excludeFromBudget,
        planned_expense_id: selectedPlanned,
        ...(runwayChanged ? { distribute_to_runway: distributeToRunway } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">지출 수정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition hover:text-gray-600"
          >
            <XMarkIcon size={18} />
          </button>
        </div>

        {/* Installment badge */}
        {expense.is_installment &&
          expense.installment_num != null &&
          expense.installment_total != null && (
            <div className="mb-3">
              <span className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                {expense.installment_num}/{expense.installment_total} 할부
              </span>
            </div>
          )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {/* 날짜 */}
          <Input
            label="날짜"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          {/* 금액 */}
          <Input
            label="금액 (원)"
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={handleAmountChange}
            placeholder="0"
            required
          />

          {/* 카테고리 */}
          <Select
            label="카테고리"
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {ALL_EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          {/* 내역 */}
          <Input
            label="내역"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="메모"
          />

          {/* 예산 포함/제외 토글 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">예산</label>
            <div className="flex rounded-lg border border-gray-200 p-0.5 w-fit">
              <button
                type="button"
                onClick={() => setExcludeFromBudget(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  !excludeFromBudget
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                포함
              </button>
              <button
                type="button"
                onClick={() => setExcludeFromBudget(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  excludeFromBudget ? 'bg-gray-500 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                제외
              </button>
            </div>
          </div>

          {/* 할부 자산 차감 범위 토글 (ADR 0018) — 마지막 회차가 target_date 이후일 때만 노출 */}
          {showRunwayToggle && (
            <fieldset className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <legend className="px-1 text-[11px] font-medium text-amber-700">
                자산 차감 범위 (할부 그룹 전체에 적용)
              </legend>
              <p className="mb-2 text-[10px] text-amber-700">
                마지막 회차({lastInstallmentBillingMonth})는 목표 기간({targetDate}) 이후입니다.
              </p>
              <label className="mb-1 flex cursor-pointer items-start gap-2 text-xs text-gray-700">
                <input
                  type="radio"
                  name="distribute_to_runway"
                  checked={distributeToRunway}
                  onChange={() => setDistributeToRunway(true)}
                  className="mt-0.5"
                />
                <span>
                  <strong>지금 자산에서 전부 미리 차감</strong>
                  <br />
                  <span className="text-[10px] text-gray-500">
                    모든 회차 금액을 즉시 자산에서 빼고 매달 잊는다
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-700">
                <input
                  type="radio"
                  name="distribute_to_runway"
                  checked={!distributeToRunway}
                  onChange={() => setDistributeToRunway(false)}
                  className="mt-0.5"
                />
                <span>
                  <strong>목표 기간 이후 회차는 그때의 자금으로</strong>
                  <br />
                  <span className="text-[10px] text-gray-500">
                    목표 기간 이내 회차만 자산에서 차감, 이후는 매달 예산에서 분배
                  </span>
                </span>
              </label>
            </fieldset>
          )}

          {/* 예정 지출 연결 (일시불 지출만, 할부/수입 제외) */}
          {showPlannedSelect && plannedExpenses.length > 0 && (
            <div>
              <Select
                label="예정 지출 연결"
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
                <p className="mt-1 text-[10px] text-blue-500">
                  이 지출은 일일 예산에 영향을 주지 않습니다
                </p>
              )}
            </div>
          )}

          {/* Error */}
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
              onClick={() => {
                if (!confirm('이 내역을 삭제할까요?')) return;
                setDeleting(true);
                void onDelete(expense.id)
                  .then(onClose)
                  .finally(() => setDeleting(false));
              }}
            >
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
