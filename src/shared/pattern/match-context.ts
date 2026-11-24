/**
 * 본명·일운 컨텍스트 로드 (pattern-match에서 분리).
 */

import { query } from '../db.js';
import {
  type Cheongan,
  type Jiji,
  getDaeunPillar,
  getDayPillar,
  getMonthPillar,
  getYearPillar,
  makePillar,
} from '../saju-calendar.js';
import type { DailyContext, NatalContext } from './match-types.js';

// ─── 본명 / 일운 컨텍스트 ────────────────────────────────

interface SajuProfileRow {
  day_pillar: string;
  year_pillar: string;
  month_pillar: string;
  hour_pillar: string;
  birth_date: string | null;
  daewun_list: unknown;
}

interface DaewunEntry {
  age: number;
  pillar: string;
}

const isDaewunEntryArray = (value: unknown): value is DaewunEntry[] => {
  if (!Array.isArray(value)) return false;
  return value.every(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Record<string, unknown>).age === 'number' &&
      typeof (v as Record<string, unknown>).pillar === 'string',
  );
};

export const loadNatalContext = async (userId: number): Promise<NatalContext | null> => {
  const result = await query<SajuProfileRow>(
    `SELECT day_pillar, year_pillar, month_pillar, hour_pillar,
            birth_date::text AS birth_date, daewun_list
       FROM saju_profiles WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const pillarStrs = [row.year_pillar, row.month_pillar, row.day_pillar, row.hour_pillar];
  const stems = pillarStrs.map((p) => p.charAt(0)) as Cheongan[];
  const branches = pillarStrs.map((p) => p.charAt(1)) as Jiji[];
  const pillars = pillarStrs.map((p) => makePillar(p.charAt(0) as Cheongan, p.charAt(1) as Jiji));
  const daewunList = isDaewunEntryArray(row.daewun_list) ? row.daewun_list : [];

  return {
    stems,
    branches,
    dayMaster: row.day_pillar.charAt(0) as Cheongan,
    pillars,
    birthDate: row.birth_date,
    daewunList,
  };
};

export const getDailyContext = async (
  userId: number,
  date: string,
): Promise<DailyContext | null> => {
  const natal = await loadNatalContext(userId);
  if (!natal) return null;
  const ilun = getDayPillar(date);
  const wolun = getMonthPillar(date);
  const seun = getYearPillar(date);
  const daeun = natal.birthDate ? getDaeunPillar(natal.birthDate, natal.daewunList, date) : null;
  return {
    date,
    userId,
    dayStem: ilun.cheongan,
    dayBranch: ilun.jiji,
    natal,
    ilun,
    wolun,
    seun,
    daeun,
  };
};
