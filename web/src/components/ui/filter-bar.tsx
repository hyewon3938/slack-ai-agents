'use client';

import type { CategoryRow, ScheduleStatus } from '@/lib/types';
import { getCategoryStyle, SCHEDULE_STATUSES, STATUS_LABELS } from '@/lib/types';

const STATUS_FILTER_COLORS: Record<string, { active: string; inactive: string }> = {
  todo: { active: 'bg-gray-200 text-gray-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
  'in-progress': { active: 'bg-blue-100 text-blue-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
  done: { active: 'bg-green-100 text-green-700', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
  cancelled: { active: 'bg-gray-200 text-gray-400', inactive: 'bg-gray-100 text-gray-500 hover:bg-gray-200' },
};

interface FilterBarProps {
  categories: CategoryRow[];
  selectedCategories: Set<string>;
  selectedSubcategories: Set<string>;
  selectedStatuses: Set<string>;
  onToggleCategory: (name: string) => void;
  onToggleSubcategory: (name: string) => void;
  onToggleStatus: (status: string) => void;
  onClearFilters: () => void;
}

export function FilterBar({
  categories,
  selectedCategories,
  selectedSubcategories,
  selectedStatuses,
  onToggleCategory,
  onToggleSubcategory,
  onToggleStatus,
  onClearFilters,
}: FilterBarProps) {
  const hasFilters = selectedCategories.size > 0 || selectedStatuses.size > 0;

  // 선택된 상위 카테고리의 하위카테고리 수집
  const subcategories = categories.filter((c) => {
    if (c.parent_id === null) return false;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent && selectedCategories.has(parent.name);
  });

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-2">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400">필터:</span>

        {/* 상태 필터 */}
        {SCHEDULE_STATUSES.map((s) => {
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

        {/* 카테고리 필터 (상위만) */}
        {categories.filter((c) => c.parent_id === null).map((cat) => {
          const active = selectedCategories.has(cat.name);
          const style = getCategoryStyle(cat.color);
          return (
            <button
              key={cat.id}
              onClick={() => onToggleCategory(cat.name)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                active ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
              style={active ? { backgroundColor: style.bg, color: style.text } : undefined}
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

      {/* 하위카테고리 필터 (2행) */}
      {subcategories.length > 0 && (
        <div className="mx-auto mt-1.5 flex max-w-5xl flex-wrap items-center gap-1.5">
          {subcategories.map((sub) => {
            const active = selectedSubcategories.has(sub.name);
            const style = getCategoryStyle(sub.color);
            return (
              <button
                key={sub.id}
                onClick={() => onToggleSubcategory(sub.name)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  active ? '' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
                style={active ? { backgroundColor: style.bg, color: style.text } : undefined}
              >
                {sub.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
