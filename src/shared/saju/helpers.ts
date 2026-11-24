/** 날짜·간지 index 헬퍼. */

import type { Cheongan, Jiji, Pillar } from './types.js';
import { CHEONGAN_LIST, JIJI_LIST, CHEONGAN_HANJA, JIJI_HANJA } from './tables.js';

// ─── 헬퍼 ───────────────────────────────────────────────

/** YYYY-MM-DD → KST 정오 Date (날짜 경계 안전) */
export const parseDate = (dateStr: string): Date => new Date(`${dateStr}T12:00:00+09:00`);

/** 두 날짜 간 일수 차이 */
export const daysDiff = (a: string, b: string): number => {
  const msPerDay = 86_400_000;
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / msPerDay);
};

/** 60갑자 index → Pillar */
export const indexToPillar = (idx: number): Pillar => {
  const i = ((idx % 60) + 60) % 60;
  const cIdx = i % 10;
  const jIdx = i % 12;
  return {
    index: i,
    hanja: `${CHEONGAN_HANJA[cIdx]}${JIJI_HANJA[jIdx]}`,
    hangul: `${CHEONGAN_LIST[cIdx]}${JIJI_LIST[jIdx]}`,
    cheongan: CHEONGAN_LIST[cIdx],
    jiji: JIJI_LIST[jIdx],
  };
};

export const cheonganIndex = (c: Cheongan | string): number => CHEONGAN_LIST.indexOf(c as Cheongan);
export const jijiIndex = (j: Jiji | string): number => JIJI_LIST.indexOf(j as Jiji);
