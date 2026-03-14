/**
 * 만세력 계산 유틸리티.
 * 결정론적 사주 데이터(일주/월주/년주/십성/십이운성/합충)를 코드로 계산.
 * 모든 함수는 일간/원국을 파라미터로 받는 범용 유틸리티 (개인 데이터 하드코딩 없음).
 *
 * CLI: npx tsx src/shared/saju-calendar.ts [날짜] [일수]
 * 모듈: import { getDayPillar, calculateDailyFortune } from './saju-calendar.js'
 */

import { addDays, getTodayISO } from './kst.js';

// ─── 타입 ───────────────────────────────────────────────

export type Cheongan = '갑' | '을' | '병' | '정' | '무' | '기' | '경' | '신' | '임' | '계';
export type Jiji = '자' | '축' | '인' | '묘' | '진' | '사' | '오' | '미' | '신' | '유' | '술' | '해';
export type Sipsung = '비견' | '겁재' | '식신' | '상관' | '편재' | '정재' | '편관' | '정관' | '편인' | '정인';
export type Sibiunsung = '장생' | '목욕' | '관대' | '건록' | '제왕' | '쇠' | '병' | '사' | '묘' | '절' | '태' | '양';

export interface Pillar {
  index: number;
  hanja: string;
  hangul: string;
  cheongan: Cheongan;
  jiji: Jiji;
}

export interface SipsungResult {
  dayCheongan: Sipsung;
  dayJiji: Sipsung;
  monthCheongan: Sipsung;
  monthJiji: Sipsung;
  yearCheongan: Sipsung;
  yearJiji: Sipsung;
}

export interface Relations {
  cheonganHap: string[];
  jijiChung: string[];
  jijiHap: string[];
  jijiHyung: string[];
  jijipa: string[];
  jijiHae: string[];
}

export interface DailyFortuneData {
  date: string;
  dayPillar: Pillar;
  monthPillar: Pillar;
  yearPillar: Pillar;
  sipsung: SipsungResult;
  sibiunsung: Sibiunsung;
  relations: Relations;
}

// ─── 상수: 천간/지지 ────────────────────────────────────

const CHEONGAN_LIST: readonly Cheongan[] = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const JIJI_LIST: readonly Jiji[] = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const CHEONGAN_HANJA: readonly string[] = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const JIJI_HANJA: readonly string[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// ─── 상수: 오행 ─────────────────────────────────────────

/** 천간 → 오행 index (0=목, 1=화, 2=토, 3=금, 4=수) */
const CHEONGAN_ELEMENT: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];

/** 천간 음양 (0=양, 1=음) */
const CHEONGAN_YINYANG: readonly number[] = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];

/** 지지 → 본기 천간 index */
const JIJI_BONGI: readonly number[] = [
  // 자=계(9), 축=기(5), 인=갑(0), 묘=을(1), 진=무(4), 사=병(2)
  // 오=정(3), 미=기(5), 신=경(6), 유=신(7), 술=무(4), 해=임(8)
  9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8,
];

// ─── 상수: 십이운성 ──────────────────────────────────────

const SIBIUNSUNG_CYCLE: readonly Sibiunsung[] = [
  '장생', '목욕', '관대', '건록', '제왕', '쇠', '병', '사', '묘', '절', '태', '양',
];

/** 양간별 장생 시작 지지 index: 갑=해(11), 병=인(2), 무=인(2), 경=사(5), 임=신(8) */
const YANG_JANGSEONG_START: Record<number, number> = {
  0: 11, // 갑 → 해
  2: 2,  // 병 → 인
  4: 2,  // 무 → 인
  6: 5,  // 경 → 사
  8: 8,  // 임 → 신
};

// ─── 상수: 합충형파해 ───────────────────────────────────

/** 천간합: [a, b, 합화오행] */
const CHEONGAN_HAP: readonly [number, number, string][] = [
  [0, 5, '토'], // 갑기합
  [1, 6, '금'], // 을경합
  [2, 7, '수'], // 병신합
  [3, 8, '목'], // 정임합
  [4, 9, '화'], // 무계합
];

/** 지지육충: [a, b] */
const JIJI_CHUNG: readonly [number, number][] = [
  [0, 6],  // 자오충
  [1, 7],  // 축미충
  [2, 8],  // 인신충
  [3, 9],  // 묘유충
  [4, 10], // 진술충
  [5, 11], // 사해충
];

