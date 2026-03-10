'use client';

import type { CategoryRow } from '@/lib/types';
import { CATEGORY_COLORS, SCHEDULE_STATUSES, STATUS_LABELS } from '@/lib/types';
import type { ScheduleStatus } from '@/lib/types';

interface FilterBarProps {
  categories: CategoryRow[];
  selectedCategories: Set<string>;
  selectedStatuses: Set<string>;
  onToggleCategory: (name: string) => void;
  onToggleStatus: (status: string) => void;
  onClearFilters: () => void;
}

export function FilterBar({
  categories,
  selectedCategories,
  selectedStatuses,
  onToggleCategory,
  onToggleStatus,
  onClearFilters,
}: FilterBarProps) {
  const hasFilters = selectedCategories.size > 0 || selectedStatuses.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-white px-4 py-2">
      <span className="text-xs text-gray-400">필터:</span>

      {/* 상태 필터 */}
      {SCHEDULE_STATUSES.filter((s) => s !== 'cancelled').map((s) => (
        <button
          key={s}
          onClick={() => onToggleStatus(s)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
            selectedStatuses.has(s)
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {STATUS_LABELS[s as ScheduleStatus]}
        </button>
      ))}

      <span className="text-gray-300">|</span>

      {/* 카테고리 필터 */}
      {categories.map((cat) => {
        const colors = CATEGORY_COLORS[cat.color] ?? CATEGORY_COLORS.gray!;
        return (
          <button
            key={cat.id}
            onClick={() => onToggleCategory(cat.name)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              selectedCategories.has(cat.name)
                ? `${colors.bg} ${colors.text}`
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        );
      })}

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="ml-1 rounded-full px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
        >
          초기화
        </button>
      )}
    </div>
  );
}
