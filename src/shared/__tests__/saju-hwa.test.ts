import { describe, it, expect } from 'vitest';
import { makePillar, type PillarSet } from '../saju-calendar.js';
import { detectHwaTransforms, elementToSipsinGroup } from '../saju-hwa.js';
import { SAJU_HWA_PARAMS } from '../saju-strength-params.js';

// 모든 fixture는 추상 조합(개인 원국 아님). 일간은 경(금)으로 고정해 합이 일간에 닿지 않게 분리.

// 갑기합토 — 화신(토) 통근 충족(진/축 본기 토). 일간 경 무관. 다른 합 없음.
const HAP_ROOTED: PillarSet = {
  wonguk: [
    makePillar('갑', '진'),
    makePillar('기', '축'),
    makePillar('경', '신'),
    makePillar('임', '오'),
  ],
  daeun: null,
  seun: makePillar('무', '축'),
  wolun: makePillar('무', '축'),
  ilun: makePillar('무', '축'),
};

// 무계합화 — 화신(화) 통근 미충족(자/묘/신/해 — 화 뿌리 없음). 일간 경 무관.
const HUA_NO_ROOT: PillarSet = {
  wonguk: [
    makePillar('무', '자'),
    makePillar('계', '묘'),
    makePillar('경', '신'),
    makePillar('임', '해'),
  ],
  daeun: null,
  seun: makePillar('경', '묘'),
  wolun: makePillar('임', '신'),
  ilun: makePillar('경', '자'),
};

// 묘술육합화 — 묘유충으로 합 깨짐(충개합). 화신(화)은 오 본기로 통근. 일간 경 무관.
const YUKHAP_CHUNG: PillarSet = {
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

// 묘술육합화 — 충 없음, 화신(화) 통근(오 본기). 정상 성립.
const YUKHAP_OK: PillarSet = {
  wonguk: [
    makePillar('갑', '묘'),
    makePillar('병', '술'),
    makePillar('경', '신'),
    makePillar('무', '오'),
  ],
  daeun: null,
  seun: makePillar('무', '축'),
  wolun: makePillar('무', '축'),
  ilun: makePillar('무', '축'),
};

// 갑기합토 — 단, 갑이 일간(day pillar stem). 일간 변질 예외로 v1 보수적 불변.
const DAYMASTER_HAP: PillarSet = {
  wonguk: [
    makePillar('기', '진'),
    makePillar('무', '축'),
    makePillar('갑', '신'),
    makePillar('경', '묘'),
  ],
  daeun: null,
  seun: makePillar('무', '축'),
  wolun: makePillar('무', '축'),
  ilun: makePillar('무', '축'),
};

describe('detectHwaTransforms — 천간합 통근 게이트', () => {
  it('화신 통근 충족 → 합화 성립 (천간 2글자 변환)', () => {
    const r = detectHwaTransforms(HAP_ROOTED, SAJU_HWA_PARAMS);
    expect(r.transforms).toHaveLength(1);
    expect(r.transforms[0]?.element).toBe('토');
    expect(r.transforms[0]?.slot).toBe('cheongan');
    expect(r.stemOverride.size).toBe(2);
  });

  it('화신 통근 미충족 → 합화 불성립 (기본 HWA_REQUIRE_ROOT)', () => {
    const r = detectHwaTransforms(HUA_NO_ROOT, SAJU_HWA_PARAMS);
    expect(r.transforms).toHaveLength(0);
  });

  it('HWA_REQUIRE_ROOT=false면 통근 무시하고 성립', () => {
    const r = detectHwaTransforms(HUA_NO_ROOT, { ...SAJU_HWA_PARAMS, HWA_REQUIRE_ROOT: false });
    expect(r.transforms).toHaveLength(1);
    expect(r.transforms[0]?.element).toBe('화');
  });
});

describe('detectHwaTransforms — 충개합', () => {
  it('합 멤버가 충당하면 합 무효 (기본 HWA_CHUNGGAEHAP)', () => {
    const r = detectHwaTransforms(YUKHAP_CHUNG, SAJU_HWA_PARAMS);
    expect(r.transforms).toHaveLength(0);
  });

  it('HWA_CHUNGGAEHAP=false면 충 무시하고 합화 성립', () => {
    const r = detectHwaTransforms(YUKHAP_CHUNG, { ...SAJU_HWA_PARAMS, HWA_CHUNGGAEHAP: false });
    expect(r.transforms).toHaveLength(1);
    expect(r.transforms[0]?.element).toBe('화');
  });

  it('충 없는 육합은 정상 성립 (지지 본기 2글자 변환)', () => {
    const r = detectHwaTransforms(YUKHAP_OK, SAJU_HWA_PARAMS);
    expect(r.transforms).toHaveLength(1);
    expect(r.transforms[0]?.element).toBe('화');
    expect(r.branchOverride.size).toBe(2);
  });
});

describe('detectHwaTransforms — 일간 예외', () => {
  it('합이 일간에 닿으면 v1 보수적 불변 (기본)', () => {
    const r = detectHwaTransforms(DAYMASTER_HAP, SAJU_HWA_PARAMS);
    expect(r.transforms).toHaveLength(0);
  });

  it('HWA_DAYMASTER_TRANSFORM=true면 일간 합도 변환', () => {
    const r = detectHwaTransforms(DAYMASTER_HAP, {
      ...SAJU_HWA_PARAMS,
      HWA_DAYMASTER_TRANSFORM: true,
    });
    expect(r.transforms).toHaveLength(1);
    expect(r.transforms[0]?.element).toBe('토');
  });
});

describe('detectHwaTransforms — 결정론', () => {
  it('같은 입력 → 같은 출력 (SET 리플레이 불변)', () => {
    const a = detectHwaTransforms(HAP_ROOTED, SAJU_HWA_PARAMS);
    const b = detectHwaTransforms(HAP_ROOTED, SAJU_HWA_PARAMS);
    expect(a.transforms).toEqual(b.transforms);
  });
});

describe('깊은 상호작용 노브 — 기본 off (헌장 ④)', () => {
  it('탐합망충·쟁합·형파·거리 노브가 전부 false', () => {
    expect(SAJU_HWA_PARAMS.HWA_TAMHAP_MANGCHUNG).toBe(false);
    expect(SAJU_HWA_PARAMS.HWA_JAENGHAP).toBe(false);
    expect(SAJU_HWA_PARAMS.HWA_HYUNGPA_BREAK).toBe(false);
    expect(SAJU_HWA_PARAMS.HWA_DISTANCE).toBe(false);
  });
});

describe('elementToSipsinGroup — 일간 대비 5그룹 십성', () => {
  it('같은 오행 → 비겁', () => {
    expect(elementToSipsinGroup('금', '금')).toBe('비겁');
  });
  it('일간이 생하는 오행 → 식상 (금생수)', () => {
    expect(elementToSipsinGroup('금', '수')).toBe('식상');
  });
  it('일간이 극하는 오행 → 재성 (금극목)', () => {
    expect(elementToSipsinGroup('금', '목')).toBe('재성');
  });
  it('일간을 극하는 오행 → 관성 (화극금)', () => {
    expect(elementToSipsinGroup('금', '화')).toBe('관성');
  });
  it('일간을 생하는 오행 → 인성 (토생금)', () => {
    expect(elementToSipsinGroup('금', '토')).toBe('인성');
  });
});
