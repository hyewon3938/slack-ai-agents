'use client';

import { useState, useEffect } from 'react';
import type { RunwayResult } from '@/features/budget/lib/queries';
import { formatAmount } from '@/lib/types';
import { ArrowTrendingDownIcon, ExclamationTriangleIcon } from '@/components/ui/icons';

export function RunwayCard() {
  const [runway, setRunway] = useState<RunwayResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/budget/runway')
      .then((r) => r.json())
      .then((d: { data: RunwayResult }) => setRunway(d.data))
      .catch(() => setRunway(null))
      .finally(() => setLoading(false));
  }, []);

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
        런웨이 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const runwayMonths = runway.runway_months;
  const isDanger = runwayMonths < 3;
  const isWarning = runwayMonths < 5;

  // 취업 목표: 7월 (2026-07)
  const TARGET_MONTH = '2026-07';
  const now = new Date();
  const targetDate = new Date(TARGET_MONTH + '-01');
  const monthsToTarget = (targetDate.getFullYear() - now.getFullYear()) * 12 + targetDate.getMonth() - now.getMonth();
  const hasEnoughRunway = runwayMonths >= monthsToTarget;

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${isDanger ? 'border-red-200 bg-red-50' : isWarning ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <ArrowTrendingDownIcon size={16} />
          런웨이 분석
        </h2>
        {isDanger && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600">
            <ExclamationTriangleIcon size={14} />
            위험
          </span>
        )}
      </div>

      <div className="mb-3 flex items-end gap-1">
        <span className={`text-3xl font-bold ${isDanger ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900'}`}>
          {runwayMonths}개월
        </span>
        <span className="mb-0.5 text-sm text-gray-500">({runway.runway_date}까지)</span>
      </div>

      {/* 취업 목표 대비 */}
      <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${hasEnoughRunway ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {hasEnoughRunway
          ? `취업 목표(7월)까지 ${monthsToTarget}개월 필요 — 런웨이 충분`
          : `취업 목표(7월)까지 ${monthsToTarget}개월 필요 — 런웨이 부족! ${Math.round(monthsToTarget - runwayMonths * 10) / 10}개월 부족`}
      </div>

      {/* 상세 */}
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>
          <div className="text-gray-400">총 가용 자금</div>
          <div className="font-medium text-gray-700">{formatAmount(runway.total_available)}</div>
        </div>
        <div>
          <div className="text-gray-400">월 순지출 추정</div>
          <div className="font-medium text-gray-700">{formatAmount(runway.estimated_monthly_net)}</div>
        </div>
        <div>
          <div className="text-gray-400">월 고정비</div>
          <div className="font-medium text-gray-700">{formatAmount(runway.fixed_monthly)}</div>
        </div>
        <div>
          <div className="text-gray-400">평균 가변 지출</div>
          <div className="font-medium text-gray-700">{formatAmount(runway.avg_variable_monthly)}</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        * 리커밋 수입 60만원/월 반영, 쿠팡 정산 제외
      </div>
    </div>
  );
}
