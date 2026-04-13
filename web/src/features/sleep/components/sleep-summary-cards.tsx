'use client';

import type { SleepSummary } from '../lib/types';

interface SleepSummaryCardsProps {
  summary: SleepSummary;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-red-500';
}

export function SleepSummaryCards({ summary }: SleepSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {/* 평균 수면 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">평균 수면</div>
        <div className="mt-1 text-lg font-bold text-gray-900">
          {summary.totalNights > 0 ? formatDuration(summary.avgDuration) : '-'}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">{summary.totalNights}일 기록</div>
      </div>

      {/* 취침 · 기상 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">취침 · 기상</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold text-gray-900">{summary.avgBedtime}</span>
          <span className="text-sm text-gray-400">/</span>
          <span className="text-lg font-bold text-gray-900">{summary.avgWakeTime}</span>
        </div>
        <div className="mt-0.5 text-xs text-gray-400">평균 취침 / 기상</div>
      </div>

      {/* 중간 기상 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">중간 기상</div>
        <div className="mt-1 text-lg font-bold text-gray-900">
          {summary.totalMidWakes > 0 ? `${summary.avgMidWakesPerNight}회/일` : '없음'}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">총 {summary.totalMidWakes}회</div>
      </div>

      {/* 규칙성 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">규칙성</div>
        <div className={`mt-1 text-lg font-bold ${scoreColor(summary.regularityScore)}`}>
          {summary.regularityScore}점
        </div>
        <div className="mt-0.5 text-xs text-gray-400">취침 시간 기준</div>
      </div>
    </div>
  );
}
