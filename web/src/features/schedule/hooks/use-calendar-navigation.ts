'use client';

/** 캘린더 보기 방식과 기준 날짜, 선택한 날짜를 관리하고 조회할 날짜 범위를 계산한다. */
import { useState, useEffect, useMemo } from 'react';
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import type { CalendarView } from '@/features/schedule/components/calendar-header';
import { WEEK_START } from '@/features/schedule/lib/calendar-utils';

export function getInitialView(): CalendarView {
  if (typeof window === 'undefined') return 'day';
  return window.innerWidth >= 768 ? 'week' : 'day';
}

/** 보기 방식에 맞는 조회 범위. 월 보기는 앞뒤 주까지 포함한다 */
export function getCalendarRange(
  view: CalendarView,
  currentDate: Date,
): { from: string; to: string } {
  let start: Date;
  let end: Date;

  switch (view) {
    case 'month':
      start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: WEEK_START });
      end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: WEEK_START });
      break;
    case 'week':
      start = startOfWeek(currentDate, { weekStartsOn: WEEK_START });
      end = endOfWeek(currentDate, { weekStartsOn: WEEK_START });
      break;
    case 'day':
      start = currentDate;
      end = currentDate;
      break;
  }

  return {
    from: format(start, 'yyyy-MM-dd'),
    to: format(end, 'yyyy-MM-dd'),
  };
}

export function useCalendarNavigation(initialView?: CalendarView) {
  const [view, setView] = useState<CalendarView>(initialView ?? getInitialView);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const range = useMemo(() => getCalendarRange(view, currentDate), [view, currentDate]);

  // 탭 복귀 시 날짜가 바뀌었으면 currentDate 갱신
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = new Date();
      if (format(now, 'yyyy-MM-dd') !== format(currentDate, 'yyyy-MM-dd')) {
        setCurrentDate(now);
        setSelectedDate(null);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [currentDate]);

  const handlePrev = () => {
    switch (view) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(subDays(currentDate, 1));
        break;
    }
    setSelectedDate(null);
  };

  const handleNext = () => {
    switch (view) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(addDays(currentDate, 1));
        break;
    }
    setSelectedDate(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
  };

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr === selectedDate ? null : dateStr);
  };

  return {
    view,
    setView,
    currentDate,
    selectedDate,
    range,
    handlePrev,
    handleNext,
    handleToday,
    handleSelectDate,
  };
}
