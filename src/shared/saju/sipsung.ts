/** 십성·십이운성·지장간 계산. */

import type { Cheongan, Jiji, Sipsung, Sibiunsung, Pillar, SipsungResult } from './types.js';
import {
  CHEONGAN_LIST,
  CHEONGAN_ELEMENT,
  CHEONGAN_YINYANG,
  JIJI_BONGI,
  JIJANGGAN,
  SIBIUNSUNG_CYCLE,
  YANG_JANGSEONG_START,
} from './tables.js';
import { cheonganIndex, jijiIndex } from './helpers.js';

// ─── 십성 계산 (범용) ───────────────────────────────────

/**
 * 천간 십성 계산. 일간(dayMaster)과 대상 천간의 오행/음양 관계로 결정.
 * ⚠️ '신'은 천간(辛)과 지지(申) 모두 존재 → 천간/지지 별도 함수 사용.
 */
export const getSipsung = (dayMaster: Cheongan, targetStem: Cheongan): Sipsung => {
  const dmIdx = cheonganIndex(dayMaster);
  const tIdx = cheonganIndex(targetStem);
  return classifySipsung(
    CHEONGAN_ELEMENT[dmIdx],
    CHEONGAN_ELEMENT[tIdx],
    CHEONGAN_YINYANG[dmIdx] === CHEONGAN_YINYANG[tIdx],
  );
};

/** 지지 본기 십성 계산. 지지를 본기 천간으로 변환 후 십성 계산. */
export const getJijiSipsung = (dayMaster: Cheongan, targetBranch: Jiji): Sipsung => {
  const dmIdx = cheonganIndex(dayMaster);
  const bongiIdx = JIJI_BONGI[jijiIndex(targetBranch)];
  return classifySipsung(
    CHEONGAN_ELEMENT[dmIdx],
    CHEONGAN_ELEMENT[bongiIdx],
    CHEONGAN_YINYANG[dmIdx] === CHEONGAN_YINYANG[bongiIdx],
  );
};

/** 오행 관계 → 십성 분류 */
const classifySipsung = (me: number, target: number, sameYinyang: boolean): Sipsung => {
  // 오행: 0=목, 1=화, 2=토, 3=금, 4=수
  // 상생: 목→화→토→금→수→목 (나가 생하는 방향)
  // 상극: 목→토→수→화→금→목 (내가 극하는 방향)

  if (me === target) return sameYinyang ? '비견' : '겁재';

  // 내가 생하는 관계 (me → target): 식신/상관
  if ((me + 1) % 5 === target) return sameYinyang ? '식신' : '상관';

  // 내가 극하는 관계: 편재/정재
  if ((me + 2) % 5 === target) return sameYinyang ? '편재' : '정재';

  // 나를 극하는 관계: 편관/정관
  if ((me + 3) % 5 === target) return sameYinyang ? '편관' : '정관';

  // 나를 생하는 관계: 편인/정인
  if ((me + 4) % 5 === target) return sameYinyang ? '편인' : '정인';

  throw new Error(`오행 관계 계산 실패: me=${me}, target=${target}`);
};

/** 세 기둥의 십성 분석 결과 */
export const getSipsungResult = (
  dayMaster: Cheongan,
  dayPillar: Pillar,
  monthPillar: Pillar,
  yearPillar: Pillar,
): SipsungResult => ({
  dayCheongan: getSipsung(dayMaster, dayPillar.cheongan),
  dayJiji: getJijiSipsung(dayMaster, dayPillar.jiji),
  monthCheongan: getSipsung(dayMaster, monthPillar.cheongan),
  monthJiji: getJijiSipsung(dayMaster, monthPillar.jiji),
  yearCheongan: getSipsung(dayMaster, yearPillar.cheongan),
  yearJiji: getJijiSipsung(dayMaster, yearPillar.jiji),
});

// ─── 십이운성 계산 (범용) ────────────────────────────────

/** 십이운성 계산. 양간은 순행, 음간은 역행. */
export const getSibiunsung = (dayMaster: Cheongan, jiji: Jiji): Sibiunsung => {
  const dmIdx = cheonganIndex(dayMaster);
  const jIdx = jijiIndex(jiji);
  const isYang = CHEONGAN_YINYANG[dmIdx] === 0;

  // 양간: 장생 시작 지지에서 순행
  // 음간: 같은 오행의 양간 장생 위치에서 역행
  const yangIdx = isYang ? dmIdx : dmIdx - 1; // 음간의 짝 양간
  const startJiji = YANG_JANGSEONG_START[yangIdx];
  if (startJiji === undefined) throw new Error(`장생 시작 지지 없음: ${dayMaster}`);

  if (isYang) {
    const offset = (((jIdx - startJiji) % 12) + 12) % 12;
    return SIBIUNSUNG_CYCLE[offset];
  }
  // 음간: 역행
  const offset = (((startJiji - jIdx) % 12) + 12) % 12;
  return SIBIUNSUNG_CYCLE[offset];
};

// ─── 지장간 조회 ─────────────────────────────────────────

/** 지지의 지장간 정보를 한글(천간)로 반환 */
export const getJijanggan = (
  jiji: Jiji,
): {
  yeogi: Cheongan;
  junggi?: Cheongan;
  jeonggi: Cheongan;
} => {
  const entry = JIJANGGAN[jijiIndex(jiji)];
  return {
    yeogi: CHEONGAN_LIST[entry.yeogi],
    junggi: entry.junggi !== undefined ? CHEONGAN_LIST[entry.junggi] : undefined,
    jeonggi: CHEONGAN_LIST[entry.jeonggi],
  };
};
