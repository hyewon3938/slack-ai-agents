/** 일운 통합 계산 진입점. */

import { addDays } from '../kst.js';
import type { Cheongan, Jiji, DailyFortuneData } from './types.js';
import { getDayPillar, getYearPillar, getMonthPillar } from './pillars.js';
import { getSipsungResult, getSibiunsung, getJijanggan } from './sipsung.js';
import { getRelations } from './relations.js';

// ─── 통합 진입점 ────────────────────────────────────────

/** 단일 날짜 전체 사주 데이터 계산 */
export const calculateDailyFortune = (
  dateStr: string,
  dayMaster: Cheongan,
  wonkukStems: readonly Cheongan[],
  wonkukBranches: readonly Jiji[],
): DailyFortuneData => {
  const dayPillar = getDayPillar(dateStr);
  const monthPillar = getMonthPillar(dateStr);
  const yearPillar = getYearPillar(dateStr);

  const dayJijanggan = getJijanggan(dayPillar.jiji);

  return {
    date: dateStr,
    dayPillar,
    monthPillar,
    yearPillar,
    sipsung: getSipsungResult(dayMaster, dayPillar, monthPillar, yearPillar),
    sibiunsung: getSibiunsung(dayMaster, dayPillar.jiji),
    relations: getRelations(wonkukStems, wonkukBranches, dayPillar.cheongan, dayPillar.jiji),
    jijanggan: {
      day: {
        yeogi: dayJijanggan.yeogi,
        junggi: dayJijanggan.junggi,
        jeonggi: dayJijanggan.jeonggi,
      },
    },
  };
};

/** N일 범위 계산 */
export const calculateFortuneRange = (
  startDate: string,
  count: number,
  dayMaster: Cheongan,
  wonkukStems: readonly Cheongan[],
  wonkukBranches: readonly Jiji[],
): DailyFortuneData[] => {
  const results: DailyFortuneData[] = [];
  for (let i = 0; i < count; i++) {
    const dateStr = i === 0 ? startDate : addDays(startDate, i);
    results.push(calculateDailyFortune(dateStr, dayMaster, wonkukStems, wonkukBranches));
  }
  return results;
};
