import { describe, it, expect } from 'vitest';
import type { SajuSeedWithMetrics } from '../match-types.js';
import type { SignalSeriesResult } from '../series.js';
import type { ContingencyVerification, DaySeries, SignalDef } from '../types.js';
import {
  type ActiveLinkRow,
  type LinkInterimDeps,
  buildLinkInterim,
  finalizeVerifications,
} from '../verify-link-calc.js';

// ─── fixtures ────────────────────────────────────────────

type Interim = Parameters<typeof finalizeVerifications>[0][number];

const DATES = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'];

const makeSeed = (over: Partial<SajuSeedWithMetrics> = {}): SajuSeedWithMetrics => ({
  id: 1,
  user_id: 1,
  name: 'test_seed',
  sipsin: null,
  description: '테스트 시드',
  trigger_target_type: 'stem',
  trigger_target_id: null,
  trigger_aux: null,
  pillar_level: null,
  active: true,
  source: 'seed',
  metrics: [],
  ...over,
});

const makeSignal = (over: Partial<SignalDef> = {}): SignalDef => ({
  id: 10,
  name: 'test_signal',
  kind: 'sql',
  source: 'seed',
  sqlBody: 'SELECT 1',
  valueType: 'binary',
  direction: 'above_abs',
  threshold: 1,
  tagName: null,
  windowDays: null,
  domain: 'sleep',
  ...over,
});

const makeRow = (over: Partial<ActiveLinkRow> = {}): ActiveLinkRow => ({
  link_id: 100,
  seed_id: 1,
  signal_id: 10,
  status: 'active',
  source: 'manual',
  created_date: null,
  ...over,
});

/** 날짜 배열과 같은 길이의 값 배열 → 날짜 키 Map. */
const byDate = <T>(dates: string[], values: T[]): Map<string, T> =>
  new Map(dates.map((d, i) => [d, values[i] as T]));

interface DepsOptions {
  seed?: SajuSeedWithMetrics;
  signal?: SignalDef;
  activation?: boolean[];
  pass?: Array<boolean | null>;
  raw?: Array<number | null> | null;
  signalStart?: string | null;
  dataStarts?: LinkInterimDeps['dataStarts'];
  dates?: string[];
}

const makeDeps = (opts: DepsOptions = {}): LinkInterimDeps => {
  const dates = opts.dates ?? DATES;
  const seed = opts.seed ?? makeSeed();
  const signal = opts.signal ?? makeSignal();
  const activation = byDate(dates, opts.activation ?? dates.map((_, i) => i % 2 === 0));
  const series: DaySeries = byDate(dates, opts.pass ?? dates.map(() => true));
  const raw = opts.raw ? byDate(dates, opts.raw) : null;
  const signalSeries: SignalSeriesResult = { series, raw };
  return {
    signalById: new Map([[signal.id, signal]]),
    seedById: new Map([[seed.id, seed]]),
    seedSeriesById: new Map([[seed.id, activation]]),
    signalSeriesById: new Map([[signal.id, signalSeries]]),
    signalStartById: new Map([[signal.id, opts.signalStart ?? null]]),
    dataStarts: opts.dataStarts ?? { byTable: new Map(), global: null },
    windowDates: dates,
  };
};

// ─── buildLinkInterim ────────────────────────────────────

describe('buildLinkInterim — 부품 누락', () => {
  it.each([
    ['신호 정의', 'signalById'],
    ['시드', 'seedById'],
    ['시드 활성 시리즈', 'seedSeriesById'],
    ['신호 시리즈', 'signalSeriesById'],
  ] as const)('%s가 없으면 null을 돌려준다', (_label, key) => {
    const deps = makeDeps();
    deps[key].clear();
    expect(buildLinkInterim(makeRow(), deps)).toBeNull();
  });
});

describe('buildLinkInterim — 검정 윈도우 시작일', () => {
  it('시드 시작·신호 시작·등록 익일 중 가장 늦은 날을 쓴다', () => {
    // 사주 시드 = global floor(01-02), 신호 = 01-03, 발굴 링크 등록 01-04 → 익일 01-05.
    const interim = buildLinkInterim(
      makeRow({ source: 'discovery', created_date: '2026-01-04' }),
      makeDeps({ signalStart: '2026-01-03', dataStarts: { byTable: new Map(), global: '2026-01-02' } }),
    );
    expect(interim?.windowStart).toBe('2026-01-05');
  });

  it('life_signal 시드는 의존 도메인 첫 기록일이 가장 늦으면 그 날을 쓴다', () => {
    const seed = makeSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: { kind: 'threshold', source: 'sleep_minutes' },
    });
    const interim = buildLinkInterim(
      makeRow(),
      makeDeps({
        seed,
        signalStart: '2026-01-02',
        dataStarts: { byTable: new Map([['sleep_records', '2026-01-04']]), global: '2026-01-01' },
      }),
    );
    expect(interim?.windowStart).toBe('2026-01-04');
  });

  it('카탈로그(manual) 링크는 등록일이 있어도 등록 클립을 걸지 않는다', () => {
    const interim = buildLinkInterim(
      makeRow({ source: 'manual', created_date: '2026-01-05' }),
      makeDeps(),
    );
    expect(interim?.windowStart).toBeNull();
  });

  it('윈도우 시작 이전 날은 2×2 집계에서 빠진다', () => {
    // 활성 [T,F,T,F,T,F], 전부 pass. 01-03부터면 03(T)·04(F)·05(T)·06(F)만 남는다.
    const interim = buildLinkInterim(makeRow(), makeDeps({ signalStart: '2026-01-03' }));
    expect(interim?.cont).toEqual({ a: 2, b: 0, c: 2, d: 0, inconclusive: 0 });
  });
});

