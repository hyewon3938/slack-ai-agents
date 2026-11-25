import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FIRST_HOLIDAY_DATA_YEAR,
  KOREAN_HOLIDAYS,
  LAST_HOLIDAY_DATA_YEAR,
  isKoreanHoliday,
} from '../korean-holidays.js';

const yearsInData = (): number[] => [...KOREAN_HOLIDAYS].map((d) => Number(d.slice(0, 4)));

describe('KOREAN_HOLIDAYS 데이터 범위', () => {
  // 이 테스트가 드러내는 값이 갱신 시한이다: 2028-01-01부터 공휴일 신호가 전부 false가 되므로
  // 2027년 안에 2028년 공휴일(월력요항)을 추가하고 이 값을 올린다.
  it('공휴일 데이터가 있는 마지막 연도는 2027년', () => {
    expect(LAST_HOLIDAY_DATA_YEAR).toBe(2027);
  });

  it('범위 상수가 실제 데이터의 첫·마지막 연도와 같다', () => {
    expect(Math.min(...yearsInData())).toBe(FIRST_HOLIDAY_DATA_YEAR);
    expect(Math.max(...yearsInData())).toBe(LAST_HOLIDAY_DATA_YEAR);
  });

  it('범위 안 모든 연도에 신정·성탄절이 들어 있다 (연도 누락 방지)', () => {
    for (let y = FIRST_HOLIDAY_DATA_YEAR; y <= LAST_HOLIDAY_DATA_YEAR; y += 1) {
      expect(KOREAN_HOLIDAYS.has(`${y}-01-01`)).toBe(true);
      expect(KOREAN_HOLIDAYS.has(`${y}-12-25`)).toBe(true);
    }
  });

  it('모든 항목이 YYYY-MM-DD 형식이고 실제 존재하는 날짜다', () => {
    for (const d of KOREAN_HOLIDAYS) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d);
    }
  });
});

describe('isKoreanHoliday - 2026년', () => {
  // 2027년과 같은 기준(대체공휴일·선거일·노동절·제헌절 포함)인지 고정한다.
  it.each([
    ['2026-02-17', '설날'],
    ['2026-03-02', '삼일절 대체공휴일'],
    ['2026-05-01', '노동절'],
    ['2026-05-25', '부처님오신날 대체공휴일'],
    ['2026-06-03', '전국동시지방선거일'],
    ['2026-07-17', '제헌절'],
    ['2026-08-17', '광복절 대체공휴일'],
    ['2026-10-05', '개천절 대체공휴일'],
  ])('%s(%s)은 공휴일', (date) => {
    expect(isKoreanHoliday(date)).toBe(true);
  });

  it('추석 연휴가 토요일과 겹쳐도 설·추석은 일요일만 대체하므로 9-28은 평일', () => {
    expect(isKoreanHoliday('2026-09-28')).toBe(false);
  });
});

describe('isKoreanHoliday - 2027년', () => {
  it.each([
    ['2027-02-07', '설날'],
    ['2027-02-09', '설날 대체공휴일'],
    ['2027-05-01', '노동절'],
    ['2027-05-13', '부처님오신날'],
    ['2027-07-17', '제헌절'],
    ['2027-09-15', '추석'],
    ['2027-10-11', '한글날 대체공휴일'],
    ['2027-12-27', '성탄절 대체공휴일'],
  ])('%s(%s)은 공휴일', (date) => {
    expect(isKoreanHoliday(date)).toBe(true);
  });

  it('2027년 평일은 false', () => {
    expect(isKoreanHoliday('2027-06-15')).toBe(false);
  });
});

describe('isKoreanHoliday - 데이터 없는 연도 경고', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('데이터 범위 밖 연도는 false를 돌려주고 연도마다 한 번만 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(isKoreanHoliday('2030-01-01')).toBe(false);
    expect(isKoreanHoliday('2030-05-05')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('2030년');
  });

  it('데이터 범위 안 연도의 평일은 경고하지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(isKoreanHoliday('2027-06-15')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
