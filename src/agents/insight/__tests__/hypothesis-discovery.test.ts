import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SajuSeedWithMetrics } from '../../../shared/pattern-match.js';
import type { DaySeries, SignalSeriesResult } from '../../../shared/pattern-verification.js';

// ─── fixtures ────────────────────────────────────────────
interface SignalRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: string | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
  description: string | null;
}

interface Fixture {
  seeds: SajuSeedWithMetrics[];
  signals: SignalRow[];
  linkedPairs: Array<{ seed_id: number; signal_id: number }>;
  activationBySeed: Map<number, Map<string, boolean>>;
  signalSeriesById: Map<number, DaySeries>;
  /** 연속 신호 raw 시리즈 (Mann-Whitney 효과크기 경로 §4 테스트용). */
  rawBySignal: Map<number, Map<string, number | null>>;
}

let fixture: Fixture;
let blockPQueue: number[];
let blockPIdx: number;
let insertCalls: unknown[][];

const resetFixture = (): void => {
  fixture = {
    seeds: [],
    signals: [],
    linkedPairs: [],
    activationBySeed: new Map(),
    signalSeriesById: new Map(),
    rawBySignal: new Map(),
  };
  blockPQueue = [];
  blockPIdx = 0;
  insertCalls = [];
};
resetFixture();

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    // computeUserDataStarts(#504): 테이블별 MIN(date) — 픽스처는 데이터 시작 제약 없음(global=null → 무클립).
    if (/MIN\(date\)/i.test(sql)) {
      return { rows: [{ d: null }] };
    }
    if (/FROM signal_defs/i.test(sql) && /status = 'active'/i.test(sql)) {
      return { rows: fixture.signals };
    }
    if (/SELECT seed_id, signal_id FROM pattern_links/i.test(sql)) {
      return { rows: fixture.linkedPairs };
    }
    if (/INSERT INTO pattern_links/i.test(sql)) {
      insertCalls.push([...(params ?? [])]);
      // ON CONFLICT DO NOTHING 시뮬레이션: 충돌 표시 없으면 새 id 반환.
      return { rows: [{ id: 9001 }] };
    }
    throw new Error(`[fixture] unexpected SQL: ${sql.slice(0, 70)}`);
  }),
}));

vi.mock('../../../shared/pattern-match.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/pattern-match.js')>();
  return {
    ...actual,
    loadActiveSeeds: vi.fn(async () => fixture.seeds),
    buildNameIdMap: vi.fn(async () => new Map<string, number>()),
  };
});

vi.mock('../../../shared/pattern-verification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/pattern-verification.js')>();
  return {
    ...actual,
    computeSignalSeries: vi.fn(
      async (_userId: number, signal: { id: number }): Promise<SignalSeriesResult> => ({
        series: fixture.signalSeriesById.get(signal.id) ?? new Map(),
        raw: fixture.rawBySignal.get(signal.id) ?? null,
      }),
    ),
    computeSeedActivationSeries: vi.fn(
      async (seed: { id: number }): Promise<Map<string, boolean>> =>
        fixture.activationBySeed.get(seed.id) ?? new Map(),
    ),
  };
});

vi.mock('../../../shared/stats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/stats.js')>();
  return {
    ...actual,
    // 결정론 block-perm: survivor 순회 순서대로 큐 소비(없으면 강한 연관 가정 0.001).
    blockPermutationP: vi.fn(() => blockPQueue[blockPIdx++] ?? 0.001),
  };
});

const { discoverCandidates, insertPendingDiscoveryLink } =
  await import('../hypothesis-discovery.js');

// ─── helpers ─────────────────────────────────────────────
const makeSeed = (
  id: number,
  name: string,
  targetType: SajuSeedWithMetrics['trigger_target_type'] = 'stem',
  description: string | null = `${name} 설명`,
): SajuSeedWithMetrics => ({
  id,
  user_id: 1,
  name,
  sipsin: null,
  description,
  trigger_target_type: targetType,
  trigger_target_id: null,
  trigger_aux: null,
  pillar_level: null,
  active: true,
  source: 'seed',
  metrics: [],
});

const makeSignal = (id: number, name: string, kind: 'sql' | 'tag' = 'tag'): SignalRow => ({
  id,
  name,
  kind,
  sql_body: kind === 'sql' ? 'SELECT 1' : null,
  value_type: kind === 'sql' ? 'binary' : null,
  direction: kind === 'sql' ? 'flag_present' : null,
  threshold: null,
  tag_name: kind === 'tag' ? name : null,
  window_days: null,
  description: `${name} 신호`,
});

