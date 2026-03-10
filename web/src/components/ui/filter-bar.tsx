'use client';

import type { CategoryRow, ScheduleStatus } from '@/lib/types';
import { getCategoryStyle, SCHEDULE_STATUSES, STATUS_LABELS } from '@/lib/types';

const STATUS_FILTER_COLORS: Record<string, { active: string; inactive: string }> = {
  todo: { active: 'bg-gray-200 text-gray-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
  'in-progress': { active: 'bg-blue-100 text-blue-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
  done: { active: 'bg-green-100 text-green-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
};

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
    <div className="border-b border-gray-100 bg-white px-4 py-2">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-400">필터:</span>

      {/* 상태 필터 */}
      {SCHEDULE_STATUSES.filter((s) => s !== 'cancelled').map((s) => {
        const colors = STATUS_FILTER_COLORS[s] ?? STATUS_FILTER_COLORS.todo!;
        return (
          <button
            key={s}
            onClick={() => onToggleStatus(s)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              selectedStatuses.has(s) ? colors.active : colors.inactive
            }`}
          >
            {STATUS_LABELS[s as ScheduleStatus]}
          </button>
        );
      })}

      <span className="text-gray-300">|</span>

      {/* 카테고리 필터 */}
      {categories.map((cat) => {
        const active = selectedCategories.has(cat.name);
        const style = getCategoryStyle(cat.color);
        const isPreset = style.isPreset && style.classes;
        return (
          <button
            key={cat.id}
            onClick={() => onToggleCategory(cat.name)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              active
                ? isPreset ? `${style.classes!.bg} ${style.classes!.text}` : ''
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            style={active && !isPreset ? { backgroundColor: style.styles?.bg, color: style.styles?.text } : undefined}
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
    </div>
  );
}
