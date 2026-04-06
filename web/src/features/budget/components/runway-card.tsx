'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RunwayResult } from '@/features/budget/lib/queries';
import { formatAmount } from '@/lib/types';
import { ArrowTrendingDownIcon, ExclamationTriangleIcon, CheckCircleIcon, PencilIcon, XMarkIcon } from '@/components/ui/icons';

const STORAGE_KEY = 'budget_target_date';

function getStoredTargetDate(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function RunwayCard() {
  const [runway, setRunway] = useState<RunwayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  const fetchRunway = useCallback((targetDate?: string) => {
    setLoading(true);
    const params = targetDate ? `?targetDate=${targetDate}` : '';
    fetch(`/api/budget/runway${params}`)
      .then((r) => r.json())
      .then((d: { data: RunwayResult }) => setRunway(d.data))
      .catch(() => setRunway(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const stored = getStoredTargetDate();
    fetchRunway(stored || undefined);
  }, [fetchRunway]);

  const handleSaveTarget = () => {
    const val = targetInput.trim();
    if (val && !/^\d{4}-\d{2}$/.test(val)) return;
    localStorage.setItem(STORAGE_KEY, val);
    setEditingTarget(false);
    fetchRunway(val || undefined);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="h-20 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (!runway) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-sm text-gray-400">
        데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const isOverBudget = runway.over_budget > 0;
  const budgetMonths = runway.budget_runway_months;
  const actualMonths = runway.actual_runway_months;

  return (
    <div className="space-y-3">
      {/* 목표 기간 설정 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">목표 기간</div>
          {!editingTarget && (
            <button
              onClick={() => { setTargetInput(getStoredTargetDate()); setEditingTarget(true); }}
              className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
            >
              <PencilIcon size={13} />
            </button>
          )}
        </div>
        {editingTarget ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="month"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
            />
            <button onClick={() => setEditingTarget(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><XMarkIcon size={16} /></button>
            <button onClick={handleSaveTarget} className="rounded-md p-1 text-blue-500 hover:bg-blue-50"><CheckCircleIcon size={16} /></button>
          </div>
        ) : (
          <div className="text-sm font-semibold text-gray-800">
            {runway.target_date ? `${runway.target_date}까지` : '미설정'}
          </div>
        )}
      </div>

      {/* 예산 추천 */}
      {runway.recommended_budget !== null && runway.target_date && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <div className="text-xs text-blue-600 mb-1">추천 월 가변 예산</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-blue-700">
              {formatAmount(runway.recommended_budget)}
            </span>
            <span className="mb-0.5 text-xs text-blue-500">/ 월</span>
          </div>
          <p className="mt-1.5 text-xs text-blue-500">
            가용 자금 {formatAmount(runway.total_available)} 기준, {runway.target_date}까지 유지
          </p>
          {runway.monthly_budget !== null && runway.recommended_budget !== runway.monthly_budget && (
            <p className="mt-1 text-xs text-blue-600 font-medium">
              현재 설정: {formatAmount(runway.monthly_budget)}
              {runway.monthly_budget > runway.recommended_budget
                ? ` (추천보다 ${formatAmount(runway.monthly_budget - runway.recommended_budget)} 많음)`
                : ` (추천보다 ${formatAmount(runway.recommended_budget - runway.monthly_budget)} 적음)`}
            </p>
          )}
        </div>
      )}

      {/* 메인 런웨이 카드 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <ArrowTrendingDownIcon size={16} />
            지출 분석
          </h2>
          {isOverBudget ? (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <ExclamationTriangleIcon size={14} />
              예산 초과 중
            </span>
          ) : runway.monthly_budget !== null ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircleIcon size={14} />
              예산 내
            </span>
          ) : null}
        </div>

        {/* 예산 기준 런웨이 (메인) */}
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-1">예산대로 살면</div>
          <div className="flex items-end gap-1">
            <span className="text-3xl font-bold text-gray-900">
              {budgetMonths}개월
            </span>
            <span className="mb-0.5 text-sm text-gray-500">({runway.budget_runway_date}까지)</span>
          </div>
        </div>

        {/* 실제 런웨이 (비교) */}
        {isOverBudget && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-red-600">현재 소비 패턴 유지 시</span>
              <span className="font-semibold text-red-700">{actualMonths}개월 ({runway.actual_runway_date}까지)</span>
            </div>
            <div className="mt-1 text-xs text-red-500">
              매달 {formatAmount(runway.over_budget)} 초과 → 런웨이 {Math.round((budgetMonths - actualMonths) * 10) / 10}개월 단축
            </div>
          </div>
        )}

        {/* 상세 */}
        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <div>
            <div className="text-gray-400">총 가용 자금</div>
            <div className="font-medium text-gray-700">{formatAmount(runway.total_available)}</div>
          </div>
          <div>
            <div className="text-gray-400">월 고정비</div>
            <div className="font-medium text-gray-700">{formatAmount(runway.fixed_monthly)}</div>
          </div>
          <div>
            <div className="text-gray-400">월 가변 예산</div>
            <div className="font-medium text-gray-700">
              {runway.monthly_budget !== null ? formatAmount(runway.monthly_budget) : '미설정'}
            </div>
          </div>
          <div>
            <div className="text-gray-400">실제 월 평균</div>
            <div className={`font-medium ${isOverBudget ? 'text-red-600' : 'text-gray-700'}`}>
              {formatAmount(runway.avg_variable_monthly)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