/**
 * windowDates 앞쪽에 (a,b,c,d) 분할표를 만드는 활성/신호 시리즈 생성.
 * a=발현&pass, b=발현&fail, c=비발현&pass, d=비발현&fail. 나머지 날은 미설정(미집계).
 */
const makeContingencySeries = (
  a: number,
  b: number,
  c: number,
  d: number,
): { activation: Map<string, boolean>; signal: DaySeries } => {
  const activation = new Map<string, boolean>();
  const signal: DaySeries = new Map();
  let i = 0;
  const base = new Date('2025-06-06T00:00:00Z');
  const nextDate = (): string => {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() + i++);
    return dt.toISOString().slice(0, 10);
  };
  const put = (n: number, act: boolean, pass: boolean): void => {
    for (let k = 0; k < n; k++) {
      const date = nextDate();
      activation.set(date, act);
      signal.set(date, pass);
    }
  };
  put(a, true, true);
  put(b, true, false);
  put(c, false, true);
  put(d, false, false);
  return { activation, signal };
};

/** 시드×신호 한 쌍을 강한/지정 분할표로 등록. */
const wirePair = (
  seedId: number,
  signalId: number,
  cont: { a: number; b: number; c: number; d: number },
): void => {
  const { activation, signal } = makeContingencySeries(cont.a, cont.b, cont.c, cont.d);
  fixture.activationBySeed.set(seedId, activation);
  fixture.signalSeriesById.set(signalId, signal);
};

const TODAY = '2026-06-08';

describe('discoverCandidates — 여집합 제외', () => {
  beforeEach(resetFixture);

  it('이미 링크된 (시드, 신호) 쌍은 모든 status에서 후보 제외', async () => {
    fixture.seeds = [makeSeed(10, '갑목일주')];
    fixture.signals = [makeSignal(20, 'mood_high')];
    // 강한 연관이지만 이미 링크됨(예: rejected/archived 포함 어떤 status든) → 제외.
    fixture.linkedPairs = [{ seed_id: 10, signal_id: 20 }];
    wirePair(10, 20, { a: 25, b: 2, c: 2, d: 25 });

    const out = await discoverCandidates(1, TODAY);
    expect(out).toEqual([]);
  });

  it('링크 없는 여집합 쌍은 후보로 surface', async () => {
    fixture.seeds = [makeSeed(10, '갑목일주')];
    fixture.signals = [makeSignal(20, 'mood_high')];
    fixture.linkedPairs = []; // 여집합
    wirePair(10, 20, { a: 25, b: 2, c: 2, d: 25 });

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.seedId).toBe(10);
    expect(out[0]?.signalId).toBe(20);
    expect(out[0]?.seedName).toBe('갑목일주');
    expect(out[0]?.signalName).toBe('mood_high');
    expect(out[0]?.effect).toBeGreaterThan(1.3);
  });

  it('seeds 또는 signals 비면 빈 배열', async () => {
    fixture.signals = [makeSignal(20, 'mood_high')];
    expect(await discoverCandidates(1, TODAY)).toEqual([]);
    resetFixture();
    fixture.seeds = [makeSeed(10, '갑목일주')];
    expect(await discoverCandidates(1, TODAY)).toEqual([]);
  });
});

describe('discoverCandidates — Fisher 사전선별', () => {
  beforeEach(resetFixture);

  it('발현일 부족(nActive < discoveryMinActive=12)이면 컷', async () => {
    fixture.seeds = [makeSeed(10, 's')];
    fixture.signals = [makeSignal(20, 'sig')];
    wirePair(10, 20, { a: 6, b: 2, c: 2, d: 25 }); // nActive=8 < 12
    expect(await discoverCandidates(1, TODAY)).toEqual([]);
  });

  it('효과크기 부족(effect < discoveryMinEffect=1.3)이면 컷', async () => {
    fixture.seeds = [makeSeed(10, 's')];
    fixture.signals = [makeSignal(20, 'sig')];
    // rateActive≈rateOff → effect≈1 < 1.3
    wirePair(10, 20, { a: 10, b: 10, c: 10, d: 10 });
    expect(await discoverCandidates(1, TODAY)).toEqual([]);
  });

  it('Fisher 비유의(fisherP > discoveryMaxFisherP=0.1)이면 컷', async () => {
    fixture.seeds = [makeSeed(10, 's')];
    fixture.signals = [makeSignal(20, 'sig')];
    // effect는 1.3 넘지만 n이 작아 Fisher가 비유의 → 컷.
    wirePair(10, 20, { a: 13, b: 5, c: 8, d: 10 });
    const out = await discoverCandidates(1, TODAY);
    // 사전선별에서 fisherP가 0.1 넘으면 빈 배열(약한 신호는 surface 안 함).
    expect(out.every((c) => c.fisherP <= 0.1)).toBe(true);
  });
});

