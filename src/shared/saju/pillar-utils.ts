/** 오행·Pillar 유틸과 대운 추출. */

import type { Cheongan, Jiji, Pillar, Element } from './types.js';
import {
  CHEONGAN_LIST,
  JIJI_LIST,
  CHEONGAN_HANJA,
  JIJI_HANJA,
  CHEONGAN_ELEMENT,
  JIJI_BONGI,
} from './tables.js';
import { parseDate, cheonganIndex, jijiIndex } from './helpers.js';

// ─── Phase 2.5: 오행/Pillar 유틸 + 대운 추출 + 누적 카운트 ──

const ELEMENT_LIST: readonly Element[] = ['목', '화', '토', '금', '수'];

/** 천간 → 오행 */
export const getElementByCheongan = (c: Cheongan): Element =>
  ELEMENT_LIST[CHEONGAN_ELEMENT[cheonganIndex(c)]];

/** 지지 → 오행 (본기 천간 기준) */
export const getElementByJiji = (j: Jiji): Element =>
  ELEMENT_LIST[CHEONGAN_ELEMENT[JIJI_BONGI[jijiIndex(j)]]];

/**
 * 천간 + 지지 → Pillar.
 * 음양 mismatch(유효한 60갑자 조합 아님)는 index=-1로 표기, 객체는 정상 반환.
 * (테스트 fixture·임의 stem+branch 조합 허용용. 프로덕션 데이터는 항상 유효 갑자.)
 */
export const makePillar = (cheongan: Cheongan, jiji: Jiji): Pillar => {
  const cIdx = cheonganIndex(cheongan);
  const jIdx = jijiIndex(jiji);
  if (cIdx < 0) throw new Error(`알 수 없는 천간: ${cheongan}`);
  if (jIdx < 0) throw new Error(`알 수 없는 지지: ${jiji}`);
  let index = -1;
  for (let i = 0; i < 60; i++) {
    if (i % 10 === cIdx && i % 12 === jIdx) {
      index = i;
      break;
    }
  }
  return {
    index,
    hanja: `${CHEONGAN_HANJA[cIdx]}${JIJI_HANJA[jIdx]}`,
    hangul: `${CHEONGAN_LIST[cIdx]}${JIJI_LIST[jIdx]}`,
    cheongan,
    jiji,
  };
};

/** '병인' 같은 한글 2자 간지 문자열 → Pillar */
export const parsePillarString = (s: string): Pillar => {
  if (s.length !== 2) throw new Error(`잘못된 pillar 문자열: ${s}`);
  return makePillar(s.charAt(0) as Cheongan, s.charAt(1) as Jiji);
};

/** 만 나이 계산 (생일 미도래 시 -1) */
const calcAge = (birthDate: string, targetDate: string): number => {
  const birth = parseDate(birthDate);
  const target = parseDate(targetDate);
  let age = target.getFullYear() - birth.getFullYear();
  const bm = birth.getMonth();
  const bd = birth.getDate();
  const tm = target.getMonth();
  const td = target.getDate();
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
};

/**
 * daewun_list에서 targetDate 시점 활성 대운 추출.
 * daewun_list는 `[{age, pillar}, ...]` 형식 (saju_profiles 컬럼).
 * birthDate 기준 만 나이가 첫 entry보다 어리면 null (대운 미시작).
 * 그 외에는 age <= entry.age인 가장 큰 entry의 pillar 반환.
 *
 * @param birthDate YYYY-MM-DD
 * @param daewunList saju_profiles.daewun_list (오름차순 age 가정)
 * @param targetDate YYYY-MM-DD
 */
export const getDaeunPillar = (
  birthDate: string,
  daewunList: ReadonlyArray<{ age: number; pillar: string }>,
  targetDate: string,
): Pillar | null => {
  if (daewunList.length === 0) return null;
  const age = calcAge(birthDate, targetDate);
  const sorted = [...daewunList].sort((a, b) => a.age - b.age);
  if (age < sorted[0].age) return null;
  let active = sorted[0];
  for (const entry of sorted) {
    if (entry.age <= age) active = entry;
    else break;
  }
  return parsePillarString(active.pillar);
};
