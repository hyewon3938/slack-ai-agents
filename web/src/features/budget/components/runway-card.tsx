'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RunwayResult } from '@/features/budget/lib/queries';
import type { MonthProjection } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { ArrowTrendingDownIcon } from '@/components/ui/icons';

/** 프로젝션 바 높이 (remaining 기준 0~100%) */
function barHeight(projection: MonthProjection, maxRemaining: number): number {
  if (maxRemaining <= 0) return 0;
  return Math.max(2, Math.round((projection.remaining / maxRemaining) * 100));
}

export function RunwayCard() {
  const [runway, setRunway] = useState<RunwayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProjections, setShowProjections] = useState(false);

  const fetchRunway = useCallback(() => {
    setLoading(true);
    fetch('/api/budget/runway')
      .then((r) => r.json())
      .then((d: { data: RunwayResult }) => setRunway(d.data))
      .catch(() => setRunway(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRunway();
  }, [fetchRunway]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-28 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
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

  const projections = runway.projections;
  const maxRemaining = projections.length > 0 ? projections[0].remaining : 0;

  // 할부가 줄어드는 월 찾기
  const installmentDropMonths = new Set<string>();
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].installments < projections[i - 1].installments) {
      installmentDropMonths.add(projections[i].month);
    }
  }

  // 실제 런웨이 vs 목표 비교
  const targetDate = runway.target_date;
  let targetGapMonths: number | null = null;
  if (targetDate) {
    const [ty, tm] = targetDate.split('-').map(Number);
    const [ry, rm] = runway.actual_runway_date.split('-').map(Number);
    targetGapMonths = Math.round(((ry - ty) * 12 + (rm - tm)) * 10) / 10;
  }

  const isDynamicDailyNegative = runway.dynamic_daily < 0;
  const isDynamicDailyLow = runway.dynamic_daily >= 0 && runway.dynamic_daily < 5000;

  return (
    <div className="space-y-3">
      {/* 1. 실제 런웨이 카드 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center gap-1.5">
          <ArrowTrendingDownIcon size={15} />
          <span className="text-xs font-semibold text-gray-500">실제 런웨이</span>
        </div>
        <div className="flex items-end gap-2 mb-1">
          <span className="text-3xl font-bold text-gray-900">{runway.actual_runway_months}개월</span>
          <span className="mb-0.5 text-sm text-gray-500">({runway.actual_runway_date}까지)</span>
        </div>
        {targetDate && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">목표 {targetDate}</span>
            {targetGapMonths !== null && (
              <span className={`text-xs font-semibold ${targetGapMonths > 0 ? 'text-green-600' : targetGapMonths < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                {targetGapMonths > 0 ? `+${targetGapMonths}개월 여유` : targetGapMonths < 0 ? `${targetGapMonths}개월 부족` : '목표 달성'}
              </span>
            )}
          </div>
        )}
        {!targetDate && (
          <p className="mt-1 text-xs text-gray-400">
            설정 탭에서 목표 기간을 설정하면 월별 예산이 자동 산정됩니다.
          </p>
        )}
      </div>

      {/* 2. 이번 달 예산 카드 */}
      {(runway.free_per_month !== null || runway.avg_variable_monthly > 0) && (
        <div className={`rounded-xl border p-4 shadow-sm ${
          isDynamicDailyNegative
            ? 'border-red-200 bg-red-50'
            : isDynamicDailyLow
              ? 'border-amber-100 bg-amber-50'
              : 'border-green-100 bg-green-50'
        }`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-gray-500">이번 달 자유 예산{runway.free_per_month === null ? ' (3개월 평균)' : ''}</span>
            <span className="text-sm font-semibold text-gray-700">{formatAmount(runway.free_per_month ?? runway.avg_variable_monthly)}</span>
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500">남은 자유 예산</span>
            <span className={`text-lg font-bold ${runway.month_budget_remaining < 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {formatAmount(runway.month_budget_remaining)}
            </span>
          </div>

          {/* 일일 자유 예산 */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">오늘 자유 예산</div>
              <div className={`text-2xl font-bold ${isDynamicDailyNegative ? 'text-red-600' : isDynamicDailyLow ? 'text-amber-600' : 'text-gray-900'}`}>
                {isDynamicDailyNegative ? '-' : ''}{formatAmount(Math.abs(runway.dynamic_daily))}
              </div>
              {isDynamicDailyNegative && (
                <div className="text-xs text-red-500 mt-0.5">
                  이번 달 {formatAmount(Math.abs(runway.month_budget_remaining))} 초과 — 남은 {runway.cycle_remaining_days}일 최대한 아껴봐
                </div>
              )}
            </div>
            <div className="text-right text-xs text-gray-400">
              <div>{runway.cycle_elapsed}일 경과</div>
              <div>남은 {runway.cycle_remaining_days}일</div>
            </div>
          </div>

          {/* 진행 바 */}
          <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isDynamicDailyNegative ? 'bg-red-400' : 'bg-green-500'}`}
              style={{ width: `${Math.min(100, (runway.cycle_elapsed / runway.cycle_days) * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>지출: {formatAmount(runway.flexible_spent)}</span>
            {runway.current_month_income > 0 && (
              <span className="text-green-600">수입: +{formatAmount(runway.current_month_income)}</span>
            )}
            <span>{runway.cycle_days}일 주기</span>
          </div>
        </div>
      )}

      {/* 3. 월별 시뮬레이션 */}
      {projections.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <button
            onClick={() => setShowProjections(!showProjections)}
            className="mb-2 text-xs text-gray-400 hover:text-gray-600"
          >
            월별 시뮬레이션 {showProjections ? '접기' : '펼치기'} ({projections.length}개월)
          </button>

          {/* 미니 바 차트 */}
          {!showProjections && (
            <div className="flex items-end gap-px h-12">
              {projections.map((p) => (
                <div
                  key={p.month}
                  className={`flex-1 rounded-t-sm ${installmentDropMonths.has(p.month) ? 'bg-blue-400' : 'bg-gray-300'}`}
                  style={{ height: `${barHeight(p, maxRemaining)}%` }}
                  title={`${p.month}: 잔액 ${formatAmount(p.remaining)}`}
                />
              ))}
            </div>
          )}

          {/* 상세 테이블 */}
          {showProjections && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-gray-400">
                    <th className="px-2 py-1.5 text-left font-normal">월</th>
                    <th className="px-2 py-1.5 text-right font-normal">잠긴돈</th>
                    <th className="px-2 py-1.5 text-right font-normal">자유</th>
                    <th className="px-2 py-1.5 text-right font-normal">잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.map((p) => (
                    <tr
                      key={p.month}
                      className={`border-t border-gray-50 ${installmentDropMonths.has(p.month) ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-2 py-1.5 text-gray-600">
                        {p.month.slice(2)}
                        {installmentDropMonths.has(p.month) && (
                          <span className="ml-1 text-blue-500">*</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-500">
                        {formatAmount(p.locked)}
                        {p.installments > 0 && (
                          <span className="text-[10px] text-gray-400 ml-0.5">
                            (할부 {formatAmount(p.installments)})
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-500">{formatAmount(p.free_budget)}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-gray-700">{formatAmount(p.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {installmentDropMonths.size > 0 && (
                <div className="px-2 py-1.5 text-[10px] text-blue-500 bg-gray-50 border-t border-gray-100">
                  * 할부 종료로 잠긴돈 감소
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. 참고 수치 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <div>
            <div className="text-gray-400">실시간 가용자금</div>
            <div className="font-medium text-gray-700">{formatAmount(runway.effective_available)}</div>
          </div>
          <div>
            <div className="text-gray-400">월 고정비</div>
            <div className="font-medium text-gray-700">{formatAmount(runway.fixed_monthly)}</div>
          </div>
          {runway.free_per_month !== null && (
            <div>
              <div className="text-gray-400">월 자유 예산</div>
              <div className="font-medium text-gray-700">{formatAmount(runway.free_per_month)}</div>
            </div>
          )}
          <div>
            <div className="text-gray-400">3개월 평균 지출</div>
            <div className="font-medium text-gray-700">{formatAmount(runway.avg_variable_monthly)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
