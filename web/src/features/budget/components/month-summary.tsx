'use client';

import type { MonthSummary } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { BanknotesIcon, ClockIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@/components/ui/icons';

interface MonthSummaryCardProps {
  summary: MonthSummary;
}

function ProgressBar({ value, max, danger }: { value: number; max: number; danger: boolean }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full transition-all ${danger ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-blue-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function MonthSummaryCard({ summary }: MonthSummaryCardProps) {
  // 자동 예산 우선, 없으면 수동 예산
  const totalBudget = summary.auto_budget ?? summary.budget?.total_budget ?? null;
  const autoDailyBudget = summary.auto_daily;

  // 결제주기: 전월 16일 ~ 당월 15일
  const today = new Date();
  const [year, month] = summary.year_month.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const cycleStart = new Date(`${prevYear}-${String(prevMonth).padStart(2, '0')}-16T00:00:00`);
  const cycleEnd = new Date(`${year}-${String(month).padStart(2, '0')}-15T00:00:00`);
  const totalDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const isFutureCycle = today < cycleStart;
  const isCurrentCycle = today >= cycleStart && today <= cycleEnd;
  const daysPassed = isFutureCycle
    ? 0
    : isCurrentCycle
      ? Math.round((today.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : totalDays;
  const daysLeft = totalDays - daysPassed;

  const isOverBudget = totalBudget !== null && summary.flexible_spent > totalBudget;
  const budgetRemaining = totalBudget !== null ? totalBudget - summary.flexible_spent : null;

  // 자동 일일 예산이 있으면 사용, 없으면 전통 방식으로 계산
  const displayDaily = autoDailyBudget ?? (
    totalBudget !== null ? Math.round((totalBudget - summary.installment_total) / totalDays) : null
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{month}월 대금 요약</h2>
        {totalBudget !== null && (
          isOverBudget ? (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <ExclamationTriangleIcon size={14} />
              예산 초과
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircleIcon size={14} />
              예산 내
            </span>
          )
        )}
      </div>

      {/* 예산 진행 */}
      {totalBudget !== null ? (
        <div className="mb-4">
          <div className="mb-1 flex items-end justify-between">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <BanknotesIcon size={13} />
              자유 지출
            </span>
            <span className="text-lg font-bold text-gray-900">{formatAmount(summary.flexible_spent)}</span>
          </div>
          <ProgressBar value={summary.flexible_spent} max={totalBudget} danger={isOverBudget} />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>예산 {formatAmount(totalBudget)}</span>
            <span className={isOverBudget ? 'font-medium text-red-500' : 'text-gray-500'}>
              {isOverBudget
                ? `${formatAmount(Math.abs(budgetRemaining ?? 0))} 초과`
                : `${formatAmount(budgetRemaining ?? 0)} 남음`}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-xs text-gray-500">자유 지출</span>
            <span className="text-lg font-bold text-gray-900">{formatAmount(summary.flexible_spent)}</span>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
            분석 탭에서 목표 기간을 설정하면 예산이 자동 산정됩니다
          </div>
        </div>
      )}

      {/* 핵심 지표 */}
      <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
        {/* 일일 예산 */}
        <div className="text-center">
          <div className="text-xs text-gray-400">하루 예산</div>
          {displayDaily !== null ? (
            <>
              <div className="text-sm font-semibold text-gray-800">
                {formatAmount(displayDaily)}
              </div>
              {summary.auto_daily !== null && (
                <div className="text-[10px] text-gray-400">자동</div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-300">-</div>
          )}
        </div>

        {/* 할부 */}
        <div className="text-center">
          <div className="text-xs text-gray-400">할부</div>
          {summary.installment_total > 0 ? (
            <div className="text-sm font-semibold text-gray-800">
              {formatAmount(summary.installment_total)}
            </div>
          ) : (
            <div className="text-sm text-gray-300">-</div>
          )}
        </div>

        {/* 남은 날 */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-xs text-gray-400">
            <ClockIcon size={12} />
            남은 날
          </div>
          <div className="text-sm font-semibold text-gray-800">{daysLeft}일</div>
          <div className="text-[10px] text-gray-400">{daysPassed}일 경과</div>
        </div>
      </div>

      {/* 부가 정보 */}
      <div className="mt-3 space-y-1">
        {summary.income_total > 0 && (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
            수입 +{formatAmount(summary.income_total)} (예산에 반영됨)
          </div>
        )}
        {summary.planned_total > 0 && (
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600">
            예정 지출 {formatAmount(summary.planned_total)} (예산에서 차감됨)
          </div>
        )}
        {summary.fixed_total > 0 && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            총 지출 {formatAmount(summary.total)} (고정비 {formatAmount(summary.fixed_total)} 포함)
          </div>
        )}
      </div>
    </div>
  );
}
