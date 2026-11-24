'use client';

import { useState } from 'react';
import type { AssetRow } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { getTodayISO } from '@/lib/kst';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

export function AssetItem({
  asset,
  onUpdate,
  onToggleDefault,
}: {
  asset: AssetRow;
  onUpdate: (
    id: number,
    balance: number,
    available_amount: number,
    balanceAsOf?: string,
  ) => Promise<void>;
  onToggleDefault: (id: number, next: boolean) => Promise<void>;
}) {
  const today = getTodayISO();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingDefault, setTogglingDefault] = useState(false);
  // 자금 단일화 (#539): 잔액·가용액을 단일 '자금'으로 입력. 입력 의미는 기준일 시점의 통장 잔액 (#615).
  const [value, setValue] = useState(String(asset.available_amount ?? asset.balance));
  // 기준일 (#615): 이 잔액이 며칠까지의 입출금을 반영한 값인가.
  const [asOf, setAsOf] = useState(today);

  const valueLabel = asset.is_emergency ? '잔액' : '자금';

  const handleSave = async () => {
    const v = Number(value);
    if (isNaN(v)) return;
    if (asOf > today) return;
    setSaving(true);
    try {
      // 단일 필드 — balance·available_amount를 같은 값으로 저장.
      await onUpdate(asset.id, v, v, asOf);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDefault = async () => {
    if (asset.is_emergency || togglingDefault) return;
    setTogglingDefault(true);
    try {
      await onToggleDefault(asset.id, !asset.is_default);
    } finally {
      setTogglingDefault(false);
    }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{asset.name}</span>
          {asset.is_emergency && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">비상금</span>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => {
              setValue(String(asset.available_amount ?? asset.balance));
              setAsOf(today);
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
            <label className="w-16 text-xs text-gray-400">{valueLabel}</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
          {!asset.is_emergency && (
            <div className="flex items-center gap-2">
              <label className="w-16 text-xs text-gray-400">기준일</label>
              <input
                type="date"
                value={asOf}
                max={today}
                onChange={(e) => setAsOf(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
          )}
          {!asset.is_emergency && (
            <p className="text-[10px] text-gray-400">
              통장 잔액 그대로 — 기준일까지의 입출금이 반영된 값
            </p>
          )}
          {!asset.is_emergency && (
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={asset.is_default}
                disabled={togglingDefault}
                onChange={() => void handleToggleDefault()}
              />
              기본 자산 (자동 차감 우선순위)
            </label>
          )}
          <div className="flex justify-end gap-1.5">
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
      ) : (
        <div className="mt-1 text-sm">
          <span className="text-xs text-gray-400">{valueLabel} </span>
          <span className="font-semibold text-gray-800">
            {formatAmount(asset.available_amount ?? asset.balance)}
          </span>
          {!asset.is_emergency && asset.balance_as_of && (
            <span className="ml-2 text-xs text-gray-400">{asset.balance_as_of} 기준</span>
          )}
        </div>
      )}
    </div>
  );
}
