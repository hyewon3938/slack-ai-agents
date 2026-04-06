'use client';

import { useState } from 'react';
import type { FixedCostRow, AssetRow } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

interface SettingsPanelProps {
  fixedCosts: FixedCostRow[];
  assets: AssetRow[];
  onUpdateAsset: (id: number, balance: number, available_amount: number) => Promise<void>;
}

/** 고정비 카테고리 라벨 */
const FIXED_COST_CATEGORY: Record<string, string> = {
  housing: '주거',
  insurance: '보험',
  subscription: '구독',
  communication: '통신',
  finance: '금융',
  other: '기타',
};

/** 자산 타입 라벨 */
const ASSET_TYPE: Record<string, string> = {
  checking: '입출금',
  savings: '저축',
  investment: '투자',
  emergency: '비상금',
  other: '기타',
};

function AssetItem({
  asset,
  onUpdate,
}: {
  asset: AssetRow;
  onUpdate: (id: number, balance: number, available_amount: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState(String(asset.balance));
  const [available, setAvailable] = useState(String(asset.available_amount ?? asset.balance));

  const handleEdit = () => {
    setBalance(String(asset.balance));
    setAvailable(String(asset.available_amount ?? asset.balance));
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    const b = Number(balance);
    const a = Number(available);
    if (isNaN(b) || isNaN(a)) return;
    setSaving(true);
    try {
      await onUpdate(asset.id, b, a);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-700">{asset.name}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            {ASSET_TYPE[asset.type] ?? asset.type}
          </span>
          {asset.is_emergency && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">비상금</span>
          )}
        </div>

        {!editing && (
          <button
            onClick={handleEdit}
            className="shrink-0 rounded-md p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-500"
          >
            <PencilIcon size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">잔액</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">사용가능</label>
            <input
              type="number"
              value={available}
              onChange={(e) => setAvailable(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <XMarkIcon size={16} />
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-md p-1 text-blue-500 transition hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
            >
              <CheckCircleIcon size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-4">
          <div>
            <span className="text-xs text-gray-400">잔액 </span>
            <span className="text-sm font-semibold text-gray-800">{formatAmount(asset.balance)}</span>
          </div>
          {asset.available_amount !== null && asset.available_amount !== asset.balance && (
            <div>
              <span className="text-xs text-gray-400">사용가능 </span>
              <span className="text-sm font-semibold text-gray-800">
                {formatAmount(asset.available_amount)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ fixedCosts, assets, onUpdateAsset }: SettingsPanelProps) {
  const activeCosts = fixedCosts.filter((c) => c.active);
  const inactiveCosts = fixedCosts.filter((c) => !c.active);
  const totalFixed = activeCosts.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-4">
      {/* 월 고정비 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between bg-gray-50 px-4 py-1.5 rounded-t-xl">
          <span className="text-xs font-medium text-gray-500">월 고정비</span>
          <span className="text-xs text-gray-500">{formatAmount(totalFixed)}</span>
        </div>

        {activeCosts.length === 0 && inactiveCosts.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">등록된 고정비가 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeCosts.map((cost) => (
              <div key={cost.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-700">{cost.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    {(cost.category && FIXED_COST_CATEGORY[cost.category]) ?? cost.category ?? '기타'}
                  </span>
                  {cost.is_variable && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500">변동</span>
                  )}
                  {cost.day_of_month && (
                    <span className="text-xs text-gray-400">매월 {cost.day_of_month}일</span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold text-gray-800">
                  {formatAmount(cost.amount)}
                </span>
              </div>
            ))}

            {inactiveCosts.length > 0 && (
              <>
                <div className="bg-gray-50 px-4 py-1.5">
                  <span className="text-xs font-medium text-gray-400">비활성</span>
                </div>
                {inactiveCosts.map((cost) => (
                  <div key={cost.id} className="flex items-center justify-between px-4 py-2.5 opacity-50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-500">{cost.name}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                        {(cost.category && FIXED_COST_CATEGORY[cost.category]) ?? cost.category ?? '기타'}
                      </span>
                    </div>
                    <span className="shrink-0 text-sm text-gray-500">{formatAmount(cost.amount)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* 자산/자금 현황 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="bg-gray-50 px-4 py-1.5 rounded-t-xl">
          <span className="text-xs font-medium text-gray-500">자산/자금 현황</span>
        </div>

        {assets.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">등록된 자산이 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {assets.map((asset) => (
              <AssetItem key={asset.id} asset={asset} onUpdate={onUpdateAsset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
