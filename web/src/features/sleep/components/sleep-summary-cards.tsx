'use client';

import { useState, useEffect, useRef } from 'react';
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

function InfoButton({ content }: { content: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-400 hover:border-gray-400 hover:text-gray-600"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        aria-label="규칙성 점수 설명"
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          {content}
        </div>
      )}
    </div>
  );
}

const regularityContent = (
  <div className="text-xs leading-relaxed">
    <p className="mb-1 font-semibold text-gray-700">규칙성 점수란?</p>
    <p className="mb-2 text-gray-600">취침 시각이 얼마나 일정한지를 100점 만점으로 나타내.</p>
    <ul className="space-y-0.5 text-gray-500">
      <li><span className="font-medium text-green-600">80점↑</span> 거의 같은 시간에 잠</li>
      <li><span className="font-medium text-green-600">70~79</span> 꽤 규칙적</li>
      <li><span className="font-medium text-yellow-600">40~69</span> 변동 큼</li>
      <li><span className="font-medium text-red-500">40점↓</span> 매우 불규칙</li>
    </ul>
  </div>
);

export function SleepSummaryCards({ summary }: SleepSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
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
      <div className="relative rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          규칙성
          <InfoButton content={regularityContent} />
        </div>
        <div className={`mt-1 text-lg font-bold ${scoreColor(summary.regularityScore)}`}>
          {summary.regularityScore}점
        </div>
        <div className="mt-0.5 text-xs text-gray-400">취침 시간 기준</div>
      </div>

      {/* 낮잠 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">낮잠</div>
        <div className="mt-1 text-lg font-bold text-gray-900">
          {summary.napDaysCount > 0
            ? formatDuration(summary.avgNapMinutes)
            : '없음'}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {summary.napDaysCount > 0
            ? `${summary.napDaysCount}일 기록 · 평균`
            : '기간 내 없음'}
        </div>
      </div>
    </div>
  );
}
