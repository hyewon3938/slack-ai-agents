/** 만세력 타입 정의. */

// ─── 타입 ───────────────────────────────────────────────

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
export type Sipsung =
  | '비견'
  | '겁재'
  | '식신'
  | '상관'
  | '편재'
  | '정재'
  | '편관'
  | '정관'
  | '편인'
  | '정인';
export type Sibiunsung =
  | '장생'
  | '목욕'
  | '관대'
  | '건록'
  | '제왕'
  | '쇠'
  | '병'
  | '사'
  | '묘'
  | '절'
  | '태'
  | '양';

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

export interface JijangganEntry {
  yeogi: number; // 여기 (잔기) — cheongan index
  junggi?: number; // 중기 — 자/묘/유는 없음
  jeonggi: number; // 정기 (본기) — cheongan index
}

export interface Relations {
  cheonganHap: string[];
  jijiChung: string[];
  jijiHap: string[];
  jijiHyung: string[];
  jijipa: string[];
  jijiHae: string[];
  amhap: string[];
}

export interface DailyFortuneData {
  date: string;
  dayPillar: Pillar;
  monthPillar: Pillar;
  yearPillar: Pillar;
  sipsung: SipsungResult;
  sibiunsung: Sibiunsung;
  relations: Relations;
  jijanggan: {
    day: { yeogi: string; junggi?: string; jeonggi: string };
  };
}

// ─── Phase 2.5: 운 레벨 + 누적 카운트 ────────────────────

export type Element = '목' | '화' | '토' | '금' | '수';

/** 5개 운 레벨의 pillar 집합 (원국 4 + 대운/세운/월운/일운 각 1) */
export interface PillarSet {
  /** 원국 4주 (year/month/day/hour 순) */
  wonguk: readonly Pillar[];
  /** 대운 1주 (대운 적용 구간 외 또는 미정의 시 null) */
  daeun: Pillar | null;
  /** 세운 1주 (= target date의 year pillar) */
  seun: Pillar;
  /** 월운 1주 (= target date의 month pillar) */
  wolun: Pillar;
  /** 일운 1주 (= target date의 day pillar) */
  ilun: Pillar;
}