/** 지지육합: [a, b, 합화오행] */
const JIJI_YUKHAP: readonly [number, number, string][] = [
  [0, 1, '토'],   // 자축합
  [2, 11, '목'],  // 인해합
  [3, 10, '화'],  // 묘술합
  [4, 9, '금'],   // 진유합
  [5, 8, '수'],   // 사신합
  [6, 7, '토'],   // 오미합
];

/** 지지삼합: [a, b, c, 합화오행] */
const JIJI_SAMHAP: readonly [number, number, number, string][] = [
  [8, 0, 4, '수'],   // 신자진
  [11, 3, 7, '목'],  // 해묘미
  [2, 6, 10, '화'],  // 인오술
  [5, 9, 1, '금'],   // 사유축
];

/** 지지형: [a, b] (방향성 있는 쌍) */
const JIJI_HYUNG: readonly [number, number][] = [
  [2, 5],  // 인사형 (삼형)
  [5, 8],  // 사신형 (삼형)
  [2, 8],  // 인신형 (삼형)
  [1, 10], // 축술형 (삼형)
  [10, 7], // 술미형 (삼형)
  [1, 7],  // 축미형 (삼형)
  [0, 3],  // 자묘형
  [3, 0],  // 묘자형
];

/** 지지파: [a, b] */
const JIJI_PA: readonly [number, number][] = [
  [0, 9],  // 자유파
  [1, 4],  // 축진파
  [2, 11], // 인해파
  [3, 6],  // 묘오파
  [5, 8],  // 사신파
  [10, 7], // 술미파
];

/** 지지해: [a, b] */
const JIJI_HAE: readonly [number, number][] = [
  [0, 7],  // 자미해
  [1, 6],  // 축오해
  [2, 5],  // 인사해
  [3, 4],  // 묘진해
  [8, 11], // 신해해
  [9, 10], // 유술해
];

// ─── 상수: 절기 테이블 (2024-2028) ──────────────────────

/**
 * 월 전환 절기 날짜 (MM-DD).
 * 순서: [소한, 입춘, 경칩, 청명, 입하, 망종, 소서, 입추, 백로, 한로, 입동, 대설]
 * 대응 월지: [축, 인, 묘, 진, 사, 오, 미, 신, 유, 술, 해, 자]
 * 출처: uncle.tools (NASA DE441 데이터 기반)
 */
const JEOLGI_TABLE: Record<number, readonly string[]> = {
  2024: ['01-06', '02-04', '03-05', '04-04', '05-05', '06-05', '07-06', '08-07', '09-07', '10-08', '11-07', '12-07'],
  2025: ['01-05', '02-03', '03-05', '04-04', '05-05', '06-05', '07-07', '08-07', '09-07', '10-08', '11-07', '12-07'],
  2026: ['01-05', '02-04', '03-05', '04-05', '05-05', '06-06', '07-07', '08-07', '09-07', '10-08', '11-07', '12-07'],
  2027: ['01-05', '02-04', '03-06', '04-05', '05-06', '06-06', '07-07', '08-08', '09-08', '10-08', '11-08', '12-07'],
  2028: ['01-06', '02-04', '03-05', '04-04', '05-05', '06-05', '07-06', '08-07', '09-07', '10-08', '11-07', '12-06'],
};

/** 절기 → 월지 매핑 (index 0-11 → 지지) */
const JEOLGI_JIJI: readonly Jiji[] = ['축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해', '자'];

/** 절기 → 월 offset (인월=0 기준) */
const JEOLGI_MONTH_OFFSET: readonly number[] = [11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ─── 헬퍼 ───────────────────────────────────────────────

/** YYYY-MM-DD → KST 정오 Date (날짜 경계 안전) */
const parseDate = (dateStr: string): Date =>
  new Date(`${dateStr}T12:00:00+09:00`);

/** 두 날짜 간 일수 차이 */
const daysDiff = (a: string, b: string): number => {
  const msPerDay = 86_400_000;
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / msPerDay);
};

/** 60갑자 index → Pillar */
const indexToPillar = (idx: number): Pillar => {
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

const cheonganIndex = (c: Cheongan | string): number => CHEONGAN_LIST.indexOf(c as Cheongan);
const jijiIndex = (j: Jiji | string): number => JIJI_LIST.indexOf(j as Jiji);

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
  const idx = ((sajuYear - 4) % 60 + 60) % 60;
  return indexToPillar(idx);
};

