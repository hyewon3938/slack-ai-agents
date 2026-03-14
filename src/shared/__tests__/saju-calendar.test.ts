import { describe, it, expect } from 'vitest';
import {
  getDayPillar,
  getYearPillar,
  getMonthPillar,
  getSipsung,
  getSibiunsung,
  getRelations,
  calculateFortuneRange,
} from '../saju-calendar.js';
import type { Cheongan, Jiji } from '../saju-calendar.js';

// ─── getDayPillar ────────────────────────────────────────

describe('getDayPillar', () => {
  it('기준일 2024-02-04 = 무술(戊戌, index 34)', () => {
    const result = getDayPillar('2024-02-04');
    expect(result.index).toBe(34);
    expect(result.hangul).toBe('무술');
    expect(result.hanja).toBe('戊戌');
    expect(result.cheongan).toBe('무');
    expect(result.jiji).toBe('술');
  });

  it('2026-03-14 = 정해(丁亥, index 23)', () => {
    const result = getDayPillar('2026-03-14');
    expect(result.index).toBe(23);
    expect(result.hangul).toBe('정해');
    expect(result.hanja).toBe('丁亥');
  });

  it('60갑자 순환 — 기준일+60 = 다시 무술', () => {
    const result = getDayPillar('2024-04-04'); // 2024-02-04 + 60일
    expect(result.index).toBe(34);
    expect(result.hangul).toBe('무술');
  });

  it('기준일 이전 날짜도 정상 계산 (음수 모듈로)', () => {
    const result = getDayPillar('2024-02-03'); // index 33 = 정유
    expect(result.index).toBe(33);
    expect(result.hangul).toBe('정유');
  });

  it('연도 경계 연속성', () => {
    const dec31 = getDayPillar('2025-12-31');
    const jan1 = getDayPillar('2026-01-01');
    expect((dec31.index + 1) % 60).toBe(jan1.index);
  });

  it('2024-01-01 일주 계산', () => {
    // 2024-01-01: 2024-02-04까지 34일 차이 (기준에서 -34)
    // (34 - 34 + 60) % 60 = 0 = 갑자
    const result = getDayPillar('2024-01-01');
    expect(result.index).toBe(0);
    expect(result.hangul).toBe('갑자');
  });
});

// ─── getYearPillar ───────────────────────────────────────

describe('getYearPillar', () => {
  it('2026년 (입춘 후) = 병오(丙午)', () => {
    const result = getYearPillar('2026-03-14');
    expect(result.hangul).toBe('병오');
    expect(result.hanja).toBe('丙午');
  });

  it('입춘 전은 전년도 — 2026-02-03 = 을사(乙巳)', () => {
    const result = getYearPillar('2026-02-03');
    expect(result.hangul).toBe('을사');
  });

  it('입춘 당일은 새 해 — 2026-02-04 = 병오(丙午)', () => {
    const result = getYearPillar('2026-02-04');
    expect(result.hangul).toBe('병오');
  });

  it('2025년 입춘(02-03) 당일 = 을사(乙巳)', () => {
    const result = getYearPillar('2025-02-03');
    expect(result.hangul).toBe('을사');
  });

  it('2025-02-02 (입춘 전) = 갑진(甲辰)', () => {
    const result = getYearPillar('2025-02-02');
    expect(result.hangul).toBe('갑진');
  });

  it('2024-02-04 (입춘 당일) = 갑진(甲辰)', () => {
    const result = getYearPillar('2024-02-04');
    expect(result.hangul).toBe('갑진');
  });
});

// ─── getMonthPillar ──────────────────────────────────────

describe('getMonthPillar', () => {
  it('2026-03-14 (경칩 후) = 신묘(辛卯)', () => {
    const result = getMonthPillar('2026-03-14');
    expect(result.hangul).toBe('신묘');
    expect(result.cheongan).toBe('신');
    expect(result.jiji).toBe('묘');
  });

  it('2026-03-04 (경칩 전) = 경인(庚寅)', () => {
    const result = getMonthPillar('2026-03-04');
    expect(result.hangul).toBe('경인');
  });

  it('2026-02-04 (입춘 당일) = 경인(庚寅) — 병오년 인월', () => {
    const result = getMonthPillar('2026-02-04');
    expect(result.hangul).toBe('경인');
  });

  it('2026-02-03 (입춘 전) = 기축(己丑) — 을사년 축월', () => {
    const result = getMonthPillar('2026-02-03');
    expect(result.hangul).toBe('기축');
  });

  it('2026-01-04 (소한 전) = 무자(戊子) — 을사년 자월', () => {
    // 2025년 대설(12-07) 이후, 2026년 소한(01-05) 전
    // 사주년 = 2025 (을사, 천간=을, index=1)
    // 자월 monthOffset = 10
    // inMonthStemIdx = (1%5)*2+2 = 4 → 무(戊)
    // monthStemIdx = (4+10)%10 = 4 → 무(戊)
    // 자월 = 무자(戊子)
    const result = getMonthPillar('2026-01-04');
    expect(result.hangul).toBe('무자');
  });

  it('2026-12-08 (대설 후) = 경자(庚子) — 병오년 자월', () => {
    // 대설 2026-12-07 이후 → 자월
    // 사주년 = 2026 (병오, 천간=병, index=2)
    // 자월 monthOffset = 10
    // inMonthStemIdx = (2%5)*2+2 = 6 → 경(庚)
    // monthStemIdx = (6+10)%10 = 6 → 경(庚)
    // 자월 = 경자(庚子)
    const result = getMonthPillar('2026-12-08');
    expect(result.hangul).toBe('경자');
  });

  it('2025-02-03 (2025 입춘 당일) = 무인(戊寅) — 을사년 인월', () => {
    // 사주년 = 2025 (을사, 천간=을, index=1)
    // 인월 monthOffset = 0
    // inMonthStemIdx = (1%5)*2+2 = 4 → 무(戊)
    // monthStemIdx = (4+0)%10 = 4 → 무(戊)
    // 인월 = 무인(戊寅)
    const result = getMonthPillar('2025-02-03');
    expect(result.hangul).toBe('무인');
  });
});

