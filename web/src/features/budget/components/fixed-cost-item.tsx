'use client';

import { useState } from 'react';
import type { FixedCostRow } from '@/features/budget/lib/types';
import {
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHOD_OPTIONS,
} from '@/features/budget/lib/billing/payment-methods';
import { formatAmount } from '@/lib/types';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

export function FixedCostItem({
  cost,
  onUpdate,
  onDelete,
}: {
  cost: FixedCostRow;
  onUpdate: (id: number, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(String(cost.amount));
  const [dayOfMonth, setDayOfMonth] = useState(String(cost.day_of_month ?? ''));
  const [paymentMethod, setPaymentMethod] = useState(cost.payment_method ?? DEFAULT_PAYMENT_METHOD);

  const handleSave = async () => {
    const a = Number(amount);
    // 서버 검증과 같은 기준: 금액은 양의 정수, 결제일은 1~31 정수
    if (!Number.isInteger(a) || a <= 0) return;
    const day = dayOfMonth ? Number(dayOfMonth) : null;
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return;
    setSaving(true);
    try {
      await onUpdate(cost.id, { amount: a, day_of_month: day, payment_method: paymentMethod });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-gray-700">{cost.name}</span>
          {cost.category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
              {cost.category}
            </span>
          )}
          {cost.is_variable && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500">변동</span>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => {
              setAmount(String(cost.amount));
              setDayOfMonth(String(cost.day_of_month ?? ''));
              setPaymentMethod(cost.payment_method ?? DEFAULT_PAYMENT_METHOD);
              setEditing(true);
            }}
            className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
          >
            <PencilIcon size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">금액</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">결제일</label>
            <input
              type="number"
              min="1"
              max="31"
              placeholder="미설정"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
            />
            <span className="text-xs text-gray-400">일</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">결제수단</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => {
                if (confirm('이 고정지출을 삭제할까?')) void onDelete(cost.id);
              }}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-600"
            >
              삭제
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
              >
                <XMarkIcon size={16} />
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-md p-1 text-blue-500 hover:bg-blue-50"
              >
                <CheckCircleIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-3 text-sm">
          <span className="font-semibold text-gray-800">{formatAmount(cost.amount)}</span>
          {cost.day_of_month ? (
            <span className="text-xs text-gray-400">매월 {cost.day_of_month}일</span>
          ) : (
            <span className="text-xs text-amber-500">결제일 미설정</span>
          )}
          {cost.payment_method ? (
            <span className="text-xs text-gray-400">{cost.payment_method}</span>
          ) : (
            <span className="text-xs text-amber-500">결제수단 미설정</span>
          )}
        </div>
      )}
    </div>
  );
}
