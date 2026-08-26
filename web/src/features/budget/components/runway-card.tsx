'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RunwayProjectionResponse, MonthProjection } from '@/features/budget/lib/facade';
import { formatAmount } from '@/lib/types';
import { ArrowTrendingDownIcon } from '@/components/ui/icons';

/** 프로젝션 바 높이 (remaining 기준 0~100%) */
function barHeight(projection: MonthProjection, maxRemaining: number): number {
  if (maxRemaining <= 0) return 0;
  return Math.max(2, Math.round((projection.remaining / maxRemaining) * 100));
}

/** target 대비 gap(개월) — 양수면 여유, 음수면 부족. 두 인자 모두 'YYYY-MM'. */
function monthsGap(runwayDate: string, targetDate: string): number {
  const [ty, tm] = targetDate.split('-').map(Number);
  const [ry, rm] = runwayDate.split('-').map(Number);
  return Math.round(((ry - ty) * 12 + (rm - tm)) * 10) / 10;
}

export function RunwayCard() {
  const [runway, setRunway] = useState<RunwayProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProjections, setShowProjections] = useState(true);

  const fetchRunway = useCallback(() => {
    setLoading(true);
    fetch('/api/budget/runway')
      .then((r) => r.json())
      .then((d: { data: RunwayProjectionResponse }) => setRunway(d.data))
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

  const targetDate = runway.target_date;
  // 목표 대비 비교는 페이스 전망 기준 — 계획 전망은 배분상 항상 목표월에 수렴(동어반복)이라 정보가 없음.
  const paceGapMonths = targetDate ? monthsGap(runway.pace_runway_date, targetDate) : null;

  return (
    <div className="space-y-3">
      {/* 1. 전망 카드 — 계획(목표 있을 때) / 페이스(항상) 병기 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-1.5">
          <ArrowTrendingDownIcon size={15} />
          <span className="text-xs font-semibold text-gray-500">지출 전망</span>
        </div>

        {/* 계획 전망 (목표 있을 때만) */}
        {targetDate && (
          <div className="mb-3">
            <div className="text-[11px] text-gray-400">계획 전망 · 목표 기간까지 배분 기준</div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-gray-900">
                {runway.actual_runway_months}개월
              </span>
              <span className="mb-0.5 text-xs text-gray-500">
                ({runway.actual_runway_date}까지)
              </span>
            </div>
          </div>
        )}

        {/* 페이스 전망 (항상) */}
        <div>
          <div className="text-[11px] text-gray-400">페이스 전망 · 최근 실지출 기준</div>
          <div className="flex items-end gap-2">
            <span className={`font-bold text-gray-900 ${targetDate ? 'text-2xl' : 'text-3xl'}`}>
              {runway.pace_runway_months}개월
            </span>
            <span className="mb-0.5 text-xs text-gray-500">({runway.pace_runway_date}까지)</span>
          </div>
        </div>

        {/* 목표 대비 — 페이스 기준 */}
        {targetDate && paceGapMonths !== null && (
          <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
            <span className="text-xs text-gray-400">목표 {targetDate}</span>
            <span
              className={`text-xs font-semibold ${paceGapMonths > 0 ? 'text-green-600' : paceGapMonths < 0 ? 'text-red-500' : 'text-gray-500'}`}
            >
              {paceGapMonths > 0
                ? `페이스 +${paceGapMonths}개월 여유`
                : paceGapMonths < 0
                  ? `페이스 ${paceGapMonths}개월 부족`
                  : '페이스 목표 도달'}
            </span>
          </div>
        )}
        {!targetDate && (
          <p className="mt-2 text-xs text-gray-400">
            설정 탭에서 목표 기간을 설정하면 월별 예산이 자동 산정됩니다.
          </p>
        )}
      </div>

      {/* 2. 월별 시뮬레이션 — 목표 있으면 계획 배분, 없으면 페이스 */}
      {projections.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <button
            onClick={() => setShowProjections(!showProjections)}
            className="mb-2 text-xs text-gray-400 hover:text-gray-600"
          >
            월별 시뮬레이션 {showProjections ? '접기' : '펼치기'} ({projections.length}개월)
          </button>
          <p className="mb-2 text-[10px] text-gray-400">
            {targetDate ? '목표 기간 배분 기준' : '최근 실지출 페이스 기준'}
          </p>

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
                      <td className="px-2 py-1.5 text-right text-gray-500">
                        {formatAmount(p.free_budget)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                        {formatAmount(p.remaining)}
                      </td>
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
          <div className={runway.funds_restored > 0 ? 'col-span-2' : undefined}>
            <div className="text-gray-400">예산 기준선</div>
            <div className="font-medium text-gray-700">
              {formatAmount(runway.effective_available)}
            </div>
            {runway.funds_restored > 0 && (
              <div className="mt-0.5 text-[10px] text-gray-400">
                입력 {formatAmount(runway.funds_balance)} + {runway.funds_as_of}까지 통장에서 나간
                지출 {formatAmount(runway.funds_restored)}
              </div>
            )}
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
            <div className="text-gray-400">최근 3주기 평균 변동지출</div>
            <div className="font-medium text-gray-700">
              {formatAmount(runway.avg_variable_monthly)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
