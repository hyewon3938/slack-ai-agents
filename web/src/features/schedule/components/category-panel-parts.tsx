'use client';

import type { CategoryType } from '@/lib/types';
import { getCategoryStyle, CATEGORY_TYPES } from '@/lib/types';

export function CategoryBadge({ name, colorKey }: { name: string; colorKey: string }) {
  const style = getCategoryStyle(colorKey);
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {name}
    </span>
  );
}

export function TypeBadge({ type: rawType }: { type: CategoryType | null }) {
  const type = rawType ?? 'task';
  const label = CATEGORY_TYPES.find((t) => t.value === type)?.label ?? type;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        type === 'event'
          ? 'bg-purple-100 text-purple-600'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {label}
    </span>
  );
}

export function TypeSelector({
  value,
  onChange,
}: {
  value: CategoryType;
  onChange: (v: CategoryType) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-gray-300 p-0.5">
      {CATEGORY_TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === t.value
              ? 'bg-blue-500 text-white'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
