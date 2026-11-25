'use client';

import { useState } from 'react';
import { FIXED_COST_CATEGORIES } from '@/features/budget/lib/types';
import {
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHOD_OPTIONS,
} from '@/features/budget/lib/billing/payment-methods';

export function FixedCostAddForm({
  onAdd,
}: {
  onAdd: (data: {
    name: string;
    amount: number;
    category?: string;
    day_of_month?: number | null;
    payment_method?: string | null;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(DEFAULT_PAYMENT_METHOD);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const a = Number(amount.replace(/,/g, ''));
    // 서버 검증과 같은 기준: 금액은 양의 정수, 결제일은 1~31 정수
    if (!name.trim() || !Number.isInteger(a) || a <= 0) return;
    const day = dayOfMonth ? Number(dayOfMonth) : null;
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return;
    setSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        amount: a,
        category: category || undefined,
        day_of_month: day,
        payment_method: paymentMethod,
      });
      setName('');
      setAmount('');
      setCategory('');
      setDayOfMonth('');
      setPaymentMethod(DEFAULT_PAYMENT_METHOD);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full border-t border-gray-100 px-4 py-2.5 text-left text-xs text-blue-500 hover:bg-blue-50"
      >
        + 고정지출 추가
      </button>
    );
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="금액"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
        <input
          type="number"
          min="1"
          max="31"
          placeholder="결제일"
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
          className="w-20 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
        >
          <option value="">카테고리 선택</option>
          {FIXED_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
        >
          {PAYMENT_METHOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={saving || !name.trim() || !amount}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40 hover:bg-blue-700"
        >
          {saving ? '추가 중...' : '추가'}
        </button>
      </div>
    </div>
  );
}
