'use client';

import { formatDateShort, getTodayISO } from '@/lib/kst';

interface DateNavProps {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** 날짜 이전/다음/오늘 네비게이션 (루틴 체크리스트용) */
export function DateNav({ date, onPrev, onNext, onToday }: DateNavProps) {
  const isToday = date === getTodayISO();

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPrev}
        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
      >
        ◀
      </button>
      <span className="text-base font-semibold text-gray-900">
        {formatDateShort(date)}
      </span>
      <button
        onClick={onNext}
        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
      >
        ▶
      </button>
      {!isToday && (
        <button
          onClick={onToday}
          className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
        >
          오늘
        </button>
      )}
    </div>
  );
}
