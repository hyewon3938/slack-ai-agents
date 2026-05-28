/**
 * season evaluator — 양력 월 기반 4계절 (KST 기준).
 *
 * spring: 3, 4, 5월
 * summer: 6, 7, 8월
 * autumn: 9, 10, 11월
 * winter: 12, 1, 2월
 *
 * 절기 기반 계절(입춘 등)이 아니라 양력 월 기반. Phase 4+에서 절기 기반 fine-grain 검토.
 */

import type { DailyContext, SeasonAux } from '../saju-match.js';

const SEASON_MONTHS: Record<SeasonAux['season'], readonly number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

export const evaluateSeason = async (aux: SeasonAux, ctx: DailyContext): Promise<boolean> => {
  // ctx.date는 'YYYY-MM-DD' (KST 캘린더). month는 timezone과 무관 — 문자열 파싱.
  const month = Number(ctx.date.slice(5, 7)); // 1-12
  return SEASON_MONTHS[aux.season].includes(month);
};
