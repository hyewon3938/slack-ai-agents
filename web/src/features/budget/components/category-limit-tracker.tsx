'use client';

import { useEffect, useState, useCallback } from 'react';
import type { CategoryLimitWithUsage } from '@/features/budget/lib/types';

interface Props {
  yearMonth: string;
  refreshTrigger?: number;
}

function LimitRow({ limit }: { limit: CategoryLimitWithUsage }) {
  const used = limit.used_count;
  const target = limit.target_count;
  const isOver = used > target;
  const isWarn = !isOver && used >= Math.ceil(target * 0.8);
  const remaining = Math.max(0, target - used);

  const dotColor = isOver
    ? 'bg-red-500 border-red-500'
    : isWarn
      ? 'bg-amber-500 border-amber-500'
      : 'bg-blue-500 border-blue-500';
  const labelColor = isOver ? 'text-red-500' : isWarn ? 'text-amber-700' : 'text-gray-600';

  const dots = Array.from({ length: target }, (_, i) => {
    const filled = i < Math.min(used, target);
    return (
      <span
        key={i}
        className={`inline-block h-[18px] w-[18px] rounded-full border-2 ${
          filled ? dotColor : 'border-gray-300 bg-white'
        }`}
      />
    );
  });

  return (
    <div className="border-b border-gray-100 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{limit.category}</span>
        <span className={`text-xs font-medium ${labelColor}`}>
          {isOver ? (
            <>
              {used - target}회 초과 · 한도 {target}
            </>
          ) : (
            <>
              남은 {remaining}회 · 한도 {target}
            </>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">{dots}</div>
    </div>
  );
}

export function CategoryLimitTracker({ yearMonth, refreshTrigger }: Props) {
  const [limits, setLimits] = useState<CategoryLimitWithUsage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLimits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/category-limits?billingMonth=${yearMonth}`);
      if (!res.ok) return;
      const { data } = (await res.json()) as { data: CategoryLimitWithUsage[] };
      setLimits(data);
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    void fetchLimits();
  }, [fetchLimits, refreshTrigger]);

  if (loading) return null;
  if (limits.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">이번 주기 한도</h2>
        <span className="text-xs text-gray-400">설정에서 관리</span>
      </div>
      <div>
        {limits.map((l) => (
          <LimitRow key={l.id} limit={l} />
        ))}
      </div>
    </div>
  );
}
