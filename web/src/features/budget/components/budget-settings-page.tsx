'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FixedCostRow, AssetRow } from '@/features/budget/lib/types';
import { MIN_DAILY_BUDGET, FIXED_COST_CATEGORIES } from '@/features/budget/lib/types';
import type { MonthBudgetPreview } from '@/features/budget/lib/queries';
import { formatAmount } from '@/lib/types';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

// ─── 고정비 수정 아이템 ─────────────────────────────────

function FixedCostItem({
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

  const handleSave = async () => {
    const a = Number(amount);
    if (isNaN(a) || a < 0) return;
    const day = dayOfMonth ? Number(dayOfMonth) : null;
    if (day !== null && (isNaN(day) || day < 1 || day > 31)) return;
    setSaving(true);
    try {
      await onUpdate(cost.id, { amount: a, day_of_month: day });
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
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{cost.category}</span>
          )}
          {cost.is_variable && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500">변동</span>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => { setAmount(String(cost.amount)); setDayOfMonth(String(cost.day_of_month ?? '')); setEditing(true); }}
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
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">결제일</label>
            <input type="number" min="1" max="31" placeholder="미설정" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
            <span className="text-xs text-gray-400">일</span>
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => { if (confirm('이 고정지출을 삭제할까?')) void onDelete(cost.id); }}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-600"
            >
              삭제
            </button>
            <div className="flex gap-1.5">
              <button onClick={() => setEditing(false)} disabled={saving} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><XMarkIcon size={16} /></button>
              <button onClick={() => void handleSave()} disabled={saving} className="rounded-md p-1 text-blue-500 hover:bg-blue-50"><CheckCircleIcon size={16} /></button>
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
        </div>
      )}
    </div>
  );
}

// ─── 고정비 추가 폼 ──────────────────────────────────

