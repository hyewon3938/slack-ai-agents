'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FixedCostRow, AssetRow, CategoryLimitWithUsage } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { FixedCostItem } from './fixed-cost-item';
import { FixedCostAddForm } from './fixed-cost-add-form';
import { CategoryLimitItem } from './category-limit-item';
import { CategoryLimitAddForm } from './category-limit-add-form';
import { AssetItem } from './asset-item';
import { TargetDateCard } from './target-date-card';
import { sendJson } from '@/lib/send-json';

// ─── 메인 설정 페이지 ─────────────────────────────────

export function BudgetSettingsPage({ onSettingsChange }: { onSettingsChange?: () => void }) {
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [categoryLimits, setCategoryLimits] = useState<CategoryLimitWithUsage[]>([]);
  const [savedTarget, setSavedTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fixedRes, assetsRes, settingsRes, limitsRes] = await Promise.all([
        fetch('/api/budget/fixed-costs'),
        fetch('/api/budget/assets'),
        fetch('/api/budget/settings'),
        fetch('/api/budget/category-limits'),
      ]);
      if (fixedRes.ok) {
        const d = (await fixedRes.json()) as { data: FixedCostRow[] };
        setFixedCosts(d.data);
      }
      if (assetsRes.ok) {
        const d = (await assetsRes.json()) as { data: AssetRow[] };
        setAssets(d.data);
      }
      if (settingsRes.ok) {
        const d = (await settingsRes.json()) as { data: { target_date: string | null } };
        setSavedTarget(d.data.target_date);
      }
      if (limitsRes.ok) {
        const d = (await limitsRes.json()) as { data: CategoryLimitWithUsage[] };
        setCategoryLimits(d.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleAddFixedCost = async (data: {
    name: string;
    amount: number;
    category?: string;
    day_of_month?: number | null;
    payment_method?: string | null;
  }) => {
    const res = await sendJson('/api/budget/fixed-costs', 'POST', data);
    if (!res.ok) throw new Error('고정비 추가 실패');
    const { data: newCost } = (await res.json()) as { data: FixedCostRow };
    setFixedCosts((prev) => [...prev, newCost]);
    onSettingsChange?.();
  };

  const handleUpdateFixedCost = async (id: number, updates: Record<string, unknown>) => {
    const res = await sendJson(`/api/budget/fixed-costs/${id}`, 'PATCH', updates);
    if (!res.ok) throw new Error('고정비 수정 실패');
    const { data } = (await res.json()) as { data: FixedCostRow };
    setFixedCosts((prev) => prev.map((c) => (c.id === id ? data : c)));
    onSettingsChange?.();
  };

  const handleDeleteFixedCost = async (id: number) => {
    const res = await fetch(`/api/budget/fixed-costs/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('고정비 삭제 실패');
    setFixedCosts((prev) => prev.filter((c) => c.id !== id));
    onSettingsChange?.();
  };

  const handleUpdateAsset = async (
    id: number,
    balance: number,
    available_amount: number,
    balanceAsOf?: string,
  ) => {
    const res = await sendJson(`/api/budget/assets/${id}`, 'PATCH', {
      balance,
      available_amount,
      balance_as_of: balanceAsOf,
    });
    if (!res.ok) throw new Error('자산 수정 실패');
    const { data } = (await res.json()) as { data: AssetRow };
    setAssets((prev) => prev.map((a) => (a.id === id ? data : a)));
    onSettingsChange?.();
  };

  const handleToggleDefault = async (id: number, next: boolean) => {
    const res = await sendJson(`/api/budget/assets/${id}`, 'PATCH', { is_default: next });
    if (!res.ok) throw new Error('기본 자산 설정 실패');
    // 다른 자산의 is_default가 변경되었을 수 있어 전체 재조회
    await fetchAll();
    onSettingsChange?.();
  };

  const handleAddCategoryLimit = async (data: { category: string; target_count: number }) => {
    const res = await sendJson('/api/budget/category-limits', 'POST', data);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? '한도 추가 실패');
    }
    await fetchAll();
    onSettingsChange?.();
  };

  const handleUpdateCategoryLimit = async (id: number, target_count: number) => {
    const res = await sendJson(`/api/budget/category-limits/${id}`, 'PATCH', { target_count });
    if (!res.ok) throw new Error('한도 수정 실패');
    setCategoryLimits((prev) => prev.map((l) => (l.id === id ? { ...l, target_count } : l)));
    onSettingsChange?.();
  };

  const handleDeleteCategoryLimit = async (id: number) => {
    const res = await fetch(`/api/budget/category-limits/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('한도 삭제 실패');
    setCategoryLimits((prev) => prev.filter((l) => l.id !== id));
    onSettingsChange?.();
  };

  const activeCosts = fixedCosts.filter((c) => c.active);
  const inactiveCosts = fixedCosts.filter((c) => !c.active);
  const totalFixed = activeCosts.reduce((s, c) => s + c.amount, 0);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 목표 기간 설정 */}
      <TargetDateCard
        savedTarget={savedTarget}
        onSaved={(target) => {
          setSavedTarget(target);
          onSettingsChange?.();
        }}
      />

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
              <FixedCostItem
                key={cost.id}
                cost={cost}
                onUpdate={handleUpdateFixedCost}
                onDelete={handleDeleteFixedCost}
              />
            ))}

            {inactiveCosts.length > 0 && (
              <>
                <div className="bg-gray-50 px-4 py-1.5">
                  <span className="text-xs font-medium text-gray-400">비활성</span>
                </div>
                {inactiveCosts.map((cost) => (
                  <div
                    key={cost.id}
                    className="flex items-center justify-between px-4 py-2.5 opacity-50"
                  >
                    <span className="text-sm text-gray-500">{cost.name}</span>
                    <span className="text-sm text-gray-500">{formatAmount(cost.amount)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <FixedCostAddForm onAdd={handleAddFixedCost} />

        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-xs text-gray-400">
            결제일 설정 시 해당 날짜에 자동으로 지출 내역에 기록됩니다.
          </p>
        </div>
      </div>

      {/* 카테고리 한도 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded-t-xl">
          <h2 className="text-sm font-semibold text-gray-700">카테고리 한도</h2>
          <span className="text-xs text-gray-500">{categoryLimits.length}개</span>
        </div>

        {categoryLimits.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400">
            카테고리별 결제주기 한도를 설정해두면 지출 페이지에서 트래커 카드로 보여줄게.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {categoryLimits.map((limit) => (
              <CategoryLimitItem
                key={limit.id}
                limit={limit}
                onUpdate={handleUpdateCategoryLimit}
                onDelete={handleDeleteCategoryLimit}
              />
            ))}
          </div>
        )}

        <CategoryLimitAddForm
          existingCategories={categoryLimits.map((l) => l.category)}
          onAdd={handleAddCategoryLimit}
        />
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
              <AssetItem
                key={asset.id}
                asset={asset}
                onUpdate={handleUpdateAsset}
                onToggleDefault={handleToggleDefault}
              />
            ))}
          </div>
        )}

        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-xs text-gray-400">
            자금은 통장 잔액을 그대로 입력하고, 그 잔액이 며칠까지의 입출금을 반영한 값인지 기준일로
            같이 알려주세요. 아직 안 빠진 카드 대금은 결제 주기 정산 때 자동으로 차감됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
