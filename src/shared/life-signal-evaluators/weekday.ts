/**
 * weekday / weekday_group evaluator.
 * 한국 시간(KST = UTC+9) 기준으로 요일 판정.
 */

import type { DailyContext, WeekdayAux, WeekdayGroupAux } from '../saju-match.js';

const dowFromISO = (date: string): number => {
  // ctx.date는 'YYYY-MM-DD' (KST 캘린더 기준). 요일은 timezone과 무관 — y/m/d를 UTC로 해석해 getUTCDay.
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export const evaluateWeekday = async (aux: WeekdayAux, ctx: DailyContext): Promise<boolean> => {
  return dowFromISO(ctx.date) === aux.dow;
};

export const evaluateWeekdayGroup = async (
  aux: WeekdayGroupAux,
  ctx: DailyContext,
): Promise<boolean> => {
  const dow = dowFromISO(ctx.date);
  const isWeekend = dow === 0 || dow === 6;
  return aux.group === 'weekend' ? isWeekend : !isWeekend;
};
