'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DailyBudgetLog } from '@/features/budget/lib/types';

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] text-gray-500"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow((v) => !v)}
      >
        ?
      </button>
      {show && (
        <span className="absolute bottom-6 left-1/2 z-10 w-48 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-[11px] leading-relaxed text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

interface DailyBudgetLogProps {
  yearMonth: string;
  /** 현재 todayBudget (런웨이 일수 환산용, null이면 런웨이 표시 생략) */
  todayBudget: number | null;
}

export function DailyBudgetLogView({ yearMonth, todayBudget }: DailyBudgetLogProps) {
  const [logs, setLogs] = useState<DailyBudgetLog[]>([]);
  const [totalSaved, setTotalSaved] = useState(0);
  const [daysLogged, setDaysLogged] = useState(0);
  const [avgDailySaved, setAvgDailySaved] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/daily-logs?yearMonth=${yearMonth}`);
      if (!res.ok) return;
      const { data } = (await res.json()) as {
        data: { logs: DailyBudgetLog[]; total_saved: number; days_logged: number; avg_daily_saved: number };
      };
      setLogs(data.logs);
      setTotalSaved(data.total_saved);
      setDaysLogged(data.days_logged);
      setAvgDailySaved(data.avg_daily_saved);
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  if (loading) return <LoadingSkeleton />;
  if (logs.length === 0) return <EmptyState />;

  // 런웨이 영향: 누적 세이브 / todayBudget ≈ 연장/단축 일수
  const runwayImpactDays =
    todayBudget && todayBudget > 0
      ? Math.round((Math.abs(totalSaved) / todayBudget) * 10) / 10
      : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* 누적 요약 카드 */}
      <div className="mb-4 rounded-xl bg-gray-50 p-4">
        <div className="mb-1 text-xs text-gray-500">이번 달 현황</div>
        <div className={`text-lg font-bold ${totalSaved >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {totalSaved >= 0 ? '+' : ''}
          {formatAmount(totalSaved)} {totalSaved >= 0 ? '세이브' : '초과'}
          <InfoTooltip text="예산 대비 절약/초과 금액의 합산이야. 실제 다음 달로 이월되는 금액과는 다를 수 있어" />
        </div>
        <div className="mt-1 flex gap-3 text-xs text-gray-500">
          <span>
            일평균 {avgDailySaved >= 0 ? '+' : ''}
            {formatAmount(avgDailySaved)}
          </span>
          <span>{daysLogged}일 기록</span>
        </div>
        {runwayImpactDays !== null && runwayImpactDays > 0 && (
          <div className="mt-2 text-xs text-gray-400">
            런웨이 약 {runwayImpactDays}일 {totalSaved >= 0 ? '연장' : '단축'} 효과
            <InfoTooltip text="일일 예산 기준 대략적인 추정치야. 고정비 변동 등에 따라 실제와 다를 수 있어" />
          </div>
        )}
      </div>

      {/* 일별 로그 리스트 */}
      <div className="space-y-1">
        {logs.map((log) => (
          <DailyLogRow key={log.date} log={log} />
        ))}
      </div>
    </div>
  );
}

function DailyLogRow({ log }: { log: DailyBudgetLog }) {
  const isPositive = log.saved >= 0;
  const dateObj = new Date(`${log.date}T00:00:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()} (${dayNames[dateObj.getDay()]})`;

  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-16 text-gray-600">{dayLabel}</span>
        <span className="text-gray-400">예산 {formatAmount(log.budget)}</span>
        <span className="text-gray-400">지출 {formatAmount(log.spent)}</span>
      </div>
      <span className={`font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
        {isPositive ? '+' : ''}
        {formatAmount(log.saved)}
      </span>
    </div>
  );
}

function formatAmount(amount: number): string {
  return Math.abs(amount).toLocaleString('ko-KR');
}

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="py-12 text-center text-sm text-gray-400">
        아직 기록된 예산 현황이 없어
      </div>
    </div>
  );
}
