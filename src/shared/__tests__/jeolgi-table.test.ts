import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  JEOLGI_TABLE,
  JEOLGI_JIJI,
  JEOLGI_MONTH_OFFSET,
  JEOLGI_FIRST_YEAR,
  JEOLGI_LAST_YEAR,
  warnIfJeolgiTableExpiring,
  __resetJeolgiExpiryWarningForTest,
} from '../saju/jeolgi-table.js';
import { JIJI_LIST } from '../saju/tables.js';

// 손으로 넣은 표라 오타 하나가 조용히 틀린 월주를 만든다 → 표 자체의 형식·범위 불변식을 고정.
// 2034 throw(ADR-0050)는 saju-calendar.test.ts가 이미 확인한다.

const YEARS = Object.keys(JEOLGI_TABLE)
  .map(Number)
  .sort((a, b) => a - b);

describe('JEOLGI_TABLE 데이터 무결성', () => {
  it('2024~2033 10개 연도가 빠짐없이 들어 있다', () => {
    expect(YEARS).toEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
  });

  it('연도마다 절기 12개', () => {
    for (const y of YEARS) {
      expect(JEOLGI_TABLE[y], `${y}년`).toHaveLength(12);
    }
  });

  it('모든 항목이 MM-DD 형식이고 월은 index+1', () => {
    for (const y of YEARS) {
      JEOLGI_TABLE[y].forEach((mmdd, i) => {
        expect(mmdd, `${y}년 index ${i}`).toMatch(/^\d{2}-\d{2}$/);
        expect(Number(mmdd.slice(0, 2)), `${y}년 index ${i}`).toBe(i + 1);
      });
    }
  });

  it('일은 3~9 범위 (월 전환 절기는 매달 3~9일에 온다)', () => {
    for (const y of YEARS) {
      JEOLGI_TABLE[y].forEach((mmdd, i) => {
        const day = Number(mmdd.slice(3));
        expect(day, `${y}년 index ${i} = ${mmdd}`).toBeGreaterThanOrEqual(3);
        expect(day, `${y}년 index ${i} = ${mmdd}`).toBeLessThanOrEqual(9);
      });
    }
  });

  it('같은 절기의 날짜는 인접 연도와 1일 넘게 차이 나지 않는다', () => {
    // 절기 시각은 해마다 약 6시간씩 밀리다 윤년에 되돌아오므로 인접 연도 차이는 최대 1일.
    // 3~9 범위 안의 오타(예: 05-05 → 05-07)를 잡는다.
    for (let i = 0; i < 12; i++) {
      for (let k = 1; k < YEARS.length; k++) {
        const prev = Number(JEOLGI_TABLE[YEARS[k - 1]][i].slice(3));
        const cur = Number(JEOLGI_TABLE[YEARS[k]][i].slice(3));
        expect(Math.abs(cur - prev), `index ${i}: ${YEARS[k - 1]}→${YEARS[k]}`).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });
});

describe('JEOLGI_JIJI / JEOLGI_MONTH_OFFSET 정합', () => {
  it('월지는 소한=축부터 지지 순서대로 한 칸씩 이어진다', () => {
    expect(JEOLGI_JIJI).toHaveLength(12);
    JEOLGI_JIJI.forEach((jiji, i) => {
      expect(jiji, `index ${i}`).toBe(JIJI_LIST[(i + 1) % 12]);
    });
  });

  it('월 offset은 인월=0 기준으로 월지와 맞물린다 (축=11, 인=0, 자=10)', () => {
    expect(JEOLGI_MONTH_OFFSET).toHaveLength(12);
    JEOLGI_JIJI.forEach((jiji, i) => {
      const fromIn = (JIJI_LIST.indexOf(jiji) - JIJI_LIST.indexOf('인') + 12) % 12;
      expect(JEOLGI_MONTH_OFFSET[i], `index ${i} (${jiji})`).toBe(fromIn);
    });
  });
});

describe('절기 표 지원 범위', () => {
  it('첫·마지막 연도 상수가 표의 실제 연도와 같다', () => {
    expect(JEOLGI_FIRST_YEAR).toBe(YEARS[0]);
    expect(JEOLGI_LAST_YEAR).toBe(YEARS[YEARS.length - 1]);
  });
});

describe('warnIfJeolgiTableExpiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetJeolgiExpiryWarningForTest();
  });

  it('마지막 연도 2년 전까지는 경고하지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(warnIfJeolgiTableExpiring(JEOLGI_LAST_YEAR - 2)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('마지막 연도 1년 전부터 경고하고, 만료 시점을 알린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(warnIfJeolgiTableExpiring(JEOLGI_LAST_YEAR - 1)).toBe(true);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`${JEOLGI_LAST_YEAR + 1}-01`);
  });

  it('프로세스당 한 번만 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnIfJeolgiTableExpiring(JEOLGI_LAST_YEAR);
    expect(warnIfJeolgiTableExpiring(JEOLGI_LAST_YEAR + 1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
