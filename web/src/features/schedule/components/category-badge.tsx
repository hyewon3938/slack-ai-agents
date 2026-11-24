'use client';

import { getCategoryStyle } from '@/lib/types';

export function CategoryBadge({ colorKey, label }: { colorKey: string; label: string }) {
  const style = getCategoryStyle(colorKey);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {label}
    </span>
  );
}
