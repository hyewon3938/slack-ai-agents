/** 간지·오행·십이운성·합충 상수 테이블. */

import type { Cheongan, Jiji, Sibiunsung, JijangganEntry, Element } from './types.js';

// ─── 상수: 천간/지지 ────────────────────────────────────

export const CHEONGAN_LIST: readonly Cheongan[] = [
  '갑',
  '을',
  '병',
  '정',
  '무',
  '기',
  '경',
  '신',
  '임',
  '계',
];
export const JIJI_LIST: readonly Jiji[] = [
  '자',
  '축',
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
];
export const CHEONGAN_HANJA: readonly string[] = [
  '甲',
  '乙',
  '丙',
  '丁',
  '戊',
  '己',
  '庚',
  '辛',
  '壬',
  '癸',
];
export const JIJI_HANJA: readonly string[] = [
  '子',
  '丑',
  '寅',
  '卯',
  '辰',
  '巳',
  '午',
  '未',
  '申',
  '酉',
  '戌',
  '亥',
];

// ─── 상수: 오행 ─────────────────────────────────────────

/** 천간 → 오행 index (0=목, 1=화, 2=토, 3=금, 4=수) */
export const CHEONGAN_ELEMENT: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];

/** 천간 음양 (0=양, 1=음) */
export const CHEONGAN_YINYANG: readonly number[] = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];

/** 지지 → 본기 천간 index */
export const JIJI_BONGI: readonly number[] = [
  // 자=계(9), 축=기(5), 인=갑(0), 묘=을(1), 진=무(4), 사=병(2)
  // 오=정(3), 미=기(5), 신=경(6), 유=신(7), 술=무(4), 해=임(8)
  9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8,
];

/** 지지 → 지장간 (여기/중기/정기) — 천간 index로 표현 */
export const JIJANGGAN: readonly JijangganEntry[] = [
  { yeogi: 8, jeonggi: 9 }, // 자(子): 임(여), 계(정)
  { yeogi: 9, junggi: 7, jeonggi: 5 }, // 축(丑): 계(여), 신(중), 기(정)
  { yeogi: 4, junggi: 2, jeonggi: 0 }, // 인(寅): 무(여), 병(중), 갑(정)
  { yeogi: 0, jeonggi: 1 }, // 묘(卯): 갑(여), 을(정)
  { yeogi: 1, junggi: 9, jeonggi: 4 }, // 진(辰): 을(여), 계(중), 무(정)
  { yeogi: 4, junggi: 6, jeonggi: 2 }, // 사(巳): 무(여), 경(중), 병(정)
  { yeogi: 2, junggi: 5, jeonggi: 3 }, // 오(午): 병(여), 기(중), 정(정)
  { yeogi: 3, junggi: 1, jeonggi: 5 }, // 미(未): 정(여), 을(중), 기(정)
  { yeogi: 4, junggi: 8, jeonggi: 6 }, // 신(申): 무(여), 임(중), 경(정)
  { yeogi: 6, jeonggi: 7 }, // 유(酉): 경(여), 신(정)
  { yeogi: 7, junggi: 3, jeonggi: 4 }, // 술(戌): 신(여), 정(중), 무(정)
  { yeogi: 4, junggi: 0, jeonggi: 8 }, // 해(亥): 무(여), 갑(중), 임(정)
];

// ─── 상수: 십이운성 ──────────────────────────────────────

export const SIBIUNSUNG_CYCLE: readonly Sibiunsung[] = [
  '장생',
  '목욕',
  '관대',
  '건록',
  '제왕',
  '쇠',
  '병',
  '사',
  '묘',
  '절',
  '태',
  '양',
];

/** 양간별 장생 시작 지지 index: 갑=해(11), 병=인(2), 무=인(2), 경=사(5), 임=신(8) */
export const YANG_JANGSEONG_START: Record<number, number> = {
  0: 11, // 갑 → 해
  2: 2, // 병 → 인
  4: 2, // 무 → 인
  6: 5, // 경 → 사
  8: 8, // 임 → 신
};

// ─── 상수: 합충형파해 ───────────────────────────────────

