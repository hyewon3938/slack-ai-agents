'use client';

import { useState, useEffect } from 'react';
import { MIN_DAILY_BUDGET } from '@/features/budget/lib/types';
import { getCurrentBillingMonth } from '@/features/budget/lib/billing/cycle';
import { formatAmount } from '@/lib/types';
import { sendJson } from '@/lib/send-json';

interface MonthBreakdownItem {
  month: string;
  locked: number;
  installments: number;
  planned: number;
  free: number;
  daily: number;
}

interface BudgetPreviewData {
  free_per_month: number;
  daily_estimate: number;
  month_breakdown: MonthBreakdownItem[];
}

export function TargetDateCard({
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

  // target_date 저장 — 단순 upsert (#539, ADR 0051).
  // 묶인 돈이 목표 기간 창 라이브 계산으로 바뀌어, 변경 시 자산 보정·영향 분석이 불필요해졌다.
  const handleSave = async () => {
    if (!inputValue || !/^\d{4}-\d{2}$/.test(inputValue)) return;
    setSaving(true);
    try {
      const res = await sendJson('/api/budget/settings', 'PUT', { target_date: inputValue });
      if (res.ok) onSaved(inputValue);
    } finally {
      setSaving(false);
    }
  };

  const isDailyLow = preview && preview.daily_estimate < MIN_DAILY_BUDGET;
  const displayMonths = showAllMonths
    ? preview?.month_breakdown
    : preview?.month_breakdown.slice(0, 4);

  // 목표 기간 만료/임박 경고 (#539) — 자동 롤링 없이 수동 연장이라 미리 알려준다.
  const targetMonthsLeft = (() => {
    if (!savedTarget || !/^\d{4}-\d{2}$/.test(savedTarget)) return null;
    const [ty, tm] = savedTarget.split('-').map(Number);
    const [cy, cm] = getCurrentBillingMonth(new Date()).split('-').map(Number);
    return (ty - cy) * 12 + (tm - cm);
  })();

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
        <p className="mb-3 text-xs text-gray-400">
          현재 설정: <span className="font-medium text-gray-600">{savedTarget}</span>
        </p>
      )}

      {targetMonthsLeft !== null && targetMonthsLeft < 0 && (
        <div className="mb-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
          목표 기간이 지났어. 새 목표를 정해줘 — 안 그러면 예산 계산이 멈춰.
        </div>
      )}
      {targetMonthsLeft !== null && targetMonthsLeft >= 0 && targetMonthsLeft <= 1 && (
        <div className="mb-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          목표 기간이 거의 다 됐어{targetMonthsLeft === 0 ? ' (이번 달)' : ' (다음 달)'}. 미리 새로
          정해두면 일 예산이 출렁이는 걸 막을 수 있어.
        </div>
      )}

      {/* 프리뷰 */}
      {loadingPreview && <div className="mt-2 h-20 animate-pulse rounded-lg bg-gray-100" />}

      {preview && !loadingPreview && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          {/* 요약 */}
          <div className="mb-2 flex items-center justify-between">
            <div>
              <span className="text-xs text-gray-500">월 자유 예산</span>
              <span className="ml-2 text-base font-bold text-gray-800">
                {formatAmount(preview.free_per_month)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-500">하루</span>
              <span
                className={`ml-1 text-base font-bold ${isDailyLow ? 'text-red-500' : 'text-gray-800'}`}
              >
                {formatAmount(preview.daily_estimate)}
              </span>
            </div>
          </div>

          {isDailyLow && (
            <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              하루 {formatAmount(preview.daily_estimate)}으로 설정됩니다. 기간을 줄이거나 자금을
              늘리면 더 여유로워져요.
            </div>
          )}

          {/* 월별 브레이크다운 */}
          <div className="divide-y divide-gray-100">
            {displayMonths?.map((m, i) => (
              <div
                key={m.month}
                className={`flex items-center justify-between py-1.5 text-xs ${i === 0 ? 'pt-0' : ''}`}
              >
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
