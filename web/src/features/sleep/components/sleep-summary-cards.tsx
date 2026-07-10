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

/** 점수(0~100) → 텍스트 색상 클래스 (70↑ 초록 / 40~69 노랑 / 40 미만 빨강) — SleepScoreCard와 공유 */
export function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-red-500';
}

/** hover/tap 설명 팝오버 버튼 — 수면 카드류 공용 */
export function InfoButton({
  content,
  ariaLabel,
}: {
  content: React.ReactNode;
  ariaLabel: string;
}) {
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
        aria-label={ariaLabel}
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

const efficiencyContent = (
  <div className="text-xs leading-relaxed">
    <p className="mb-1 font-semibold text-gray-700">수면 효율이란?</p>
    <p className="text-gray-600">누운 시간 대비 실제 수면 비율. 각성 = 세그먼트 사이 깬 시간.</p>
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

      {/* 수면 효율 */}
      <div className="relative rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          수면 효율
          <InfoButton content={efficiencyContent} ariaLabel="수면 효율 설명" />
        </div>
        <div className="mt-1 text-lg font-bold text-gray-900">
          {summary.avgEfficiencyPct !== null ? `${summary.avgEfficiencyPct}%` : '—'}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">평균 각성 {summary.avgWasoMinutes}분</div>
      </div>

      {/* 낮잠 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-400">낮잠</div>
        <div className="mt-1 text-lg font-bold text-gray-900">
          {summary.napDaysCount > 0 ? formatDuration(summary.avgNapMinutes) : '없음'}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {summary.napDaysCount > 0 ? `${summary.napDaysCount}일 기록 · 평균` : '기간 내 없음'}
        </div>
      </div>
    </div>
  );
}