/** 천간합: [a, b, 합화오행] */
export const CHEONGAN_HAP: readonly [number, number, Element][] = [
  [0, 5, '토'], // 갑기합
  [1, 6, '금'], // 을경합
  [2, 7, '수'], // 병신합
  [3, 8, '목'], // 정임합
  [4, 9, '화'], // 무계합
];

/** 지지육충: [a, b] */
export const JIJI_CHUNG: readonly [number, number][] = [
  [0, 6], // 자오충
  [1, 7], // 축미충
  [2, 8], // 인신충
  [3, 9], // 묘유충
  [4, 10], // 진술충
  [5, 11], // 사해충
];

/** 지지육합: [a, b, 합화오행] */
export const JIJI_YUKHAP: readonly [number, number, Element][] = [
  [0, 1, '토'], // 자축합
  [2, 11, '목'], // 인해합
  [3, 10, '화'], // 묘술합
  [4, 9, '금'], // 진유합
  [5, 8, '수'], // 사신합
  [6, 7, '토'], // 오미합
];

/** 지지삼합: [a, b, c, 합화오행] */
export const JIJI_SAMHAP: readonly [number, number, number, Element][] = [
  [8, 0, 4, '수'], // 신자진
  [11, 3, 7, '목'], // 해묘미
  [2, 6, 10, '화'], // 인오술
  [5, 9, 1, '금'], // 사유축
];

/** 지지형: [a, b] (방향성 있는 쌍) */
export const JIJI_HYUNG: readonly [number, number][] = [
  [2, 5], // 인사형 (삼형)
  [5, 8], // 사신형 (삼형)
  [2, 8], // 인신형 (삼형)
  [1, 10], // 축술형 (삼형)
  [10, 7], // 술미형 (삼형)
  [1, 7], // 축미형 (삼형)
  [0, 3], // 자묘형
  [3, 0], // 묘자형
];

/** 지지파: [a, b] */
export const JIJI_PA: readonly [number, number][] = [
  [0, 9], // 자유파
  [1, 4], // 축진파
  [2, 11], // 인해파
  [3, 6], // 묘오파
  [5, 8], // 사신파
  [10, 7], // 술미파
];

/** 지지해: [a, b] */
export const JIJI_HAE: readonly [number, number][] = [
  [0, 7], // 자미해
  [1, 6], // 축오해
  [2, 5], // 인사해
  [3, 4], // 묘진해
  [8, 11], // 신해해
  [9, 10], // 유술해
];

// ─── 합/충 규칙 (문자 기반, 외부 결정론 엔진용) ───────────
// index 기반 상수(CHEONGAN_HAP/JIJI_*)를 단일 출처로 두고 문자 기반으로 파생.
// hwa.ts(합화 변환 탐지)가 합화오행·충 쌍을 글자 단위로 소비 (#477 P4b).

/** 천간합 규칙: 두 천간 → 합화오행 */
export interface StemHapRule {
  stems: readonly [Cheongan, Cheongan];
  element: Element;
}
/** 지지합 규칙: 구성 지지 → 합화오행 (육합 2지 / 삼합 3지) */
export interface BranchHapRule {
  branches: readonly Jiji[];
  element: Element;
}

export const CHEONGAN_HAP_RULES: readonly StemHapRule[] = CHEONGAN_HAP.map(([a, b, element]) => ({
  stems: [CHEONGAN_LIST[a], CHEONGAN_LIST[b]] as const,
  element,
}));

export const JIJI_YUKHAP_RULES: readonly BranchHapRule[] = JIJI_YUKHAP.map(([a, b, element]) => ({
  branches: [JIJI_LIST[a], JIJI_LIST[b]],
  element,
}));

export const JIJI_SAMHAP_RULES: readonly BranchHapRule[] = JIJI_SAMHAP.map(
  ([a, b, c, element]) => ({
    branches: [JIJI_LIST[a], JIJI_LIST[b], JIJI_LIST[c]],
    element,
  }),
);

/** 지지육충 쌍 (문자 기반) — 충개합 판정용. */
export const JIJI_CHUNG_PAIRS: readonly (readonly [Jiji, Jiji])[] = JIJI_CHUNG.map(([a, b]) => [
  JIJI_LIST[a],
  JIJI_LIST[b],
]);