/** 해당 년도 입춘 날짜 (YYYY-MM-DD) */
const getIpchunDate = (year: number): string => {
  const table = JEOLGI_TABLE[year];
  if (!table) throw new Error(`절기 데이터 없음: ${year}년 (지원 범위: 2024-2028)`);
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
const getJeolgiMonth = (dateStr: string): {
  jiji: Jiji; monthOffset: number; sajuYear: number;
} => {
  const year = Number(dateStr.slice(0, 4));
  const mmdd = dateStr.slice(5); // "MM-DD"

  // 현재 년도 절기 테이블
  const table = JEOLGI_TABLE[year];
  if (!table) throw new Error(`절기 데이터 없음: ${year}년 (지원 범위: 2024-2028)`);

  // 절기 구간 역순 탐색: 마지막으로 지난 절기 찾기
  for (let i = 11; i >= 0; i--) {
    if (mmdd >= table[i]) {
      const sajuYear = i >= 1 ? year : year - 1; // 소한(i=0)은 입춘 전 → 전년
      return {
        jiji: JEOLGI_JIJI[i],
        monthOffset: JEOLGI_MONTH_OFFSET[i],
        sajuYear,
      };
    }
  }

  // mmdd가 소한보다 이전 → 전년 대설 이후 (자월)
  const prevTable = JEOLGI_TABLE[year - 1];
  if (!prevTable) throw new Error(`절기 데이터 없음: ${year - 1}년 (지원 범위: 2024-2028)`);
  return {
    jiji: '자',
    monthOffset: 10,
    sajuYear: year - 1,
  };
};

// ─── 십성 계산 (범용) ───────────────────────────────────

/**
 * 천간 십성 계산. 일간(dayMaster)과 대상 천간의 오행/음양 관계로 결정.
 * ⚠️ '신'은 천간(辛)과 지지(申) 모두 존재 → 천간/지지 별도 함수 사용.
 */
export const getSipsung = (dayMaster: Cheongan, targetStem: Cheongan): Sipsung => {
  const dmIdx = cheonganIndex(dayMaster);
  const tIdx = cheonganIndex(targetStem);
  return classifySipsung(
    CHEONGAN_ELEMENT[dmIdx], CHEONGAN_ELEMENT[tIdx],
    CHEONGAN_YINYANG[dmIdx] === CHEONGAN_YINYANG[tIdx],
  );
};

/** 지지 본기 십성 계산. 지지를 본기 천간으로 변환 후 십성 계산. */
export const getJijiSipsung = (dayMaster: Cheongan, targetBranch: Jiji): Sipsung => {
  const dmIdx = cheonganIndex(dayMaster);
  const bongiIdx = JIJI_BONGI[jijiIndex(targetBranch)];
  return classifySipsung(
    CHEONGAN_ELEMENT[dmIdx], CHEONGAN_ELEMENT[bongiIdx],
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
    const offset = ((jIdx - startJiji) % 12 + 12) % 12;
    return SIBIUNSUNG_CYCLE[offset];
  }
  // 음간: 역행
  const offset = ((startJiji - jIdx) % 12 + 12) % 12;
  return SIBIUNSUNG_CYCLE[offset];
};

// ─── 합충형파해 분석 ────────────────────────────────────

/** 원국과 일운 간 합충형파해 관계 탐지 */
export const getRelations = (
  wonkukStems: readonly Cheongan[],
  wonkukBranches: readonly Jiji[],
  targetStem: Cheongan | string,
  targetBranch: Jiji | string,
): Relations => {
  const tStemIdx = cheonganIndex(targetStem);
  const tBranchIdx = jijiIndex(targetBranch);
  const names = ['년주', '월주', '일주', '시주'];

  const result: Relations = {
    cheonganHap: [],
    jijiChung: [],
    jijiHap: [],
    jijiHyung: [],
    jijipa: [],
    jijiHae: [],
  };

  // 천간합 탐지
  for (let i = 0; i < wonkukStems.length; i++) {
    const wIdx = cheonganIndex(wonkukStems[i]);
    for (const [a, b, element] of CHEONGAN_HAP) {
      if ((tStemIdx === a && wIdx === b) || (tStemIdx === b && wIdx === a)) {
        result.cheonganHap.push(
          `${CHEONGAN_LIST[tStemIdx]}-${wonkukStems[i]} 합(${element})`,
        );
      }
    }
  }

  // 지지 관계 탐지
  for (let i = 0; i < wonkukBranches.length; i++) {
    const wIdx = jijiIndex(wonkukBranches[i]);
    checkJijiRelation(tBranchIdx, wIdx, names[i], JIJI_CHUNG, result.jijiChung, '충');
    checkJijiYukhap(tBranchIdx, wIdx, names[i], result.jijiHap);
    checkJijiRelation(tBranchIdx, wIdx, names[i], JIJI_HYUNG, result.jijiHyung, '형');
    checkJijiRelation(tBranchIdx, wIdx, names[i], JIJI_PA, result.jijipa, '파');
    checkJijiRelation(tBranchIdx, wIdx, names[i], JIJI_HAE, result.jijiHae, '해');
  }

  // 삼합 부분 체크 (일운 지지 + 원국 지지 2개 이상이면 삼합 성립)
  checkSamhap(tBranchIdx, wonkukBranches, result.jijiHap);

  return result;
};

/** 지지 관계 체크 (충/형/파/해) */
const checkJijiRelation = (
  a: number, b: number, pillarName: string,
  table: readonly (readonly [number, number])[],
  results: string[], label: string,
): void => {
  for (const [x, y] of table) {
    if ((a === x && b === y) || (a === y && b === x)) {
      results.push(`${JIJI_LIST[a]}-${JIJI_LIST[b]} ${label}`);
      return; // 중복 방지
    }
  }
};

/** 지지 육합 체크 */
const checkJijiYukhap = (
  a: number, b: number, pillarName: string, results: string[],
): void => {
  for (const [x, y, element] of JIJI_YUKHAP) {
    if ((a === x && b === y) || (a === y && b === x)) {
      results.push(`${JIJI_LIST[a]}-${JIJI_LIST[b]} 합(${element})`);
      return;
    }
  }
};

/** 삼합 체크: 일운 지지 + 원국 지지에서 삼합 구성 확인 */
const checkSamhap = (
  targetBranch: number,
  wonkukBranches: readonly Jiji[],
  results: string[],
): void => {
  const wIdxSet = new Set(wonkukBranches.map(jijiIndex));

  for (const [a, b, c, element] of JIJI_SAMHAP) {
    const trio = [a, b, c];
    if (!trio.includes(targetBranch)) continue;

    // 일운 지지를 포함한 삼합에서, 원국에 나머지 2개 중 1개 이상 있으면 반삼합
    const others = trio.filter(t => t !== targetBranch);
    const matchCount = others.filter(t => wIdxSet.has(t)).length;

    if (matchCount >= 2) {
      results.push(`${JIJI_LIST[a]}${JIJI_LIST[b]}${JIJI_LIST[c]} 삼합(${element})`);
    } else if (matchCount === 1) {
      const matched = others.find(t => wIdxSet.has(t))!;
      results.push(`${JIJI_LIST[targetBranch]}-${JIJI_LIST[matched]} 반삼합(${element})`);
    }
  }
};

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

  return {
    date: dateStr,
    dayPillar,
    monthPillar,
    yearPillar,
    sipsung: getSipsungResult(dayMaster, dayPillar, monthPillar, yearPillar),
    sibiunsung: getSibiunsung(dayMaster, dayPillar.jiji),
    relations: getRelations(wonkukStems, wonkukBranches, dayPillar.cheongan, dayPillar.jiji),
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

// ─── CLI 모드 ───────────────────────────────────────────

const runCLI = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const startDate = args[0] ?? getTodayISO();
  const count = Number(args[1] ?? 1);

  // DB에서 사주 프로필 조회
  const dotenv = await import('dotenv');
  dotenv.config();

  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL 환경변수 필요');

  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query<{
      day_pillar: string;
      year_pillar: string;
      month_pillar: string;
      hour_pillar: string;
    }>(
      'SELECT day_pillar, year_pillar, month_pillar, hour_pillar FROM saju_profiles WHERE user_id = 1',
    );
    if (rows.length === 0) throw new Error('사주 프로필 미등록');

    const profile = rows[0];
    // 일간 추출 (일주의 첫 글자)
    const dayMaster = profile.day_pillar.charAt(0) as Cheongan;
    // 원국 천간/지지 추출
    const pillars = [profile.year_pillar, profile.month_pillar, profile.day_pillar, profile.hour_pillar];
    const wonkukStems = pillars.map(p => p.charAt(0)) as Cheongan[];
    const wonkukBranches = pillars.map(p => p.charAt(1)) as Jiji[];

    const results = calculateFortuneRange(startDate, count, dayMaster, wonkukStems, wonkukBranches);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await pool.end();
  }
};

// CLI 진입점
const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isCLI) {
  runCLI().catch((err: unknown) => {
    console.error('[saju-calendar] 오류:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
