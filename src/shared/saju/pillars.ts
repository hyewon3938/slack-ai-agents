/** 기둥(일주·월주·년주) 계산과 절기월 범위. */

import { addDays } from '../kst.js';
import type { Jiji, Pillar } from './types.js';
import {
  JEOLGI_TABLE,
  JEOLGI_JIJI,
  JEOLGI_MONTH_OFFSET,
  JEOLGI_FIRST_YEAR,
  JEOLGI_LAST_YEAR,
} from './jeolgi-table.js';
import { daysDiff, indexToPillar, cheonganIndex, jijiIndex } from './helpers.js';

// ─── 절기 테이블 조회 ────────────────────────────────────

/**
 * 연도 절기 표 조회 — 없으면 throw. 소한 이전 날짜는 전년 표를, 대설 이후 날짜는 익년 표를
 * 참조하므로 필요한 연도와 조회 날짜가 다를 수 있어 둘 다 메시지에 남긴다.
 */
const requireJeolgiTable = (year: number, forDate?: string): readonly string[] => {
  const table = JEOLGI_TABLE[year];
  if (table) return table;
  const context = forDate && !forDate.startsWith(String(year)) ? ` — ${forDate} 계산에 필요` : '';
  throw new Error(
    `절기 데이터 없음: ${year}년${context} (지원 범위: ${JEOLGI_FIRST_YEAR}-${JEOLGI_LAST_YEAR})`,
  );
};

// ─── 기둥 계산 ──────────────────────────────────────────

/** 일주(日柱) 계산. 기준: 2024-02-04 = 戊戌(index 34). */
export const getDayPillar = (dateStr: string): Pillar => {
  const REF_DATE = '2024-02-04';
  const REF_INDEX = 34; // 戊戌 (검증: 2026-03-14 = 丁亥, index 23)
  const diff = daysDiff(dateStr, REF_DATE);
  return indexToPillar(REF_INDEX + diff);
};

/** 년주(年柱) 계산. 입춘 기준으로 사주년 결정. */
export const getYearPillar = (dateStr: string): Pillar => {
  const year = Number(dateStr.slice(0, 4));
  const ipchunDate = getIpchunDate(year);
  const sajuYear = dateStr < ipchunDate ? year - 1 : year;
  const idx = (((sajuYear - 4) % 60) + 60) % 60;
  return indexToPillar(idx);
};

/** 해당 년도 입춘 날짜 (YYYY-MM-DD) */
export const getIpchunDate = (year: number): string => {
  const table = requireJeolgiTable(year);
  return `${year}-${table[1]}`; // index 1 = 입춘
};

/** 월주(月柱) 계산. 절기 기준 월 전환 + 연간갑기토두 공식. */
export const getMonthPillar = (dateStr: string): Pillar => {
  const { jiji, monthOffset, sajuYear } = getJeolgiMonth(dateStr);
  const yearStemIdx = cheonganIndex(getYearPillar(`${sajuYear}-07-01`).cheongan);
  const inMonthStemIdx = (yearStemIdx % 5) * 2 + 2;
  const monthStemIdx = (inMonthStemIdx + monthOffset) % 10;

  const jijiIdx = jijiIndex(jiji);
  // 60갑자 index 계산: 천간 monthStemIdx + 지지 jijiIdx 조합
  // 인월(인=2)부터 시작, 갑인(50)이 기본 → 일반 공식 적용
  const ganjiIdx = findGanjiIndex(monthStemIdx, jijiIdx);
  return indexToPillar(ganjiIdx);
};

/** 천간 index + 지지 index → 60갑자 index */
const findGanjiIndex = (stemIdx: number, branchIdx: number): number => {
  // 60갑자에서 천간 i%10 = stemIdx, 지지 i%12 = branchIdx인 i를 찾음
  for (let i = 0; i < 60; i++) {
    if (i % 10 === stemIdx && i % 12 === branchIdx) return i;
  }
  // 음양 불일치 시 (양간+음지 또는 음간+양지) — 불가능한 조합
  throw new Error(`불가능한 간지 조합: 천간=${stemIdx}, 지지=${branchIdx}`);
};

/** 날짜로 절기 구간 판별 → 월지, monthOffset, 사주년 반환 */
const getJeolgiMonth = (
  dateStr: string,
): {
  jiji: Jiji;
  monthOffset: number;
  sajuYear: number;
} => {
  const year = Number(dateStr.slice(0, 4));
  const mmdd = dateStr.slice(5); // "MM-DD"

  // 현재 년도 절기 테이블
  const table = requireJeolgiTable(year, dateStr);

  // 절기 구간 역순 탐색: 마지막으로 지난 절기 찾기
  for (let i = 11; i >= 0; i--) {
    if (mmdd >= table[i]) {
      const sajuYear = i >= 1 ? year : year - 1; // 소한(i=0)은 입춘 전 → 전년
      // 전년 사주년이면 월간 계산이 전년 년주(전년 입춘)를 쓰므로 전년 표가 필요 — 조회 날짜를 메시지에 남긴다.
      if (sajuYear !== year) requireJeolgiTable(sajuYear, dateStr);
      return {
        jiji: JEOLGI_JIJI[i],
        monthOffset: JEOLGI_MONTH_OFFSET[i],
        sajuYear,
      };
    }
  }

  // mmdd가 소한보다 이전 → 전년 대설 이후 (자월). 위와 같은 이유로 전년 표 필요.
  requireJeolgiTable(year - 1, dateStr);
  return {
    jiji: '자',
    monthOffset: 10,
    sajuYear: year - 1,
  };
};

/**
 * 날짜가 속한 절기월의 [시작일, 끝일] + 월지 반환.
 * 시작일 = 해당 절기 전환일, 끝일 = 다음 절기 전환 전날.
 * 자월(대설→소한)은 연 경계를 넘으므로 전년 대설 / 익년 소한을 참조.
 * @param date YYYY-MM-DD
 */
export const getJeolgiMonthRange = (date: string): { start: string; end: string; jiji: Jiji } => {
  const year = Number(date.slice(0, 4));
  const mmdd = date.slice(5);
  const table = requireJeolgiTable(year, date);

  // 당년 절기 중 date 이하의 마지막 전환 찾기
  let idx = -1;
  for (let i = 11; i >= 0; i--) {
    if (mmdd >= table[i]) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    // date가 당년 소한보다 이전 → 전년 대설에 시작된 자월
    const prev = requireJeolgiTable(year - 1, date);
    return {
      start: `${year - 1}-${prev[11]}`, // 전년 대설
      end: addDays(`${year}-${table[0]}`, -1), // 당년 소한 전날
      jiji: JEOLGI_JIJI[11], // 자
    };
  }

  if (idx === 11) {
    // 대설 → 자월, 끝 = 익년 소한 전날
    const next = requireJeolgiTable(year + 1, date);
    return {
      start: `${year}-${table[11]}`,
      end: addDays(`${year + 1}-${next[0]}`, -1),
      jiji: JEOLGI_JIJI[11],
    };
  }

  return {
    start: `${year}-${table[idx]}`,
    end: addDays(`${year}-${table[idx + 1]}`, -1),
    jiji: JEOLGI_JIJI[idx],
  };
};

/**
 * 해당 날짜가 절기 전환일(월 전환 12절기 중 하나)인지 여부.
 * 입춘일도 true(입춘 = 인월 전환).
 * @param date YYYY-MM-DD
 */
export const isJeolgiTransitionDay = (date: string): boolean => {
  const year = Number(date.slice(0, 4));
  const table = requireJeolgiTable(year, date);
  return table.includes(date.slice(5));
};
