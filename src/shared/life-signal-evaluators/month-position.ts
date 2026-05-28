/**
 * month_position evaluator — 월초 / 월말 / 월중 (KST 기준).
 *
 * position='start': 1일부터 range_days(기본 3)일 이내
 * position='end':   해당 월 말일 직전 range_days(기본 3)일 이내
 * position='mid':   start..end 범위 (기본 11..20)
 */

import type { DailyContext, MonthPositionAux } from '../saju-match.js';

export const evaluateMonthPosition = async (
  aux: MonthPositionAux,
  ctx: DailyContext,
): Promise<boolean> => {
  // ctx.date는 'YYYY-MM-DD' (KST 캘린더). y/m/d를 UTC로 해석 — month/day는 timezone과 무관.
  const [year, monthOneBased, day] = ctx.date.split('-').map(Number);
  // 해당 월 말일 = 다음달 0일 (UTC 안전)
  const lastDay = new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();

  switch (aux.position) {
    case 'start':
      return day <= (aux.range_days ?? 3);
    case 'end':
      return day > lastDay - (aux.range_days ?? 3);
    case 'mid': {
      const start = aux.start ?? 11;
      const end = aux.end ?? 20;
      return day >= start && day <= end;
    }
  }
};
