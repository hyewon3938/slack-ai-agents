/**
 * 일정 표시 공용 헬퍼: 카테고리 그룹핑 · 제목 포맷.
 */

import { formatDateShort } from '../../../shared/kst.js';
import type { ScheduleRow } from '../../../shared/life/queries-schedule.js';

// ─── 일정 블록 ──────────────────────────────────────────

interface CategoryGroup {
  category: string;
  items: ScheduleRow[];
}

const STATUS_ORDER: Record<string, number> = {
  done: 0,
  'in-progress': 1,
  todo: 2,
};

/** 일정을 카테고리별로 그룹핑 (최상위 카테고리 기준) */
export const groupByCategory = (items: ScheduleRow[]): CategoryGroup[] => {
  const categoryMap = new Map<string, ScheduleRow[]>();

  for (const item of items) {
    const cat = item.top_category_name ?? '미분류';
    const existing = categoryMap.get(cat);
    if (existing) {
      existing.push(item);
    } else {
      categoryMap.set(cat, [item]);
    }
  }

  const result: CategoryGroup[] = [];
  // event 카테고리 상단 → 알파벳순 → 미분류 맨 끝
  const isEventCategory = (cat: string): boolean => {
    const first = categoryMap.get(cat)?.[0];
    return first?.category_type === 'event';
  };
  const categories = [...categoryMap.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    const aEvent = isEventCategory(a) ? 0 : 1;
    const bEvent = isEventCategory(b) ? 0 : 1;
    if (aEvent !== bEvent) return aEvent - bEvent;
    return a.localeCompare(b, 'ko');
  });

  for (const cat of categories) {
    const items = categoryMap.get(cat) ?? [];
    items.sort((a, b) => {
      const aOrder = STATUS_ORDER[a.status] ?? 2;
      const bOrder = STATUS_ORDER[b.status] ?? 2;
      return aOrder - bOrder;
    });
    result.push({ category: cat, items });
  }

  return result;
};

/** event 타입 판별 (categories.type = 'event') */
export const isEventType = (item: ScheduleRow): boolean => item.category_type === 'event';

/** 일정 항목 제목 포맷 (메모 제외) */
export const formatScheduleTitle = (item: ScheduleRow): string => {
  // 기간 일정 표시
  let rangePart = '';
  if (item.date && item.end_date) {
    rangePart = ` ${formatDateShort(item.date)}~${formatDateShort(item.end_date)}`;
  }

  // 중요 표시 (제목 뒤)
  const star = item.important ? ' ★' : '';

  if (isEventType(item)) return `📅 ${item.title}${rangePart}${star}`;
  if (item.status === 'done') return `~${item.title}~${rangePart}${star}`;
  if (item.status === 'in-progress') return `► ${item.title}${rangePart}${star}`;
  return `${item.title}${rangePart}${star}`;
};