describe('buildLinkInterim — 연속 신호 Mann-Whitney', () => {
  const dates = DATES.slice(0, 5);
  // 01-01은 윈도우 밖(신호 시작 01-02). 그 날 활성·raw 100이 섞이면 U가 4가 아니게 된다.
  const activation = [true, true, true, false, false];
  const raw = [100, 3, 4, 1, 2];

  it('continuous 신호에 raw가 있으면 윈도우 안 값으로만 U와 Hodges-Lehmann을 계산한다', () => {
    const interim = buildLinkInterim(
      makeRow(),
      makeDeps({
        dates,
        signal: makeSignal({ valueType: 'continuous' }),
        activation,
        raw,
        signalStart: '2026-01-02',
      }),
    );
    // 발현 [3,4] vs 비발현 [1,2]: 순위합 3+4=7, U=7-3=4. 쌍별 차 [2,1,3,2] 중앙값 2.
    expect(interim?.mannWhitney?.u).toBe(4);
    expect(interim?.mannWhitney?.hodgesLehmann).toBe(2);
  });

  it('binary 신호는 raw가 있어도 계산하지 않는다', () => {
    const interim = buildLinkInterim(
      makeRow(),
      makeDeps({ dates, signal: makeSignal({ valueType: 'binary' }), activation, raw }),
    );
    expect(interim?.mannWhitney).toBeNull();
  });

  it('continuous 신호라도 raw가 없으면 계산하지 않는다', () => {
    const interim = buildLinkInterim(
      makeRow(),
      makeDeps({ dates, signal: makeSignal({ valueType: 'continuous' }), activation, raw: null }),
    );
    expect(interim?.mannWhitney).toBeNull();
  });

  it('윈도우 안에 비발현 날이 없으면 계산하지 않는다', () => {
    const interim = buildLinkInterim(
      makeRow(),
      makeDeps({
        dates,
        signal: makeSignal({ valueType: 'continuous' }),
        activation: dates.map(() => true),
        raw,
      }),
    );
    expect(interim?.mannWhitney).toBeNull();
  });
});

// ─── finalizeVerifications ───────────────────────────────

const makeV = (nActive: number, effect: number): ContingencyVerification => ({
  p: 0.5,
  effect,
  rateActive: 0.5,
  rateOff: 0.5,
  posteriorAlpha: 1,
  posteriorBeta: 1,
  posteriorP: 0.5,
  nActive,
  nOff: 30,
});

interface InterimOptions {
  linkId: number;
  blockP?: number;
  eValue?: number;
  nActive?: number;
  effect?: number;
  seed?: SajuSeedWithMetrics;
  hits?: number;
  misses?: number;
}

const makeInterim = (o: InterimOptions): Interim => {
  const seed = o.seed ?? makeSeed();
  const nActive = o.nActive ?? 30;
  const hits = o.hits ?? 15;
  const misses = o.misses ?? nActive - hits;
  return {
    row: makeRow({ link_id: o.linkId, seed_id: seed.id }),
    signal: makeSignal(),
    seed,
    cont: { a: hits, b: misses, c: 10, d: 20, inconclusive: 0 },
    windowStart: null,
    family: seed.trigger_target_type === 'strength_band' ? 'saju_strength' : 'baseline',
    v: makeV(nActive, o.effect ?? 2),
    blockP: o.blockP ?? 0.01,
    mannWhitney: null,
    eValue: o.eValue ?? 1,
    stability: null,
    lastMatchedAt: null,
  };
};

const strengthSeed = makeSeed({
  id: 2,
  trigger_target_type: 'strength_band',
  trigger_aux: { target: 'day_master', band: 'high' },
});

