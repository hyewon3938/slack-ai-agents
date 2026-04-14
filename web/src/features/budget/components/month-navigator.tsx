'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';

/** 결제주기 날짜 범위 계산 (표시용) */
function getBillingRangeLabel(yearMonth: string): string {
  const [, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevMonth}/16~${month}/15`;
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
        <button onClick={prev} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
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
