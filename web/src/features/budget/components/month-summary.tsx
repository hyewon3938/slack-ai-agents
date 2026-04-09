'use client';

import type { MonthSummary } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';
import { getTodayISO } from '@/lib/kst';
import { BanknotesIcon, ClockIcon, CheckCircleIcon } from '@/components/ui/icons';

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
  const totalBudget = summary.auto_budget;
  const dailyBudget = summary.auto_daily;
  const monthRemaining = summary.month_budget_remaining;
  const todayBudget = summary.today_budget;
  const todayFlexSpent = summary.today_flex_spent ?? 0;
  const todayRemaining = summary.today_remaining;

  // 결제주기: 전월 16일 ~ 당월 15일
  const todayISO = getTodayISO();
  const today = new Date(`${todayISO}T00:00:00`);
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

  // 현재 달이고 남은 예산 데이터가 있는 경우: "남은 예산" 뷰
  const hasRemainingView = isCurrentCycle && monthRemaining !== null && dailyBudget !== null;
  const isRemainingNegative = hasRemainingView && monthRemaining! < 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{month}월 대금 요약</h2>
        {hasRemainingView && !isRemainingNegative && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircleIcon size={14} />
            관리 중
          </span>
        )}
      </div>

      {/* 현재 달: 남은 예산 중심 뷰 */}
      {hasRemainingView ? (
        <div className="mb-4">
          {/* 오늘의 현황 (가장 중요한 영역) */}
          {todayBudget !== null && todayRemaining !== null ? (
            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">오늘의 현황</span>
                <span className="text-xs text-gray-400">예산 {formatAmount(todayBudget)}</span>
              </div>

              {/* 오늘 남은/초과 (가장 큰 숫자) */}
              <div className={`text-2xl font-bold ${todayRemaining < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                {todayRemaining < 0 ? '-' : ''}{formatAmount(Math.abs(todayRemaining))}
                <span className="ml-1 text-sm font-medium text-gray-400">
                  {todayRemaining < 0 ? '초과' : '남음'}
                </span>
              </div>

              {/* 오늘 지출 */}
              {todayFlexSpent > 0 && (
                <div className="mt-1 text-xs text-gray-500">
                  오늘 지출 {formatAmount(todayFlexSpent)}
                </div>
              )}

              {/* 하루 분석 메시지 */}
              {todayRemaining < 0 && daysLeft > 0 && todayBudget > 0 && (
                <div className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-500">
                  남은 {daysLeft}일 이 패턴이면 런웨이 약 {Math.floor(Math.abs(todayRemaining) * daysLeft / todayBudget)}일 단축
                </div>
              )}
              {todayRemaining > 0 && todayFlexSpent > 0 && (
                <div className="mt-2 rounded-md bg-green-50 px-2.5 py-1.5 text-xs text-green-600">
                  오늘 {formatAmount(todayRemaining)} 아꼈어!
                </div>
              )}

              {/* 이번 달 예산 초과 경고 */}
              {isRemainingNegative && (
                <div className="mt-2 text-xs text-red-500">
                  이번 달 예산 {formatAmount(Math.abs(monthRemaining!))} 초과 — 남은 {daysLeft}일 최대한 아껴봐
                </div>
              )}
            </div>
          ) : (
            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-3">
              <div className="text-xs text-gray-500 mb-1">하루 자유 예산</div>
              <div className={`text-2xl font-bold ${isRemainingNegative ? 'text-red-500' : 'text-gray-900'}`}>
                {isRemainingNegative ? '-' : ''}{formatAmount(Math.abs(dailyBudget!))}
              </div>
              {isRemainingNegative && (
                <div className="mt-1 text-xs text-red-500">
                  이번 달 예산 {formatAmount(Math.abs(monthRemaining!))} 초과 — 남은 {daysLeft}일 최대한 아껴봐
                </div>
              )}
            </div>
          )}

          {/* 남은 예산 바 */}
          <div className="flex items-end justify-between mb-1">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <BanknotesIcon size={13} />
              남은 자유 예산
            </span>
            <span className={`text-sm font-bold ${isRemainingNegative ? 'text-red-500' : 'text-gray-900'}`}>
              {isRemainingNegative ? '-' : ''}{formatAmount(Math.abs(monthRemaining!))}
            </span>
          </div>
          {!isRemainingNegative && totalBudget !== null && (
            <>
              <ProgressBar
                value={totalBudget - monthRemaining!}
                max={totalBudget}
                danger={monthRemaining! < totalBudget * 0.1}
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>월 예산 {formatAmount(totalBudget)}</span>
                <span>남은 {daysLeft}일</span>
              </div>
            </>
          )}
        </div>
      ) : totalBudget !== null ? (
        /* 다른 달: 월 예산 기준 뷰 */
        <div className="mb-4">
          <div className="mb-1 flex items-end justify-between">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <BanknotesIcon size={13} />
              자유 지출
            </span>
            <span className="text-lg font-bold text-gray-900">{formatAmount(summary.flexible_spent)}</span>
          </div>
          <ProgressBar
            value={summary.flexible_spent}
            max={totalBudget}
            danger={summary.flexible_spent > totalBudget}
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>예산 {formatAmount(totalBudget)}</span>
            <span>
              {summary.flexible_spent > totalBudget
                ? `${formatAmount(summary.flexible_spent - totalBudget)} 초과`
                : `${formatAmount(totalBudget - summary.flexible_spent)} 남음`}
            </span>
          </div>
        </div>
      ) : (
        /* 예산 미설정 */
        <div className="mb-4">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-xs text-gray-500">자유 지출</span>
            <span className="text-lg font-bold text-gray-900">{formatAmount(summary.flexible_spent)}</span>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
            설정 탭에서 목표 기간을 설정하면 예산이 자동 산정됩니다
          </div>
        </div>
      )}

      {/* 핵심 지표 */}
      <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
        <div className="text-center">
          <div className="text-xs text-gray-400">하루 예산</div>
          {(isCurrentCycle && todayBudget !== null) ? (
            <div className={`text-sm font-semibold ${todayBudget < 0 ? 'text-red-500' : 'text-gray-800'}`}>
              {formatAmount(Math.abs(todayBudget))}
            </div>
          ) : dailyBudget !== null ? (
            <div className={`text-sm font-semibold ${dailyBudget < 0 ? 'text-red-500' : 'text-gray-800'}`}>
              {formatAmount(Math.abs(dailyBudget))}
            </div>
          ) : (
            <div className="text-sm text-gray-300">-</div>
          )}
        </div>

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

        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-xs text-gray-400">
            <ClockIcon size={12} />
            남은 날
          </div>
          <div className="text-sm font-semibold text-gray-800">{daysLeft}일</div>
        </div>
      </div>

      {/* 부가 정보 */}
      <div className="mt-3 space-y-1">
        {summary.income_total > 0 && (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
            수입 +{formatAmount(summary.income_total)}
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
