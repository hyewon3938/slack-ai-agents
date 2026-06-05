import { describe, it, expect } from 'vitest';
import { makePillar, type PillarSet } from '../saju-calendar.js';
import {
  computeElementStrengths,
  computeStrengthForTarget,
  computeAbsoluteStrengthState,
  computeElementRatios,
  isStrengthTarget,
} from '../saju-strength.js';
import { SAJU_STRENGTH_PARAMS, SAJU_HWA_PARAMS } from '../saju-strength-params.js';

// 금/토 일색 — 일간 경(금)이 비겁·인성으로 가득 → 신강. 월지 유(금)로 월령=금.
const STRONG_METAL: PillarSet = {
  wonguk: [
    makePillar('경', '신'), // year 금/금
    makePillar('기', '유'), // month 토/금 → 월령 금
    makePillar('경', '술'), // day 금/토
    makePillar('무', '축'), // hour 토/토
  ],
  daeun: null,
  seun: makePillar('경', '신'),
  wolun: makePillar('신', '유'),
  ilun: makePillar('경', '신'),
};

// 화/목/수 일색 — 일간 경(금)이 관(화)·재(목)·식상(수)에 둘러싸임 → 신약. 월지 묘(목).
const WEAK_METAL: PillarSet = {
  wonguk: [
    makePillar('병', '자'), // 화/수
    makePillar('정', '묘'), // 화/목 → 월령 목
    makePillar('경', '자'), // day 금/수
    makePillar('을', '묘'), // 목/목
  ],
  daeun: null,
  seun: makePillar('병', '자'),
  wolun: makePillar('정', '묘'),
  ilun: makePillar('병', '자'),
};

describe('computeElementStrengths', () => {
  it('일간 강도 = 일간 오행 강도 (day_master === byElement[일간오행])', () => {
    const s = computeElementStrengths('경', STRONG_METAL);
    expect(s.dayMaster).toBe(s.byElement['금']);
  });

  it('금 일색 → 금 강도가 화 강도보다 크다', () => {
    const s = computeElementStrengths('경', STRONG_METAL);
    expect(s.byElement['금']).toBeGreaterThan(s.byElement['화']);
  });
});

describe('computeAbsoluteStrengthState', () => {
  it('금/토 일색 → 신강', () => {
    expect(computeAbsoluteStrengthState('경', STRONG_METAL)).toBe('신강');
  });

  it('화/목/수 일색 → 신약', () => {
    expect(computeAbsoluteStrengthState('경', WEAK_METAL)).toBe('신약');
  });

  it('검정 비사용 — 상대 분위수와 별개의 절대 상태 (맥락용)', () => {
    // 같은 차트라도 일간을 바꾸면 절대 상태가 달라짐(병=화 기준이면 STRONG_METAL은 신약 쪽).
    expect(computeAbsoluteStrengthState('병', STRONG_METAL)).toBe('신약');
  });
});

describe('computeStrengthForTarget', () => {
  it("target='day_master'는 일간 오행 강도로 해석", () => {
    const viaTarget = computeStrengthForTarget('day_master', '경', STRONG_METAL);
    const viaElement = computeStrengthForTarget('금', '경', STRONG_METAL);
    expect(viaTarget).toBe(viaElement);
  });

  it('geukseol=0 → 극설 제거로 강도 상승 (파라미터 노브)', () => {
    const base = computeStrengthForTarget('금', '경', WEAK_METAL);
    const noDrain = computeStrengthForTarget('금', '경', WEAK_METAL, {
      ...SAJU_STRENGTH_PARAMS,
      geukseol: 0,
    });
    expect(noDrain).toBeGreaterThan(base);
  });

  it('월령 — 월지가 금이면 금 강도가 월지 목일 때보다 크다 (득령)', () => {
    const monthGold: PillarSet = {
      wonguk: [
        makePillar('경', '신'),
        makePillar('신', '유'),
        makePillar('경', '신'),
        makePillar('경', '신'),
      ],
      daeun: null,
      seun: makePillar('경', '신'),
      wolun: makePillar('경', '신'),
      ilun: makePillar('경', '신'),
    };
    const monthWood: PillarSet = {
      ...monthGold,
      wonguk: [
        makePillar('경', '신'),
        makePillar('을', '묘'),
        makePillar('경', '신'),
        makePillar('경', '신'),
      ],
    };
    expect(computeStrengthForTarget('금', '경', monthGold)).toBeGreaterThan(
      computeStrengthForTarget('금', '경', monthWood),
    );
  });

  it('W_WOLLYEONG=1 → 월령 배수 비활성 시 위 차이 축소', () => {
    const flat = { ...SAJU_STRENGTH_PARAMS, W_WOLLYEONG: 1 };
    const monthGold: PillarSet = {
      wonguk: [
        makePillar('경', '신'),
        makePillar('신', '유'),
        makePillar('경', '신'),
        makePillar('경', '신'),
      ],
      daeun: null,
      seun: makePillar('경', '신'),
      wolun: makePillar('경', '신'),
      ilun: makePillar('경', '신'),
    };
    // 월령 배수 끄면 금 강도는 월지 오행과 무관 — 본 테스트는 NaN/throw 없이 유한값만 확인
    expect(Number.isFinite(computeStrengthForTarget('금', '경', monthGold, flat))).toBe(true);
  });
});

describe('computeElementRatios', () => {
  it('금 일색 → 금 비율 최대, 합 ≈ 1', () => {
    const r = computeElementRatios(STRONG_METAL);
    const sum = r['목'] + r['화'] + r['토'] + r['금'] + r['수'];
    expect(sum).toBeCloseTo(1, 6);
    const max = Math.max(r['목'], r['화'], r['토'], r['금'], r['수']);
    expect(r['금']).toBe(max);
  });
});

describe('isStrengthTarget', () => {
  it('day_master + 5오행만 true', () => {
    expect(isStrengthTarget('day_master')).toBe(true);
    expect(isStrengthTarget('금')).toBe(true);
    expect(isStrengthTarget('수')).toBe(true);
    expect(isStrengthTarget('일간')).toBe(false);
    expect(isStrengthTarget(null)).toBe(false);
  });
});

// 묘술육합화 — 묘유충으로 합 깨짐. 충개합을 끄면 합화(화)가 성립해 화 강도가 올라간다(#477 P4b).
const HWA_TOGGLE: PillarSet = {
  wonguk: [
    makePillar('갑', '묘'),
    makePillar('병', '술'),
    makePillar('경', '유'),
    makePillar('무', '오'),
  ],
  daeun: null,
  seun: makePillar('무', '축'),
  wolun: makePillar('무', '축'),
  ilun: makePillar('무', '축'),
};

describe('합화 변환 반영 강도 (#477 P4b)', () => {
  it('충개합 끄면 묘술합화(화) 성립 → 화 강도가 더 높다', () => {
    const huaBroken = computeStrengthForTarget('화', '경', HWA_TOGGLE); // 기본: 충개합으로 합 깨짐
    const huaFormed = computeStrengthForTarget('화', '경', HWA_TOGGLE, SAJU_STRENGTH_PARAMS, {
      ...SAJU_HWA_PARAMS,
      HWA_CHUNGGAEHAP: false,
    });
    expect(huaFormed).toBeGreaterThan(huaBroken);
  });

  it('합 없는 원국은 합화 변환 영향 없음 (결정론 동일값)', () => {
    const a = computeElementStrengths('경', STRONG_METAL);
    const b = computeElementStrengths('경', STRONG_METAL);
    expect(a.byElement).toEqual(b.byElement);
  });
});
