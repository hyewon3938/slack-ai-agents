'use client';

/** 캘린더의 카테고리·상태 필터 선택을 관리하고 필터를 적용한 일정 목록을 돌려준다. */
import { useState, useMemo } from 'react';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import { lookupCategory } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';

export function useScheduleFilters(schedules: ScheduleRow[], categories: CategoryRow[]) {
  // 카테고리 필터: 최상위 id 기준
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());
  // 하위 카테고리 필터: child id 기준
  const [selectedSubcategories, setSelectedSubcategories] = useState<Set<number>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());

  // 필터링: 최상위 카테고리 id 단위로 매칭, 하위 선택 시 child id로 매칭
  const filteredSchedules = useMemo(
    () =>
      schedules.filter((s) => {
        if (selectedStatuses.size > 0 && !selectedStatuses.has(s.status)) {
          return false;
        }
        if (selectedCategories.size > 0) {
          const lookup = lookupCategory(categories, s.category_id);
          const topId = lookup.topId;
          if (topId == null || !selectedCategories.has(topId)) return false;
          // 하위카테고리 필터: 같은 parent에서 child 선택이 있으면 그 child만 포함
          if (selectedSubcategories.size > 0) {
            const childIds = categories.filter((c) => c.parent_id === topId).map((c) => c.id);
            const activeForParent = childIds.filter((id) => selectedSubcategories.has(id));
            if (activeForParent.length > 0) {
              if (s.category_id == null || !selectedSubcategories.has(s.category_id)) {
                return false;
              }
            }
          }
        }
        return true;
      }),
    [schedules, selectedCategories, selectedSubcategories, selectedStatuses, categories],
  );

  /** 최상위 카테고리 id 토글. 해제 시 같은 부모의 자식 선택도 함께 정리 */
  const toggleCategory = (topId: number) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(topId)) {
        next.delete(topId);
        const childIds = categories.filter((c) => c.parent_id === topId).map((c) => c.id);
        setSelectedSubcategories((prev) => {
          const nextSub = new Set(prev);
          childIds.forEach((id) => nextSub.delete(id));
          return nextSub;
        });
      } else {
        next.add(topId);
      }
      return next;
    });
  };

  /** 하위 카테고리 id 토글 */
  const toggleSubcategory = (childId: number) => {
    setSelectedSubcategories((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedCategories(new Set());
    setSelectedSubcategories(new Set());
    setSelectedStatuses(new Set());
  };

  return {
    selectedCategories,
    selectedSubcategories,
    selectedStatuses,
    filteredSchedules,
    toggleCategory,
    toggleSubcategory,
    toggleStatus,
    clearFilters,
  };
}
