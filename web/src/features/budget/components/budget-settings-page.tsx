'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FixedCostRow, AssetRow, BudgetRow } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { ChevronLeftIcon, PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

/** 현재 결제주기의 대금 월 */
function getCurrentBillingMonth(): string {
  const now = new Date();
  if (now.getDate() >= 16) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  return now.toISOString().slice(0, 7);
}

// ─── 자산 수정 아이템 ─────────────────────────────────

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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{asset.name}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{asset.type}</span>
          {asset.is_emergency && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">비상금</span>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => { setBalance(String(asset.balance)); setAvailable(String(asset.available_amount ?? asset.balance)); setEditing(true); }}
            className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
          >
            <PencilIcon size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">잔액</label>
            <input type="number" value={balance} onChange={(e) => setBalance(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">사용가능</label>
            <input type="number" value={available} onChange={(e) => setAvailable(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setEditing(false)} disabled={saving} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><XMarkIcon size={16} /></button>
            <button onClick={() => void handleSave()} disabled={saving} className="rounded-md p-1 text-blue-500 hover:bg-blue-50"><CheckCircleIcon size={16} /></button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-4 text-sm">
          <span><span className="text-xs text-gray-400">잔액 </span><span className="font-semibold text-gray-800">{formatAmount(asset.balance)}</span></span>
          {asset.available_amount !== null && asset.available_amount !== asset.balance && (
            <span><span className="text-xs text-gray-400">사용가능 </span><span className="font-semibold text-gray-800">{formatAmount(asset.available_amount)}</span></span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 설정 페이지 ─────────────────────────────────

export function BudgetSettingsPage() {
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [budget, setBudget] = useState<BudgetRow | null>(null);
  const [loading, setLoading] = useState(true);

  // 예산 수정 상태
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const yearMonth = getCurrentBillingMonth();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fixedRes, assetsRes, budgetRes] = await Promise.all([
        fetch('/api/budget/fixed-costs'),
        fetch('/api/budget/assets'),
        fetch(`/api/budget?yearMonth=${yearMonth}`),
      ]);
      if (fixedRes.ok) {
        const d = (await fixedRes.json()) as { data: FixedCostRow[] };
        setFixedCosts(d.data);
      }
      if (assetsRes.ok) {
        const d = (await assetsRes.json()) as { data: AssetRow[] };
        setAssets(d.data);
      }
      if (budgetRes.ok) {
        const d = (await budgetRes.json()) as { data: BudgetRow | null };
        setBudget(d.data);
      }

    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const handleUpdateAsset = async (id: number, balance: number, available_amount: number) => {
    const res = await fetch(`/api/budget/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance, available_amount }),
    });
    if (!res.ok) throw new Error('자산 수정 실패');
    const { data } = (await res.json()) as { data: AssetRow };
    setAssets((prev) => prev.map((a) => (a.id === id ? data : a)));
  };

  const handleSaveBudget = async () => {
    const amount = parseInt(budgetInput.replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) return;
    setSavingBudget(true);
    try {
      const res = await fetch('/api/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: yearMonth, total_budget: amount }),
      });
      if (res.ok) {
        const { data } = (await res.json()) as { data: BudgetRow };
        setBudget(data);
        setEditingBudget(false);
      }
    } finally {
      setSavingBudget(false);
    }
  };

  const activeCosts = fixedCosts.filter((c) => c.active);
  const inactiveCosts = fixedCosts.filter((c) => !c.active);
  const totalFixed = activeCosts.reduce((s, c) => s + c.amount, 0);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-4">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-100 mb-4" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-100 mb-4" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      {/* 헤더 */}
      <div className="mb-4 flex items-center gap-2">
        <a href="/budget" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ChevronLeftIcon size={18} />
        </a>
        <h1 className="text-base font-bold text-gray-900">예산 설정</h1>
      </div>

      <div className="space-y-4">
        {/* 월 예산 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">월 가변 예산</h2>
            {!editingBudget && (
              <button
                onClick={() => { setBudgetInput(String(budget?.total_budget ?? '')); setEditingBudget(true); }}
                className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
              >
                <PencilIcon size={14} />
              </button>
            )}
          </div>

          {editingBudget ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={budgetInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, '');
                  const num = parseInt(raw, 10);
                  setBudgetInput(raw ? num.toLocaleString('ko-KR') : '');
                }}
                placeholder="월 예산 입력"
                className="flex-1 rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
              <button onClick={() => setEditingBudget(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><XMarkIcon size={16} /></button>
              <button onClick={() => void handleSaveBudget()} disabled={savingBudget} className="rounded-md p-1 text-blue-500 hover:bg-blue-50"><CheckCircleIcon size={16} /></button>
            </div>
          ) : (
            <div>
              <span className="text-2xl font-bold text-gray-900">
                {budget?.total_budget ? formatAmount(budget.total_budget) : '미설정'}
              </span>
              <p className="mt-1 text-xs text-gray-400">고정비/할부 제외, 자유롭게 쓸 수 있는 월 예산</p>
              <p className="mt-0.5 text-xs text-gray-400">분석 탭에서 추천 예산 확인 가능</p>
            </div>
          )}
        </div>

        {/* 고정 지출 */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded-t-xl">
            <h2 className="text-sm font-semibold text-gray-700">고정 지출</h2>
            <span className="text-xs text-gray-500">합계 {formatAmount(totalFixed)}</span>
          </div>

          {activeCosts.length === 0 && inactiveCosts.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">등록된 고정 지출이 없습니다.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activeCosts.map((cost) => (
                <div key={cost.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-medium text-gray-700">{cost.name}</span>
                    {cost.category && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{cost.category}</span>
                    )}
                    {cost.is_variable && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500">변동</span>
                    )}
                    {cost.day_of_month && (
                      <span className="text-xs text-gray-400">매월 {cost.day_of_month}일</span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-gray-800 ml-2">
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
                      <span className="text-sm text-gray-500">{cost.name}</span>
                      <span className="text-sm text-gray-500">{formatAmount(cost.amount)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="border-t border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-400">
              결제일이 설정된 고정 지출은 해당 날짜에 자동으로 지출 내역에 기록됩니다.
            </p>
          </div>
        </div>

        {/* 자산/자금 */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="bg-gray-50 px-4 py-2 rounded-t-xl">
            <h2 className="text-sm font-semibold text-gray-700">자산/자금 현황</h2>
          </div>

          {assets.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">등록된 자산이 없습니다.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {assets.map((asset) => (
                <AssetItem key={asset.id} asset={asset} onUpdate={handleUpdateAsset} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