describe('discoverCandidates — 연속 신호 효과크기 랭킹 (§4)', () => {
  beforeEach(resetFixture);

  const makeContinuousSignal = (id: number, name: string): SignalRow => ({
    id,
    name,
    kind: 'sql',
    sql_body: 'SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE ...',
    value_type: 'continuous',
    direction: 'above_avg',
    threshold: null,
    tag_name: null,
    window_days: null,
    description: `${name} 신호`,
  });

  it('연속 신호는 Mann-Whitney 효과크기로 surface (HL·MW p 동봉, valueType=continuous)', async () => {
    fixture.seeds = [makeSeed(10, '갑목일주')];
    fixture.signals = [makeContinuousSignal(21, 'sleep_total_minutes')];
    // 이진화 시리즈는 강한 분할표(공통 게이트 nActive·block-perm 통과).
    const { activation, signal } = makeContingencySeries(12, 2, 2, 12);
    fixture.activationBySeed.set(10, activation);
    fixture.signalSeriesById.set(21, signal);
    // raw: 발현일 높은 수면(500), 비발현일 낮음(350) → 강한 양의 분리(rank-biserial≈+1).
    const raw = new Map<string, number | null>();
    for (const [date, act] of activation) raw.set(date, act ? 500 : 350);
    fixture.rawBySignal.set(21, raw);

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.valueType).toBe('continuous');
    expect(out[0]?.effectSize ?? 0).toBeGreaterThan(0); // HL 위치이동 양수(발현일 더 높음)
    expect(out[0]?.mwP ?? 1).toBeLessThanOrEqual(0.1);
    expect(Number.isFinite(out[0]?.sortZ ?? NaN)).toBe(true);
  });

  it('효과크기 부족(rank-biserial < discoveryMinEffectR=0.2)인 연속 신호는 컷', async () => {
    fixture.seeds = [makeSeed(10, '갑목일주')];
    fixture.signals = [makeContinuousSignal(21, 'sleep_total_minutes')];
    const { activation, signal } = makeContingencySeries(12, 2, 2, 12);
    fixture.activationBySeed.set(10, activation);
    fixture.signalSeriesById.set(21, signal);
    // raw가 발현/비발현 거의 겹침 → 위치이동 미미 → rank-biserial 하한 미달 → 컷.
    const raw = new Map<string, number | null>();
    let i = 0;
    for (const [date] of activation) raw.set(date, 400 + (i++ % 2)); // 400/401 교차(분리 없음)
    fixture.rawBySignal.set(21, raw);

    expect(await discoverCandidates(1, TODAY)).toEqual([]);
  });
});

describe('discoverCandidates — discoverQ 게이트 + top-N', () => {
  beforeEach(resetFixture);

  it('block-perm q > discoverQ(0.15) 후보는 컷', async () => {
    // 두 baseline 쌍 모두 사전선별 통과(강한 분할표) → block-perm q로 구분.
    fixture.seeds = [makeSeed(10, 'a'), makeSeed(11, 'b')];
    fixture.signals = [makeSignal(20, 'sig')];
    fixture.activationBySeed.set(10, makeContingencySeries(25, 2, 2, 25).activation);
    fixture.activationBySeed.set(11, makeContingencySeries(25, 2, 2, 25).activation);
    // 두 시드가 같은 신호와 매칭 — 신호 시리즈는 시드10 기준(둘 다 동일 분할표).
    fixture.signalSeriesById.set(20, makeContingencySeries(25, 2, 2, 25).signal);
    // survivor 순회: (seed10,sig20) → (seed11,sig20). block-p [0.001, 0.5].
    // BH-FDR(baseline N=2): 정렬 [0.001,0.5] → q=[0.002, 0.5]. discoverQ=0.15 → 1개만 통과.
    blockPQueue = [0.001, 0.5];

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.seedId).toBe(10);
    expect(out[0]?.qValue).toBeLessThanOrEqual(0.15);
  });

  it('top-N(discoveryTopN=5) 절단 — 6개 강한 후보 → 5개 반환 + 드롭 로그', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fixture.signals = [makeSignal(20, 'sig')];
    fixture.signalSeriesById.set(20, makeContingencySeries(25, 2, 2, 25).signal);
    // 6 시드, 전부 강한 분할표 → 전부 통과 → top 5만.
    for (let s = 0; s < 6; s++) {
      fixture.seeds.push(makeSeed(10 + s, `seed${s}`));
      fixture.activationBySeed.set(10 + s, makeContingencySeries(25, 2, 2, 25).activation);
    }
    blockPQueue = [0.001, 0.001, 0.001, 0.001, 0.001, 0.001];

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('드롭 1'));
    warnSpy.mockRestore();
  });
});