describe('finalizeVerifications — 가족별 BH-FDR', () => {
  it('q값을 가족 안에서만 보정해 원래 링크 순서에 돌려준다', () => {
    // baseline p [0.04, 0.01] → q [0.04, 0.02]. strength p 0.03 단독 → q 0.03.
    // 가족을 섞으면 [0.04, 0.04, 0.03]이 되어 구분된다.
    const out = finalizeVerifications(
      [
        makeInterim({ linkId: 1, blockP: 0.04 }),
        makeInterim({ linkId: 2, blockP: 0.03, seed: strengthSeed }),
        makeInterim({ linkId: 3, blockP: 0.01 }),
      ],
      new Map(),
    );
    expect(out.map((l) => l.linkId)).toEqual([1, 2, 3]);
    expect(out[0]?.qValue).toBeCloseTo(0.04, 10);
    expect(out[1]?.qValue).toBeCloseTo(0.03, 10);
    expect(out[2]?.qValue).toBeCloseTo(0.02, 10);
  });

  it('같은 가족 다른 링크 때문에 q가 confirmQ를 넘으면 confirm으로 판정하지 않는다', () => {
    // baseline p [0.03, 0.9] → q(0.03) = 0.03×2/1 = 0.06 > 0.05.
    const out = finalizeVerifications(
      [
        makeInterim({ linkId: 1, blockP: 0.03, eValue: 100 }),
        makeInterim({ linkId: 2, blockP: 0.9 }),
      ],
      new Map(),
    );
    expect(out[0]?.qValue).toBeCloseTo(0.06, 10);
    expect(out[0]?.verdict).toBe('inconclusive');
    expect(out[0]?.nextStatus).toBe('active');
  });
});

describe('finalizeVerifications — 판정과 다음 상태', () => {
  it('confirm이고 e-value가 20 이상이면 confirmed로 올린다', () => {
    const [l] = finalizeVerifications([makeInterim({ linkId: 1, eValue: 20 })], new Map());
    expect(l?.verdict).toBe('confirm');
    expect(l?.nextStatus).toBe('confirmed');
  });

  it('confirm이어도 e-value가 20 미만이면 active로 둔다', () => {
    const [l] = finalizeVerifications([makeInterim({ linkId: 1, eValue: 19.9 })], new Map());
    expect(l?.verdict).toBe('confirm');
    expect(l?.nextStatus).toBe('active');
  });

  it('역방향(effect ≤ 0.77)은 direction_mismatch로 rejected 처리한다', () => {
    const [l] = finalizeVerifications(
      [makeInterim({ linkId: 1, blockP: 0.9, effect: 0.5 })],
      new Map(),
    );
    expect(l?.verdict).toBe('direction_mismatch');
    expect(l?.nextStatus).toBe('rejected');
  });

  it('무연관(effect 0.95 이상 1.05 이하)은 reject로 rejected 처리한다', () => {
    const [l] = finalizeVerifications(
      [makeInterim({ linkId: 1, blockP: 0.9, effect: 1 })],
      new Map(),
    );
    expect(l?.verdict).toBe('reject');
    expect(l?.nextStatus).toBe('rejected');
  });

  it('발현일이 30일 미만이면 효과가 커도 insufficient로 active에 둔다', () => {
    const [l] = finalizeVerifications(
      [makeInterim({ linkId: 1, nActive: 29, hits: 15, eValue: 100 })],
      new Map(),
    );
    expect(l?.verdict).toBe('insufficient');
    expect(l?.nextStatus).toBe('active');
  });
});

describe('finalizeVerifications — 링크 메타', () => {
  it.each([
    ['life_signal', makeSeed({ trigger_target_type: 'life_signal' }), 'life_signal'],
    ['strength_band', strengthSeed, 'saju'],
    ['stem', makeSeed({ trigger_target_type: 'stem' }), 'saju'],
  ] as const)('%s 시드의 patternKind는 %s', (_type, seed, expected) => {
    const [l] = finalizeVerifications([makeInterim({ linkId: 1, seed })], new Map());
    expect(l?.patternKind).toBe(expected);
  });

  it('posterior는 전 링크 발현일 pass율로 추정한 공통 prior 위에 쌓는다', () => {
    // pass율 0.25(1/4), 0.75(3/4) → 평균 0.5, 분산 0.0625 → 농도 0.25/0.0625-1 = 3 → prior Beta(1.5, 1.5).
    const out = finalizeVerifications(
      [
        makeInterim({ linkId: 1, nActive: 4, hits: 1, misses: 3 }),
        makeInterim({ linkId: 2, nActive: 4, hits: 3, misses: 1 }),
      ],
      new Map(),
    );
    expect(out[0]?.posteriorAlpha).toBeCloseTo(2.5, 10);
    expect(out[0]?.posteriorBeta).toBeCloseTo(4.5, 10);
    expect(out[1]?.posteriorAlpha).toBeCloseTo(4.5, 10);
    expect(out[1]?.posteriorBeta).toBeCloseTo(2.5, 10);
  });
});
