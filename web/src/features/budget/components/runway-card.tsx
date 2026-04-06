'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RunwayResult } from '@/features/budget/lib/queries';
import type { MonthProjection } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { ArrowTrendingDownIcon, PencilIcon, XMarkIcon, CheckCircleIcon } from '@/components/ui/icons';

/** 프로젝션 바 높이 (remaining 기준 0~100%) */
function barHeight(projection: MonthProjection, maxRemaining: number): number {
  if (maxRemaining <= 0) return 0;
  return Math.max(2, Math.round((projection.remaining / maxRemaining) * 100));
}

export function RunwayCard() {
  const [runway, setRunway] = useState<RunwayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [showProjections, setShowProjections] = useState(false);
  const [savedTarget, setSavedTarget] = useState<string | null>(null);

  const fetchRunway = useCallback((targetDate?: string) => {
    setLoading(true);
    const params = targetDate ? `?targetDate=${targetDate}` : '';
    fetch(`/api/budget/runway${params}`)
      .then((r) => r.json())
      .then((d: { data: RunwayResult }) => setRunway(d.data))
      .catch(() => setRunway(null))
      .finally(() => setLoading(false));
  }, []);

  // 초기 로드: DB에서 목표 기간 조회 → 런웨이 계산
  useEffect(() => {
    fetch('/api/budget/settings')
      .then((r) => r.json())
      .then((d: { data: { target_date: string | null } }) => {
        const td = d.data.target_date;
        setSavedTarget(td);
        fetchRunway(td ?? undefined);
      })
      .catch(() => fetchRunway());
  }, [fetchRunway]);

  const handleSaveTarget = async () => {
    const val = targetInput.trim();
    if (!val || !/^\d{4}-\d{2}$/.test(val)) return;
    try {
      await fetch('/api/budget/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: val }),
      });
      setSavedTarget(val);
      setEditingTarget(false);
      fetchRunway(val);
    } catch {
      // 저장 실패 시 무시
    }
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

  const isSaved = runway.cumulative_saved >= 0;
  const projections = runway.projections;
  const maxRemaining = projections.length > 0 ? projections[0].remaining : 0;

  // 할부가 줄어드는 월 찾기
  const installmentDropMonths = new Set<string>();
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].installments < projections[i - 1].installments) {
      installmentDropMonths.add(projections[i].month);
    }
  }

  return (
    <div className="space-y-3">
      {/* 일일 목표 + 누적 절약/초과 */}
      {runway.daily_target !== null && runway.target_date && (
        <div className={`rounded-xl border p-4 shadow-sm ${isSaved ? 'border-green-100 bg-green-50' : 'border-red-100 bg-red-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">일일 자유 예산</div>
            <span className="text-lg font-bold text-gray-800">{formatAmount(runway.daily_target)}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {runway.cycle_elapsed}일 경과 / {runway.cycle_days}일
            </div>
            <div className={`text-sm font-semibold ${isSaved ? 'text-green-700' : 'text-red-600'}`}>
              {isSaved
                ? `${formatAmount(runway.cumulative_saved)} 절약`
                : `${formatAmount(Math.abs(runway.cumulative_saved))} 초과`}
            </div>
          </div>
          {/* 진행 바 */}
          <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isSaved ? 'bg-green-500' : 'bg-red-400'}`}
              style={{ width: `${Math.min(100, (runway.cycle_elapsed / runway.cycle_days) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
            <span>지출: {formatAmount(runway.flexible_spent)}</span>
            <span>목표: {formatAmount(runway.daily_target * runway.cycle_elapsed)}</span>
          </div>
        </div>
      )}

      {/* 월 자유 예산 (자동 계산) */}
      {runway.recommended_budget !== null && runway.target_date && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <div className="text-xs text-blue-600 mb-1">월 자유 예산</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-blue-700">
              {formatAmount(runway.recommended_budget)}
            </span>
            <span className="mb-0.5 text-xs text-blue-500">/ 월</span>
          </div>
          <p className="mt-1.5 text-xs text-blue-500">
            {runway.target_date}까지 {formatAmount(runway.total_available)} 기준
            {runway.recommended_daily !== null && (
              <> (일 {formatAmount(runway.recommended_daily)})</>
            )}
          </p>
        </div>
      )}

      {/* 메인 런웨이 카드 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <ArrowTrendingDownIcon size={16} />
            런웨이
          </h2>
          {/* 목표 기간 */}
          {!editingTarget ? (
            <button
              onClick={() => { setTargetInput(savedTarget ?? ''); setEditingTarget(true); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              목표: {runway.target_date ?? '미설정'}
              <PencilIcon size={11} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="month"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                className="w-32 rounded-md border border-gray-200 px-1.5 py-1 text-xs focus:border-blue-400 focus:outline-none"
              />
              <button onClick={() => setEditingTarget(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><XMarkIcon size={14} /></button>
              <button onClick={handleSaveTarget} className="rounded-md p-1 text-blue-500 hover:bg-blue-50"><CheckCircleIcon size={14} /></button>
            </div>
          )}
        </div>

        {/* 런웨이 */}
        <div className="mb-3">
          <div className="flex items-end gap-1">
            <span className="text-3xl font-bold text-gray-900">
              {runway.budget_runway_months}개월
            </span>
            <span className="mb-0.5 text-sm text-gray-500">({runway.budget_runway_date}까지)</span>
          </div>
        </div>

        {/* 미니 프로젝션 바 차트 */}
        {projections.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowProjections(!showProjections)}
              className="mb-2 text-xs text-gray-400 hover:text-gray-600"
            >
              월별 시뮬레이션 {showProjections ? '접기' : '펼치기'} ({projections.length}개월)
            </button>
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
          </div>
        )}

        {/* 상세 프로젝션 테이블 */}
        {showProjections && projections.length > 0 && (
          <div className="mb-3 max-h-60 overflow-y-auto rounded-lg border border-gray-100">
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

        {/* 목표 미설정 안내 */}
        {!runway.target_date && (
          <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            목표 기간을 설정하면 자유 예산과 일일 목표가 자동 계산됩니다.
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
            <div className="text-gray-400">실제 월 평균</div>
            <div className="font-medium text-gray-700">
              {formatAmount(runway.avg_variable_monthly)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