// ─── getSipsung ──────────────────────────────────────────

describe('getSipsung', () => {
  const dayMaster: Cheongan = '경';

  it('경금 기준 천간 십성', () => {
    expect(getSipsung(dayMaster, '갑')).toBe('편재');
    expect(getSipsung(dayMaster, '을')).toBe('정재');
    expect(getSipsung(dayMaster, '병')).toBe('편관');
    expect(getSipsung(dayMaster, '정')).toBe('정관');
    expect(getSipsung(dayMaster, '무')).toBe('편인');
    expect(getSipsung(dayMaster, '기')).toBe('정인');
    expect(getSipsung(dayMaster, '경')).toBe('비견');
    expect(getSipsung(dayMaster, '신')).toBe('겁재');
    expect(getSipsung(dayMaster, '임')).toBe('식신');
    expect(getSipsung(dayMaster, '계')).toBe('상관');
  });

  it('갑목 기준 천간 십성', () => {
    expect(getSipsung('갑', '갑')).toBe('비견');
    expect(getSipsung('갑', '을')).toBe('겁재');
    expect(getSipsung('갑', '병')).toBe('식신');
    expect(getSipsung('갑', '정')).toBe('상관');
    expect(getSipsung('갑', '무')).toBe('편재');
    expect(getSipsung('갑', '기')).toBe('정재');
    expect(getSipsung('갑', '경')).toBe('편관');
    expect(getSipsung('갑', '신')).toBe('정관');
    expect(getSipsung('갑', '임')).toBe('편인');
    expect(getSipsung('갑', '계')).toBe('정인');
  });
});

// ─── getSibiunsung ───────────────────────────────────────

describe('getSibiunsung', () => {
  it('경금 기준 십이운성', () => {
    expect(getSibiunsung('경', '사')).toBe('장생');
    expect(getSibiunsung('경', '오')).toBe('목욕');
    expect(getSibiunsung('경', '미')).toBe('관대');
    expect(getSibiunsung('경', '신')).toBe('건록');
    expect(getSibiunsung('경', '유')).toBe('제왕');
    expect(getSibiunsung('경', '술')).toBe('쇠');
    expect(getSibiunsung('경', '해')).toBe('병');
    expect(getSibiunsung('경', '자')).toBe('사');
    expect(getSibiunsung('경', '축')).toBe('묘');
    expect(getSibiunsung('경', '인')).toBe('절');
    expect(getSibiunsung('경', '묘')).toBe('태');
    expect(getSibiunsung('경', '진')).toBe('양');
  });

  it('갑목 기준 십이운성 (양간 순행)', () => {
    expect(getSibiunsung('갑', '해')).toBe('장생');
    expect(getSibiunsung('갑', '자')).toBe('목욕');
    expect(getSibiunsung('갑', '축')).toBe('관대');
    expect(getSibiunsung('갑', '인')).toBe('건록');
    expect(getSibiunsung('갑', '묘')).toBe('제왕');
  });
});

// ─── getRelations ────────────────────────────────────────

describe('getRelations', () => {
  // 원국 예시용 (범용 테스트)
  const wonkukStems: readonly Cheongan[] = ['갑', '정', '경', '정'];
  const wonkukBranches: readonly Jiji[] = ['술', '묘', '술', '해'];

  it('천간합 감지 — 정임합', () => {
    const relations = getRelations(wonkukStems, wonkukBranches, '임', '자');
    expect(relations.cheonganHap).toContain('임-정 합(목)');
  });

  it('지지충 감지 — 사해충', () => {
    const relations = getRelations(wonkukStems, wonkukBranches, '기', '사');
    expect(relations.jijiChung).toContain('사-해 충');
  });

  it('관련 없는 날은 빈 배열', () => {
    const relations = getRelations(wonkukStems, wonkukBranches, '경', '신');
    expect(relations.cheonganHap).toHaveLength(0);
    expect(relations.jijiChung).toHaveLength(0);
  });

  it('지지합 감지 — 묘술합(화)', () => {
    // 원국에 묘와 술이 있음. 외부에서 묘 또는 술이 오면 합 가능
    // 하지만 getRelations는 일운 vs 원국을 비교
    // 일운 지지=술이면 원국 묘와 합
    const relations = getRelations(wonkukStems, wonkukBranches, '갑', '술');
    expect(relations.jijiHap.some(s => s.includes('묘') && s.includes('술'))).toBe(true);
  });
});

// ─── calculateFortuneRange ───────────────────────────────

describe('calculateFortuneRange', () => {
  it('7일 범위 계산 — 일주 연속성', () => {
    const dayMaster: Cheongan = '경';
    const wonkukStems: readonly Cheongan[] = ['갑', '정', '경', '정'];
    const wonkukBranches: readonly Jiji[] = ['술', '묘', '술', '해'];

    const results = calculateFortuneRange(
      '2026-03-09', 7, dayMaster, wonkukStems, wonkukBranches,
    );
    expect(results).toHaveLength(7);
    expect(results[0].date).toBe('2026-03-09');
    expect(results[6].date).toBe('2026-03-15');

    // 일주 index 연속성 확인
    for (let i = 1; i < results.length; i++) {
      expect(results[i].dayPillar.index).toBe(
        (results[i - 1].dayPillar.index + 1) % 60,
      );
    }
  });
});