function FixedCostAddForm({ onAdd }: { onAdd: (data: { name: string; amount: number; category?: string; day_of_month?: number | null }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const a = Number(amount.replace(/,/g, ''));
    if (!name.trim() || isNaN(a) || a <= 0) return;
    const day = dayOfMonth ? Number(dayOfMonth) : null;
    if (day !== null && (isNaN(day) || day < 1 || day > 31)) return;
    setSaving(true);
    try {
      await onAdd({ name: name.trim(), amount: a, category: category || undefined, day_of_month: day });
      setName(''); setAmount(''); setCategory(''); setDayOfMonth('');
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
        <input type="text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none" autoFocus />
      </div>
      <div className="flex items-center gap-2">
        <input type="text" inputMode="numeric" placeholder="금액" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
        <input type="number" min="1" max="31" placeholder="결제일" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}
          className="w-20 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none">
          <option value="">카테고리 선택</option>
          {FIXED_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setOpen(false)} className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-100">취소</button>
        <button onClick={() => void handleSubmit()} disabled={saving || !name.trim() || !amount}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40 hover:bg-blue-700">
          {saving ? '추가 중...' : '추가'}
        </button>
      </div>
    </div>
  );
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

// ─── 목표 기간 설정 카드 ──────────────────────────────

interface BudgetPreviewData {
  free_per_month: number;
  daily_estimate: number;
  month_breakdown: MonthBudgetPreview[];
}

function TargetDateCard({
  savedTarget,
  onSaved,
}: {
  savedTarget: string | null;
  onSaved: (target: string) => void;
}) {
  const [inputValue, setInputValue] = useState(savedTarget ?? '');
  const [preview, setPreview] = useState<BudgetPreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);

  // 초기 프리뷰 로드 (저장된 목표가 있으면)
  useEffect(() => {
    if (savedTarget && /^\d{4}-\d{2}$/.test(savedTarget)) {
      void fetchPreview(savedTarget);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTarget]);

  const fetchPreview = async (target: string) => {
    if (!/^\d{4}-\d{2}$/.test(target)) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/budget/settings?previewTarget=${target}`);
      if (res.ok) {
        const d = (await res.json()) as { data: BudgetPreviewData };
        setPreview(d.data);
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleInputChange = (val: string) => {
    setInputValue(val);
    if (/^\d{4}-\d{2}$/.test(val)) {
      void fetchPreview(val);
    } else {
      setPreview(null);
    }
  };

  const handleSave = async () => {
    if (!inputValue || !/^\d{4}-\d{2}$/.test(inputValue)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/budget/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: inputValue }),
      });
      if (res.ok) {
        onSaved(inputValue);
      }
    } finally {
      setSaving(false);
    }
  };

  const isDailyLow = preview && preview.daily_estimate < MIN_DAILY_BUDGET;
  const displayMonths = showAllMonths
    ? preview?.month_breakdown
    : preview?.month_breakdown.slice(0, 4);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">목표 기간</h2>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="month"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          onClick={() => void handleSave()}
          disabled={saving || !inputValue || !/^\d{4}-\d{2}$/.test(inputValue)}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-700 transition"
        >
          {saving ? '저장 중...' : '설정'}
        </button>
      </div>

      {savedTarget && (
        <p className="mb-3 text-xs text-gray-400">현재 설정: <span className="font-medium text-gray-600">{savedTarget}</span></p>
      )}

      {/* 프리뷰 */}
      {loadingPreview && (
        <div className="mt-2 h-20 animate-pulse rounded-lg bg-gray-100" />
      )}

      {preview && !loadingPreview && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          {/* 요약 */}
          <div className="mb-2 flex items-center justify-between">
            <div>
              <span className="text-xs text-gray-500">월 자유 예산</span>
              <span className="ml-2 text-base font-bold text-gray-800">{formatAmount(preview.free_per_month)}</span>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-500">하루</span>
              <span className={`ml-1 text-base font-bold ${isDailyLow ? 'text-red-500' : 'text-gray-800'}`}>
                {formatAmount(preview.daily_estimate)}
              </span>
            </div>
          </div>

          {isDailyLow && (
            <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              하루 {formatAmount(preview.daily_estimate)}으로 설정됩니다. 기간을 줄이거나 자금을 늘리면 더 여유로워져요.
            </div>
          )}

          {/* 월별 브레이크다운 */}
          <div className="divide-y divide-gray-100">
            {displayMonths?.map((m, i) => (
              <div key={m.month} className={`flex items-center justify-between py-1.5 text-xs ${i === 0 ? 'pt-0' : ''}`}>
                <span className="text-gray-500">{m.month.slice(2)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">잠긴 {formatAmount(m.locked)}</span>
                  <span className="font-medium text-gray-700">자유 {formatAmount(m.free)}</span>
                  <span className="text-gray-400">일 {formatAmount(m.daily)}</span>
                </div>
              </div>
            ))}
          </div>

          {preview.month_breakdown.length > 4 && (
            <button
              onClick={() => setShowAllMonths(!showAllMonths)}
              className="mt-1.5 text-[11px] text-blue-500 hover:underline"
            >
              {showAllMonths ? '접기' : `+${preview.month_breakdown.length - 4}개월 더 보기`}
            </button>
          )}
        </div>
      )}

      {!preview && !loadingPreview && (
        <p className="text-xs text-gray-400">
          목표 기간을 설정하면 월별 예산과 일일 자유 예산을 미리 확인할 수 있습니다.
        </p>
      )}
    </div>
  );
}

// ─── 메인 설정 페이지 ─────────────────────────────────

export function BudgetSettingsPage({ onSettingsChange }: { onSettingsChange?: () => void }) {
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [savedTarget, setSavedTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fixedRes, assetsRes, settingsRes] = await Promise.all([
        fetch('/api/budget/fixed-costs'),
        fetch('/api/budget/assets'),
        fetch('/api/budget/settings'),
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const handleAddFixedCost = async (data: { name: string; amount: number; category?: string; day_of_month?: number | null }) => {
    const res = await fetch('/api/budget/fixed-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('고정비 추가 실패');
    const { data: newCost } = (await res.json()) as { data: FixedCostRow };
    setFixedCosts((prev) => [...prev, newCost]);
    onSettingsChange?.();
  };

  const handleUpdateFixedCost = async (id: number, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/budget/fixed-costs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
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

  const handleUpdateAsset = async (id: number, balance: number, available_amount: number) => {
    const res = await fetch(`/api/budget/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance, available_amount }),
    });
    if (!res.ok) throw new Error('자산 수정 실패');
    const { data } = (await res.json()) as { data: AssetRow };
    setAssets((prev) => prev.map((a) => (a.id === id ? data : a)));
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
        onSaved={(target) => { setSavedTarget(target); onSettingsChange?.(); }}
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
              <FixedCostItem key={cost.id} cost={cost} onUpdate={handleUpdateFixedCost} onDelete={handleDeleteFixedCost} />
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

        <FixedCostAddForm onAdd={handleAddFixedCost} />

        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-xs text-gray-400">
            결제일 설정 시 해당 날짜에 자동으로 지출 내역에 기록됩니다.
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

        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-xs text-gray-400">
            잔액 업데이트 시 이후 지출/수입 내역이 자동으로 차감·가산되어 런웨이에 반영됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
