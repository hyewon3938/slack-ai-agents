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
  const cards = [
    {
      label: '평균 수면',
      value: summary.totalNights > 0 ? formatDuration(summary.avgDuration) : '-',
      sub: `${summary.totalNights}일 기록`,
    },
    {
      label: '평균 취침',
      value: summary.avgBedtime,
      sub: `기상 ${summary.avgWakeTime}`,
    },
    {
      label: '중간 기상',
      value: summary.totalMidWakes > 0 ? `${summary.avgMidWakesPerNight}회/일` : '없음',
      sub: `총 ${summary.totalMidWakes}회`,
    },
    {
      label: '규칙성',
      value: `${summary.regularityScore}점`,
      sub: '취침 시간 기준',
      valueClass: scoreColor(summary.regularityScore),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="text-xs text-gray-400">{c.label}</div>
          <div className={`mt-1 text-lg font-bold ${c.valueClass ?? 'text-gray-900'}`}>
            {c.value}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
