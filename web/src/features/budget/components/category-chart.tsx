'use client';

import type { CategoryStat } from '@/features/budget/lib/types';
import { formatAmount } from '@/lib/types';

interface CategoryChartProps {
  stats: CategoryStat[];
  total: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  '식재료': '#60a5fa',
  '배달음식': '#f97316',
  '외식비': '#fb923c',
  '카페': '#a78bfa',
  '생필품': '#34d399',
  '쇼핑': '#f472b6',
  '미용': '#e879f9',
  '교통비': '#38bdf8',
  '의료/건강': '#4ade80',
  '구독료': '#94a3b8',
  '통신비': '#64748b',
  '공과금': '#6b7280',
  '문화생활': '#fbbf24',
  '여행': '#2dd4bf',
  '경조사': '#c084fc',
  '고양이': '#fb7185',
  '리커밋 사업': '#818cf8',
  '리커밋 택배': '#6366f1',
  '환불': '#d1d5db',
  '기타': '#9ca3af',
};

const DEFAULT_COLOR = '#e5e7eb';

export function CategoryChart({ stats, total }: CategoryChartProps) {
  if (stats.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">카테고리별 지출</h2>
        <p className="text-sm text-gray-400">지출 내역이 없습니다.</p>
      </div>
    );
  }

  const top = stats.slice(0, 8);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">카테고리별 지출</h2>

      {/* 누적 바 차트 */}
      <div className="mb-4 h-4 w-full overflow-hidden rounded-full flex">
        {top.map((stat) => {
          const pct = total > 0 ? (stat.total / total) * 100 : 0;
          const color = CATEGORY_COLORS[stat.category] ?? DEFAULT_COLOR;
          return (
            <div
              key={stat.category}
              title={`${stat.category}: ${formatAmount(stat.total)}`}
              style={{ width: `${pct}%`, backgroundColor: color }}
              className="transition-all"
            />
          );
        })}
      </div>

      {/* 범례 + 바 */}
      <div className="space-y-2">
        {top.map((stat) => {
          const pct = total > 0 ? Math.round((stat.total / total) * 100) : 0;
          const color = CATEGORY_COLORS[stat.category] ?? DEFAULT_COLOR;
          return (
            <div key={stat.category} className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <div className="flex-1 min-w-0">
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="truncate text-gray-700">{stat.category}</span>
                  <span className="ml-2 shrink-0 text-gray-500">{formatAmount(stat.total)}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
              <span className="w-8 shrink-0 text-right text-xs text-gray-400">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
