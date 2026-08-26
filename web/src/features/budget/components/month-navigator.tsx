'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { getBillingRange } from '@/features/budget/lib/billing/cycle';

/** 'YYYY-MM-DD' → 'M/D' */
function toShortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}/${day}`;
}

/** 결제주기 날짜 범위 라벨 — 계산과 같은 소스를 써야 표시가 어긋나지 않는다 */
function getBillingRangeLabel(yearMonth: string): string {
  const { from, to } = getBillingRange(yearMonth);
  return `${toShortDate(from)}~${toShortDate(to)}`;
}

export function MonthNavigator({
  selectedMonth,
  onChange,
}: {
  selectedMonth: string;
  onChange: (month: string) => void;
}) {
  const [year, month] = selectedMonth.split('-').map(Number);

  const prev = () => {
    const d = new Date(year, month - 2, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const next = () => {
    const d = new Date(year, month, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-2">
        <button
          onClick={prev}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ChevronLeftIcon size={18} />
        </button>
        <span className="min-w-[80px] text-center text-sm font-semibold text-gray-800">
          {month}월 대금
        </span>
        <button
          onClick={next}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>
      <span className="text-[10px] text-gray-400">{getBillingRangeLabel(selectedMonth)}</span>
    </div>
  );
}