describe('discoverCandidates — 가족·강도 밴드 흐름', () => {
  beforeEach(resetFixture);

  it('strength_band 시드도 여집합 스캔에 포함(2-pass 활성 시리즈 소비)', async () => {
    // strength_band 시드의 활성 시리즈는 computeSeedActivationSeries(2-pass)가 제공 — 여기선 모킹.
    fixture.seeds = [makeSeed(30, '일간 강함', 'strength_band')];
    fixture.signals = [makeSignal(40, '지출과다', 'sql')];
    wirePair(30, 40, { a: 22, b: 3, c: 3, d: 22 });

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.family).toBe('saju_strength');
    expect(out[0]?.patternKind).toBe('saju');
    expect(out[0]?.signalKind).toBe('sql');
  });

  it('life_signal 시드는 baseline 가족 + patternKind=life_signal', async () => {
    fixture.seeds = [makeSeed(50, '주말', 'life_signal')];
    fixture.signals = [makeSignal(60, 'rest')];
    wirePair(50, 60, { a: 20, b: 3, c: 3, d: 20 });

    const out = await discoverCandidates(1, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.family).toBe('baseline');
    expect(out[0]?.patternKind).toBe('life_signal');
  });
});

describe('insertPendingDiscoveryLink — pending 선INSERT', () => {
  beforeEach(resetFixture);

  it('source=discovery·status=pending으로 INSERT + linkId 반환 + 발굴 스냅샷 동봉', async () => {
    const linkId = await insertPendingDiscoveryLink(1, {
      seedId: 10,
      signalId: 20,
      seedName: 's',
      seedDescription: '설명',
      patternKind: 'saju',
      signalName: 'sig',
      signalDescription: '신호',
      signalKind: 'tag',
      valueType: 'binary',
      rateActive: 0.9,
      rateOff: 0.2,
      effect: 4.5,
      effectSize: null,
      mwP: null,
      sortZ: 3.4,
      nActive: 27,
      hit: 24,
      miss: 3,
      inconclusive: 0,
      fisherP: 0.001,
      blockP: 0.002,
      qValue: 0.01,
      posteriorAlpha: 25,
      posteriorBeta: 4,
      posteriorP: 0.86,
      family: 'baseline',
    });
    expect(linkId).toBe(9001);
    expect(insertCalls).toHaveLength(1);
    const params = insertCalls[0] ?? [];
    expect(params[0]).toBe(1); // user_id
    expect(params[1]).toBe(10); // seed_id
    expect(params[2]).toBe(20); // signal_id
    expect(params[3]).toBe(24); // hit_count
    expect(params[4]).toBe(3); // miss_count
    // 이진 신호 → test_type='fisher_2x2' (마지막 인자).
    expect(params[params.length - 1]).toBe('fisher_2x2');
    // test_detail JSONB(끝에서 두 번째 인자)에 발굴 스냅샷.
    const detail = JSON.parse(String(params[params.length - 2]));
    expect(detail.source).toBe('discovery');
    expect(detail.discover_q).toBe(0.01);
    expect(detail.family).toBe('baseline');
  });

  it('연속 신호 → test_type=mann_whitney + 효과크기(effect_size/mw_p) 동봉 (§4)', async () => {
    await insertPendingDiscoveryLink(1, {
      seedId: 11,
      signalId: 21,
      seedName: 's',
      seedDescription: null,
      patternKind: 'saju',
      signalName: 'sleep_total_minutes',
      signalDescription: null,
      signalKind: 'sql',
      valueType: 'continuous',
      rateActive: 0.7,
      rateOff: 0.4,
      effect: 1.75,
      effectSize: 42.5, // Hodges-Lehmann (raw 분 단위)
      mwP: 0.012,
      sortZ: 2.6,
      nActive: 20,
      hit: 14,
      miss: 6,
      inconclusive: 0,
      fisherP: 0.04,
      blockP: 0.02,
      qValue: 0.08,
      posteriorAlpha: 15,
      posteriorBeta: 7,
      posteriorP: 0.68,
      family: 'baseline',
    });
    const params = insertCalls[0] ?? [];
    expect(params[params.length - 1]).toBe('mann_whitney');
    const detail = JSON.parse(String(params[params.length - 2]));
    expect(detail.effect_size).toBe(42.5);
    expect(detail.mw_p).toBe(0.012);
    expect(detail.sort_z).toBe(2.6);
  });
});
