import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailyContext, SajuSeedWithMetrics } from '../match-types.js';
import type { SignalDef } from '../types.js';

// ─── fixtures ────────────────────────────────────────────
let tagDates: Map<string, string[]>;
let ctxByDate: Map<string, DailyContext | null>;

vi.mock('../../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (/FROM diary_meta_tags/i.test(sql)) {
      const tag = String(params?.[1]);
      return { rows: (tagDates.get(tag) ?? []).map((date) => ({ date })) };
    }
    throw new Error(`[fixture] unexpected SQL: ${sql.slice(0, 60)}`);
  }),
}));

vi.mock('../match-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-context.js')>();
  return {
    ...actual,
    getDailyContext: vi.fn(async (_userId: number, date: string) => ctxByDate.get(date) ?? null),
  };
});

// 강도 계산은 사주 엔진 경계 — 가짜 ctx의 ilun에 심어 둔 값을 그대로 강도로 쓴다.
vi.mock('../../saju/strength.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../saju/strength.js')>();
  return {
    ...actual,
    computeStrengthForTarget: vi.fn(
      (_target: unknown, _dayMaster: unknown, pillarSet: { ilun: unknown }) =>
        (pillarSet.ilun as { strength: number }).strength,
    ),
  };
});

const { computeSignalSeriesMap, computeSeedActivationMap } = await import('../series-map.js');
const { getDailyContext } = await import('../match-context.js');
const { computeStrengthForTarget } = await import('../../saju/strength.js');

// ─── helpers ─────────────────────────────────────────────
const DATES = ['2026-01-01', '2026-01-02', '2026-01-03'];

const tagSignal = (id: number, tagName: string): SignalDef => ({
  id,
  name: `signal_${id}`,
  kind: 'tag',
  source: 'seed',
  sqlBody: null,
  valueType: 'binary',
  direction: null,
  threshold: null,
  tagName,
  windowDays: null,
  domain: 'diary_meta',
});

const makeSeed = (
  id: number,
  over: Partial<SajuSeedWithMetrics> = {},
): SajuSeedWithMetrics => ({
  id,
  user_id: 1,
  name: `seed_${id}`,
  sipsin: null,
  description: null,
  trigger_target_type: 'stem',
  trigger_target_id: null,
  trigger_aux: null,
  pillar_level: null,
  active: true,
  source: 'seed',
  metrics: [],
  ...over,
});

const bandSeed = (id: number, band: 'low' | 'mid' | 'high'): SajuSeedWithMetrics =>
  makeSeed(id, { trigger_target_type: 'strength_band', trigger_aux: { target: 'day_master', band } });

/** 강도 값만 의미 있는 가짜 컨텍스트 (강도 밴드 경로는 natal.dayMaster·pillarSet만 읽는다). */
const fakeCtx = (date: string, strength: number): DailyContext =>
  ({
    date,
    userId: 1,
    natal: { dayMaster: '갑', pillars: [] },
    daeun: null,
    seun: null,
    wolun: null,
    ilun: { strength },
  }) as unknown as DailyContext;

const values = (m: Map<string, unknown> | undefined): unknown[] => [...(m?.values() ?? [])];

beforeEach(() => {
  tagDates = new Map();
  ctxByDate = new Map();
  vi.clearAllMocks();
});

// ─── computeSignalSeriesMap ──────────────────────────────

describe('computeSignalSeriesMap', () => {
  it('신호마다 자기 시작일 이전을 결측으로 두고, 시작일이 없는 신호는 자르지 않는다', async () => {
    tagDates = new Map([
      ['a', ['2026-01-03']],
      ['b', ['2026-01-01']],
    ]);
    const out = await computeSignalSeriesMap(
      1,
      [tagSignal(30, 'a'), tagSignal(10, 'b')],
      DATES,
      new Map([[30, '2026-01-02']]),
    );

    expect(values(out.get(30)?.series)).toEqual([null, false, true]);
    expect(values(out.get(10)?.series)).toEqual([true, false, false]);
  });

  it('결과 Map은 넘겨받은 신호 순서를 따른다', async () => {
    const out = await computeSignalSeriesMap(
      1,
      [tagSignal(30, 'a'), tagSignal(10, 'b'), tagSignal(20, 'c')],
      DATES,
      new Map(),
    );
    expect([...out.keys()]).toEqual([30, 10, 20]);
  });
});

// ─── computeSeedActivationMap ────────────────────────────

describe('computeSeedActivationMap', () => {
  it('한 호출 안에서는 시드가 여러 개여도 날짜별 컨텍스트를 한 번만 조회한다', async () => {
    const out = await computeSeedActivationMap(
      1,
      [makeSeed(2), makeSeed(1)],
      DATES,
      new Map(),
      new Map(),
    );

    expect(getDailyContext).toHaveBeenCalledTimes(DATES.length);
    expect([...out.keys()]).toEqual([2, 1]);
  });

  it('호출이 바뀌면 컨텍스트 캐시를 새로 만든다', async () => {
    await computeSeedActivationMap(1, [makeSeed(1)], DATES, new Map(), new Map());
    await computeSeedActivationMap(1, [makeSeed(1)], DATES, new Map(), new Map());

    expect(getDailyContext).toHaveBeenCalledTimes(DATES.length * 2);
  });

  it('같은 강도 target의 밴드 시드끼리 강도 시리즈를 공유하고 날마다 한 밴드만 켠다', async () => {
    // 강도 [1,2,3] → tertile 컷 low≈1.67, high≈2.33 → 01-01 low, 01-02 mid, 01-03 high.
    ctxByDate = new Map(DATES.map((d, i) => [d, fakeCtx(d, i + 1)]));

    const out = await computeSeedActivationMap(
      1,
      [bandSeed(1, 'low'), bandSeed(2, 'mid'), bandSeed(3, 'high')],
      DATES,
      new Map(),
      new Map(),
    );

    expect(computeStrengthForTarget).toHaveBeenCalledTimes(DATES.length);
    expect(values(out.get(1))).toEqual([true, false, false]);
    expect(values(out.get(2))).toEqual([false, true, false]);
    expect(values(out.get(3))).toEqual([false, false, true]);
  });
});
