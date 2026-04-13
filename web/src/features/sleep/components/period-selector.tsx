'use client';

import type { SleepPeriod } from '../lib/types';

const PERIODS: { id: SleepPeriod; label: string }[] = [
  { id: '1m', label: '1개월' },
  { id: '2w', label: '2주' },
  { id: '1w', label: '1주' },
];

interface PeriodSelectorProps {
  period: SleepPeriod;
  onChange: (p: SleepPeriod) => void;
}

export function PeriodSelector({ period, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1.5">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            period === p.id
              ? 'bg-indigo-500 text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
