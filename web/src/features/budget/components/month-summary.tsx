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
  const budget = summary.budget;
  const totalBudget = budget?.total_budget ?? null;
  const dailyBudget = budget?.daily_budget ?? null;

  // 결제주기: 전월 16일 ~ 당월 15일
  const today = new Date();
  const [year, month] = summary.year_month.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const cycleStart = new Date(`${prevYear}-${String(prevMonth).padStart(2, '0')}-16T00:00:00`);
  const cycleEnd = new Date(`${year}-${String(month).padStart(2, '0')}-15T00:00:00`);
  const totalDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const isCurrentCycle = today >= cycleStart && today <= cycleEnd;
  const daysPassed = isCurrentCycle
    ? Math.round((today.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    : totalDays;
  const daysLeft = Math.max(totalDays - daysPassed, 0);

  const budgetUsed = totalBudget !== null ? summary.variable_total : null;
  const budgetRemaining = totalBudget !== null && budgetUsed !== null ? totalBudget - budgetUsed : null;
  const isOverBudget = budgetRemaining !== null && budgetRemaining < 0;

  const todaySpent = summary.by_category.reduce((s, c) => s + c.total, 0); // 오늘 지출은 별도 API 필요, 여기선 월 일평균
  const dailyLeft = dailyBudget !== null ? dailyBudget - Math.round(summary.daily_avg) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{summary.year_month.replace('-', '년 ')}월 요약</h2>
        {isOverBudget ? (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <ExclamationTriangleIcon size={14} />
            예산 초과
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircleIcon size={14} />
            절약 중
          </span>
        )}
      </div>

      {/* 총 지출 */}
      <div className="mb-4">
        <div className="mb-1 flex items-end justify-between">
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <BanknotesIcon size={13} />
            가변 지출
          </span>
          <span className="text-lg font-bold text-gray-900">{formatAmount(summary.variable_total)}</span>
        </div>
        {totalBudget !== null && (
          <>
            <ProgressBar value={summary.variable_total} max={totalBudget} danger={isOverBudget} />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>예산 {formatAmount(totalBudget)}</span>
              <span className={isOverBudget ? 'font-medium text-red-500' : 'text-gray-500'}>
                {isOverBudget ? `${formatAmount(Math.abs(budgetRemaining ?? 0))} 초과` : `${formatAmount(budgetRemaining ?? 0)} 남음`}
              </span>
            </div>
          </>
        )}
      </div>

      {/* 일일 현황 */}
      <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
        <div className="text-center">
          <div className="text-xs text-gray-400">일평균</div>
          <div className="text-sm font-semibold text-gray-800">{formatAmount(summary.daily_avg)}</div>
          {dailyBudget !== null && (
            <div className={`text-xs ${dailyLeft !== null && dailyLeft < 0 ? 'text-red-400' : 'text-gray-400'}`}>
              목표 {formatAmount(dailyBudget)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-xs text-gray-400">
            <ClockIcon size={12} />
            남은 날
          </div>
          <div className="text-sm font-semibold text-gray-800">{daysLeft}일</div>
          {dailyBudget !== null && daysLeft > 0 && budgetRemaining !== null && (
            <div className="text-xs text-gray-400">
              하루 {formatAmount(Math.max(Math.round(budgetRemaining / daysLeft), 0))}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400">총 지출</div>
          <div className="text-sm font-semibold text-gray-800">{formatAmount(summary.total)}</div>
          <div className="text-xs text-gray-400">고정비 포함</div>
        </div>
      </div>

      {/* 고정비 */}
      {summary.fixed_total > 0 && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          월 고정비 {formatAmount(summary.fixed_total)} (주담대·관리비·보험·통신·구독)
        </div>
      )}
    </div>
  );
}
