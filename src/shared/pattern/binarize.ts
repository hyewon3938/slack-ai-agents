/**
 * 윈도우 일자 배열 + sql 신호 시리즈 이진화 (pattern-verification에서 분리).
 */

import { addDays } from '../kst.js';
import type { DaySeries, SignalDirection } from './types.js';

// ─── 순수 계산 ───────────────────────────────────────────

/** today 포함 [today - cap, today] 오름차순 ISO 일자 배열. */
export const buildWindowDates = (today: string, cap: number): string[] => {
  const dates: string[] = [];
  for (let i = cap; i >= 0; i--) dates.push(addDays(today, -i));
  return dates;
};

/**
 * above_avg/below_avg용 rolling baseline = 직전 windowDays 일의 non-null raw 평균.
 * 워밍업(i < windowDays) 미충족 시 null(2×2에서 제외 → 초기 28일 같은 미성숙 baseline 배제).
 */
const rollingBaseline = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  i: number,
  windowDays: number,
): number | null => {
  if (i < windowDays) return null;
  let sum = 0;
  let n = 0;
  for (let j = i - windowDays; j < i; j++) {
    const v = rawByDate.get(windowDates[j] ?? '');
    if (v !== null && v !== undefined) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
};

/**
 * sql 신호 raw 값 시리즈를 direction 기준 이진화.
 * above_avg/below_avg는 baseline 이진화(ADR-0032 §3 — e-value 게이트는 이진, 연속은 baseline 이진화).
 * above_abs/below_abs/flag_present는 절대 임계 비교(baseline 불요).
 */
export const binarizeSqlSeries = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  direction: SignalDirection,
  threshold: number | null,
  windowDays: number,
): DaySeries => {
  const series: DaySeries = new Map();
  for (let i = 0; i < windowDates.length; i++) {
    const date = windowDates[i] ?? '';
    const v = rawByDate.get(date);
    if (v === null || v === undefined) {
      series.set(date, null);
      continue;
    }
    switch (direction) {
      case 'above_abs':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'below_abs':
        series.set(date, v <= (threshold ?? 0));
        break;
      case 'flag_present':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'above_avg':
      case 'below_avg': {
        const base = rollingBaseline(rawByDate, windowDates, i, windowDays);
        if (base === null) {
          series.set(date, null);
          break;
        }
        series.set(date, direction === 'above_avg' ? v > base : v < base);
        break;
      }
    }
  }
  return series;
};
