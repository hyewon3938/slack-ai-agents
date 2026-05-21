'use client';

import { useState, useEffect } from 'react';
import type { ExpenseRow, PlannedExpenseRow } from '@/features/budget/lib/types';
import {
  ALL_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  BUDGET_EXCLUDED_CATEGORIES,
} from '@/features/budget/lib/types';
import { PlusIcon, XMarkIcon } from '@/components/ui/icons';
import { formatAmount } from '@/lib/types';
import { Input, Select } from '@/components/ui/input';
import { getTodayISO } from '@/lib/kst';
import {
  getBillingMonthForExpense,
  computeLastInstallmentBillingMonth,
} from '@/features/budget/lib/billing/card-billing';

interface ExpenseFormProps {
  onAdd: (data: {
    date: string;
    amount: number;
    category: string;
    description?: string | null;
    type?: 'expense' | 'income';
    planned_expense_id?: number | null;
    payment_method?: string;
    installment_months?: number;
    exclude_from_budget?: boolean;
    distribute_to_budget?: boolean;
    distribute_to_runway?: boolean;
  }) => Promise<ExpenseRow>;
  /** 현재 보고 있는 결제주기 월 (예정 지출 목록용) */
  yearMonth?: string;
}

const INSTALLMENT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PAYMENT_OPTIONS = ['현대카드', '국민카드', '현금'] as const;
type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

