import { describe, it, expect } from 'vitest';

import { getCalendarRange } from '../use-calendar-navigation';

// 기준 날짜는 로컬 생성자(new Date(y, m, d))로 만든다 — 함수가 로컬 시각으로 계산하므로
// 이렇게 해야 TZ와 무관하게 같은 달력 날짜를 넘긴다.

describe('getCalendarRange — month', () => {
  it('월 보기는 1일이 속한 주의 월요일부터 말일이 속한 주의 일요일까지', () => {
    // 2026-04-01은 수요일, 04-30은 목요일
    expect(getCalendarRange('month', new Date(2026, 3, 15))).toEqual({
      from: '2026-03-30',
      to: '2026-05-03',
    });
  });

  it('1일이 일요일인 달은 앞 주 월요일부터 잡는다', () => {
    // 2026-03-01은 일요일
    expect(getCalendarRange('month', new Date(2026, 2, 10))).toEqual({
      from: '2026-02-23',
      to: '2026-04-05',
    });
  });

  it('1일이 월요일이고 말일이 일요일인 달은 그 달 안에서 끝난다', () => {
    // 2027-02-01은 월요일, 02-28은 일요일
    expect(getCalendarRange('month', new Date(2027, 1, 14))).toEqual({
      from: '2027-02-01',
      to: '2027-02-28',
    });
  });
});

describe('getCalendarRange — week', () => {
  it('주 보기는 월요일부터 일요일까지', () => {
    // 2026-11-25는 수요일
    expect(getCalendarRange('week', new Date(2026, 10, 25))).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  it('일요일은 그 주의 마지막 날로 묶인다 (다음 주 시작이 아님)', () => {
    // 2026-11-29는 일요일
    expect(getCalendarRange('week', new Date(2026, 10, 29))).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  it('연도 경계에 걸친 주는 전년도 월요일부터 다음 해 일요일까지', () => {
    // 2027-01-01은 금요일
    expect(getCalendarRange('week', new Date(2027, 0, 1))).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
  });
});

describe('getCalendarRange — day', () => {
  it('일 보기는 from과 to가 같은 날', () => {
    expect(getCalendarRange('day', new Date(2026, 11, 31))).toEqual({
      from: '2026-12-31',
      to: '2026-12-31',
    });
  });
});
