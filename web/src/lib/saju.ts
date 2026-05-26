/**
 * 사주 일주 계산 (web용 복제본).
 * 원본: src/shared/saju-calendar.ts (봇 사용).
 * 동기화 대상: getDayPillar 알고리즘 + 천간/지지 상수.
 * 변경 시 양쪽 모두 갱신할 것 (ADR-0021 참조).
 */

export type Cheongan = '갑' | '을' | '병' | '정' | '무' | '기' | '경' | '신' | '임' | '계';
export type Jiji =
  | '자'
  | '축'
  | '인'
  | '묘'
  | '진'
  | '사'
  | '오'
  | '미'
  | '신'
  | '유'
  | '술'
  | '해';

export interface Pillar {
  index: number;
  hanja: string;
  hangul: string;
  cheongan: Cheongan;
  jiji: Jiji;
}

const CHEONGAN_LIST: readonly Cheongan[] = [
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
const JIJI_LIST: readonly Jiji[] = [
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
const CHEONGAN_HANJA: readonly string[] = [
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
const JIJI_HANJA: readonly string[] = [
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

const parseDate = (dateStr: string): Date => new Date(`${dateStr}T12:00:00+09:00`);

const daysDiff = (a: string, b: string): number => {
  const msPerDay = 86_400_000;
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / msPerDay);
};

const indexToPillar = (idx: number): Pillar => {
  const i = ((idx % 60) + 60) % 60;
  const cIdx = i % 10;
  const jIdx = i % 12;
  return {
    index: i,
    hanja: `${CHEONGAN_HANJA[cIdx]}${JIJI_HANJA[jIdx]}`,
    hangul: `${CHEONGAN_LIST[cIdx]}${JIJI_LIST[jIdx]}`,
    cheongan: CHEONGAN_LIST[cIdx]!,
    jiji: JIJI_LIST[jIdx]!,
  };
};

/** 일주(日柱) 계산. 기준: 2024-02-04 = 戊戌(index 34). */
export const getDayPillar = (dateStr: string): Pillar => {
  const REF_DATE = '2024-02-04';
  const REF_INDEX = 34;
  const diff = daysDiff(dateStr, REF_DATE);
  return indexToPillar(REF_INDEX + diff);
};