export function ExpenseForm({ onAdd, yearMonth }: ExpenseFormProps) {
  const today = getTodayISO();
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [date, setDate] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [selectedPlanned, setSelectedPlanned] = useState<number | null>(null);
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpenseRow[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentOption>('현대카드');
  const [installmentMonths, setInstallmentMonths] = useState<number>(1);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);
  const [distributeToBudget, setDistributeToBudget] = useState(false);
  const [distributeToRunway, setDistributeToRunway] = useState(true);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 예정 지출 목록 로드
  useEffect(() => {
    if (!yearMonth) return;
    void fetch(`/api/budget/planned-expenses?yearMonth=${yearMonth}`)
      .then((r) => r.json())
      .then((d: { data?: PlannedExpenseRow[] }) => setPlannedExpenses(d.data ?? []))
      .catch(() => setPlannedExpenses([]));
  }, [yearMonth]);

  // target_date 로드 — 할부 토글 조건부 노출 판단용
  useEffect(() => {
    void fetch('/api/budget/settings')
      .then((r) => r.json())
      .then((d: { data?: { target_date: string | null } }) => {
        setTargetDate(d.data?.target_date ?? null);
      })
      .catch(() => setTargetDate(null));
  }, []);

  const handleTypeChange = (type: 'expense' | 'income') => {
    setEntryType(type);
    const firstCat = type === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0];
    setCategory(firstCat);
    setExcludeFromBudget(type === 'expense' ? BUDGET_EXCLUDED_CATEGORIES.has(firstCat) : false);
    if (type === 'income') setDistributeToBudget(false);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    if (entryType === 'expense') {
      setExcludeFromBudget(BUDGET_EXCLUDED_CATEGORIES.has(cat));
    }
  };

  const handlePaymentMethodChange = (method: PaymentOption) => {
    setPaymentMethod(method);
    // 현금으로 바꾸면 할부 초기화
    if (method === '현금') setInstallmentMonths(1);
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
        payment_method: entryType === 'expense' ? paymentMethod : '기타',
        installment_months:
          entryType === 'expense' && paymentMethod !== '현금' ? installmentMonths : undefined,
        exclude_from_budget: entryType === 'expense' ? excludeFromBudget : false,
        distribute_to_budget: entryType === 'income' ? distributeToBudget : false,
        distribute_to_runway:
          entryType === 'expense' && paymentMethod !== '현금' && installmentMonths > 1
            ? distributeToRunway
            : undefined,
      });
      setAmountStr('');
      setDescription('');
      setDate(today);
      setSelectedPlanned(null);
      setInstallmentMonths(1);
      setExcludeFromBudget(BUDGET_EXCLUDED_CATEGORIES.has(EXPENSE_CATEGORIES[0]));
      setDistributeToBudget(false);
      setDistributeToRunway(true);
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

  const currentCategories: readonly string[] =
    entryType === 'expense' ? ALL_EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  // 할부 미리보기 금액 계산
  const rawAmount = parseInt(amountStr.replace(/,/g, ''), 10);
  const monthlyPreview =
    !isNaN(rawAmount) && rawAmount > 0 && installmentMonths > 1
      ? Math.round(rawAmount / installmentMonths)
      : null;

  // 귀속 월 계산 (지출 모드에서 실시간 표시)
  const billingMonthNum = parseInt(getBillingMonthForExpense(date, paymentMethod).slice(5), 10);

  // 할부 자산 차감 범위 토글 노출 조건 (ADR 0018):
  // 마지막 회차 billing_month > target_date 일 때만 의미 있는 분기.
  const lastInstallmentBillingMonth =
    entryType === 'expense' && paymentMethod !== '현금' && installmentMonths >= 2
      ? computeLastInstallmentBillingMonth(date, installmentMonths, paymentMethod)
      : null;
  const showRunwayToggle =
    lastInstallmentBillingMonth !== null &&
    targetDate !== null &&
    lastInstallmentBillingMonth > targetDate;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      {/* 지출 / 수입 토글 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 p-0.5">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'expense'
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            지출
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              entryType === 'income'
                ? 'bg-green-600 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            수입
          </button>
        </div>
        <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          <PlusIcon size={14} />
          {entryType === 'expense' ? '지출 추가' : '수입 추가'}
          {entryType === 'expense' && (
            <span className="ml-1 text-xs font-normal text-gray-400">{billingMonthNum}월 대금</span>
          )}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* 날짜 */}
        <div className="col-span-1">
          <Input
            label="날짜"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
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
          <Select
            label="카테고리"
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {currentCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
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

      {/* 결제수단 + 할부 (지출 모드 전용) */}
      {entryType === 'expense' && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {/* 결제수단 토글 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">결제수단</label>
            <div className="flex rounded-lg border border-gray-200 p-0.5">
              {PAYMENT_OPTIONS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => handlePaymentMethodChange(method)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    paymentMethod === method
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* 할부 (카드 선택 시만) */}
          {paymentMethod !== '현금' && (
            <div>
              <Select
                label="할부"
                value={installmentMonths}
                onChange={(e) => setInstallmentMonths(Number(e.target.value))}
              >
                <option value={1}>일시불</option>
                {INSTALLMENT_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}개월
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* 할부 미리보기 */}
          {monthlyPreview !== null && (
            <p className="pb-1 text-[10px] text-blue-500">
              월 {formatAmount(monthlyPreview)} × {installmentMonths}개월
            </p>
          )}

          {/* 예산 포함/제외 토글 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">예산</label>
            <div className="flex rounded-lg border border-gray-200 p-0.5">
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
        </div>
      )}

      {/* 할부 자산 차감 범위 토글 (ADR 0018) — 마지막 회차가 target_date를 넘을 때만 노출 */}
      {showRunwayToggle && (
        <fieldset className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <legend className="px-1 text-xs text-amber-700">
            마지막 회차({lastInstallmentBillingMonth})는 목표 기간({targetDate}) 이후입니다
          </legend>
          <label className="flex cursor-pointer items-start gap-2 py-1 text-xs text-gray-700">
            <input
              type="radio"
              name="distribute-to-runway"
              checked={distributeToRunway}
              onChange={() => setDistributeToRunway(true)}
              className="mt-0.5"
            />
            <span>
              <strong>지금 자산에서 전부 미리 차감</strong>
              <span className="block text-[10px] text-gray-500">
                목표 기간 이후 회차도 즉시 자산에서 빠집니다. 확실하게 잡고 가고 싶을 때.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 py-1 text-xs text-gray-700">
            <input
              type="radio"
              name="distribute-to-runway"
              checked={!distributeToRunway}
              onChange={() => setDistributeToRunway(false)}
              className="mt-0.5"
            />
            <span>
              <strong>목표 기간 이후 회차는 그때의 자금으로 갚을 예정</strong>
              <span className="block text-[10px] text-gray-500">
                목표 기간 안의 회차만 지금 자산에서 빠지고, 이후 회차는 결제될 때 처리합니다.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {/* 수입 전체 분배 토글 (수입 모드 전용) */}
      {entryType === 'income' && (
        <div className="mt-2">
          <label className="mb-1 block text-xs text-gray-500">예산 반영</label>
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setDistributeToBudget(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                !distributeToBudget
                  ? 'bg-green-600 text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              이번 달
            </button>
            <button
              type="button"
              onClick={() => setDistributeToBudget(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                distributeToBudget ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              전체 분배
            </button>
          </div>
          {distributeToBudget && (
            <p className="mt-1 text-[10px] text-gray-400">
              수입이 목표 기간 전체에 균등 분배됩니다
            </p>
          )}
        </div>
      )}

      {/* 예정 지출 연결 (지출 모드 + 일시불/현금 + 예정 지출이 있을 때만) */}
      {entryType === 'expense' && installmentMonths === 1 && plannedExpenses.length > 0 && (
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
            <p className="mt-1 text-[10px] text-blue-500">
              이 지출은 일일 예산에 영향을 주지 않습니다
            </p>
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
          entryType === 'expense'
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        <PlusIcon size={13} />
        {loading ? '추가 중...' : entryType === 'expense' ? '추가' : '수입 기록'}
      </button>
    </form>
  );
}
