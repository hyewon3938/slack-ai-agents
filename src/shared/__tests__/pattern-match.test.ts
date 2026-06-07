import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB 모킹 ──

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockEnd;
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

vi.mock('../kst.js', () => ({
  addDays: (d: string, days: number) => {
    const date = new Date(`${d}T12:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + days);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
}));

import { connectDB } from '../db.js';
import {
  evaluateTrigger,
  evaluateMetric,
  recordDailyMatches,
  runMetricSql,
  runLlmSignalSql,
  runnerForSource,
  __resetCacheForTest,
  type SajuSeedWithMetrics,
  type DailyContext,
  type NatalContext,
  type SeedMatchResult,
  type SajuMetric,
} from '../pattern-match.js';
import {
  getMonthPillar,
  getYearPillar,
  makePillar,
  type Cheongan,
  type Jiji,
} from '../saju-calendar.js';

beforeEach(async () => {
  vi.clearAllMocks();
  __resetCacheForTest();
  mockConnect.mockImplementation(() =>
    Promise.resolve({
      query: (sql: string, ...args: unknown[]) => {
        // 트랜잭션 제어문(SET statement_timeout / SET TRANSACTION / BEGIN / ROLLBACK / COMMIT)은
        // 무시 — 데이터 쿼리만 mockQuery로 위임. queryReadOnly(게이트 #2) 경로도 통과.
        if (typeof sql === 'string' && /^\s*(SET|BEGIN|ROLLBACK|COMMIT)\b/i.test(sql)) {
          return Promise.resolve({ rows: [] });
        }
        return mockQuery(sql, ...args);
      },
      release: vi.fn(),
    }),
  );
  await connectDB('postgresql://test@localhost/test');
});

// ─── helpers ──────────────────────────────────────────────

const stemMap = new Map([
  ['갑', 1],
  ['을', 2],
  ['병', 3],
  ['정', 4],
  ['무', 5],
  ['기', 6],
  ['경', 7],
  ['신', 8],
  ['임', 9],
  ['계', 10],
]);
const branchMap = new Map([
  ['자', 1],
  ['축', 2],
  ['인', 3],
  ['묘', 4],
  ['진', 5],
  ['사', 6],
  ['오', 7],
  ['미', 8],
  ['신', 9],
  ['유', 10],
  ['술', 11],
  ['해', 12],
]);

const baseSeed = (overrides: Partial<SajuSeedWithMetrics> = {}): SajuSeedWithMetrics => ({
  id: 1,
  user_id: 1,
  name: 'TEST',
  sipsin: null,
  description: null,
  trigger_target_type: 'stem',
  trigger_target_id: null,
  trigger_aux: null,
  pillar_level: null,
  active: true,
  source: 'seed',
  metrics: [],
  ...overrides,
});

/** stems/branches/dayMaster만 받아서 NatalContext 완성 (Phase 2.5 신규 필드 자동 채움) */
export const buildNatal = (partial: {
  stems: Cheongan[];
  branches: Jiji[];
  dayMaster: Cheongan;
}): NatalContext => ({
  stems: partial.stems,
  branches: partial.branches,
  dayMaster: partial.dayMaster,
  pillars: partial.stems.map((s, i) => makePillar(s, partial.branches[i])),
  birthDate: null,
  daewunList: [],
});

const baseCtx = (
  overrides: Partial<Omit<DailyContext, 'natal'>> & { natal?: NatalContext } = {},
): DailyContext => {
  const date = overrides.date ?? '2026-05-17';
  const dayStem = overrides.dayStem ?? '경';
  const dayBranch = overrides.dayBranch ?? '술';
  const ilun = overrides.ilun ?? makePillar(dayStem, dayBranch);
  return {
    date,
    userId: overrides.userId ?? 1,
    dayStem,
    dayBranch,
    natal:
      overrides.natal ??
      buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      }),
    ilun,
    wolun: overrides.wolun ?? getMonthPillar(date),
    seun: overrides.seun ?? getYearPillar(date),
    daeun: overrides.daeun ?? null,
  };
};

// ─── evaluateTrigger: stem ────────────────────────────────

describe('evaluateTrigger - stem', () => {
  it('일운 천간이 trigger_target_id와 일치하면 true', async () => {
    const seed = baseSeed({ trigger_target_type: 'stem', trigger_target_id: 7 }); // 경
    const ctx = baseCtx({ dayStem: '경' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('일운 천간이 trigger_target_id와 다르면 false', async () => {
    const seed = baseSeed({ trigger_target_type: 'stem', trigger_target_id: 1 }); // 갑
    const ctx = baseCtx({ dayStem: '경' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('trigger_target_id가 null이면 false', async () => {
    const seed = baseSeed({ trigger_target_type: 'stem', trigger_target_id: null });
    const ctx = baseCtx({ dayStem: '경' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: branch ──────────────────────────────

describe('evaluateTrigger - branch', () => {
  it('일운 지지가 trigger_target_id와 일치하면 true', async () => {
    const seed = baseSeed({ trigger_target_type: 'branch', trigger_target_id: 11 }); // 술
    const ctx = baseCtx({ dayBranch: '술' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('trigger_target_id 미일치 + or_branches에 포함되면 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'branch',
      trigger_target_id: 2, // 축
      trigger_aux: { or_branches: ['미'] },
    });
    const ctx = baseCtx({ dayBranch: '미' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('target_id 미일치 + or_branches에도 미포함이면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'branch',
      trigger_target_id: 2,
      trigger_aux: { or_branches: ['미'] },
    });
    const ctx = baseCtx({ dayBranch: '오' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: element_density ─────────────────────

describe('evaluateTrigger - element_density', () => {
  it('본명 토 3개 + 일운(경술) 토 1개 = 4 ≥ min_count → true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'element_density',
      trigger_aux: { element: '토', min_count: 4 },
    });
    // 본명 stems: 갑경경경(목+금3), branches: 자술술술(수+토3)
    // 일운: 경(금)/술(토). 토 카운트 = 3(본명) + 1(일운 술) = 4
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('일운 미일치 + 본명 카운트만으로 min 미달 → false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'element_density',
      trigger_aux: { element: '토', min_count: 5 },
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('aux의 element/min_count 누락 시 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'element_density',
      trigger_aux: { element: '토' },
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: strength_band (#477 P4a) ────────────
// 일별 cron 경로: 저장된 분위수 컷으로 오늘 강도를 밴드 판정. 강도 계산은 순수(DB 불요).

describe('evaluateTrigger - strength_band', () => {
  const strengthSeed = (target: string, band: string): SajuSeedWithMetrics =>
    baseSeed({ trigger_target_type: 'strength_band', trigger_aux: { target, band } });

  // 극단 컷으로 밴드를 결정론적으로 강제(실제 강도값과 무관하게 wiring 검증).
  const cutsHigh = new Map([['day_master', { low: -1e9, high: -1e9 }]]); // 모든 유한 강도 → high
  const cutsLow = new Map([['day_master', { low: 1e9, high: 1e9 }]]); // 모든 유한 강도 → low

  it('오늘 강도가 high 밴드 + 시드 band=high → true', async () => {
    const ctx = baseCtx();
    expect(
      await evaluateTrigger(strengthSeed('day_master', 'high'), ctx, stemMap, branchMap, cutsHigh),
    ).toBe(true);
  });

  it('오늘 강도가 high 밴드인데 시드 band=low → false', async () => {
    const ctx = baseCtx();
    expect(
      await evaluateTrigger(strengthSeed('day_master', 'low'), ctx, stemMap, branchMap, cutsHigh),
    ).toBe(false);
  });

  it('오늘 강도가 low 밴드 + 시드 band=low → true', async () => {
    const ctx = baseCtx();
    expect(
      await evaluateTrigger(strengthSeed('day_master', 'low'), ctx, stemMap, branchMap, cutsLow),
    ).toBe(true);
  });

  it('컷 맵 미전달(첫 주간 엔진 실행 전) → false (발현 없음, 정직)', async () => {
    const ctx = baseCtx();
    expect(await evaluateTrigger(strengthSeed('day_master', 'high'), ctx, stemMap, branchMap)).toBe(
      false,
    );
  });

  it('해당 target 컷 없으면 → false', async () => {
    const ctx = baseCtx();
    const otherCuts = new Map([['화', { low: -1e9, high: -1e9 }]]);
    expect(
      await evaluateTrigger(strengthSeed('day_master', 'high'), ctx, stemMap, branchMap, otherCuts),
    ).toBe(false);
  });

  it('잘못된 aux(target 비유효) → false', async () => {
    const ctx = baseCtx();
    expect(
      await evaluateTrigger(strengthSeed('bogus', 'high'), ctx, stemMap, branchMap, cutsHigh),
    ).toBe(false);
  });

  it('오행 target도 해석 (화 강도 high 컷 → true)', async () => {
    const ctx = baseCtx();
    const huaCuts = new Map([['화', { low: -1e9, high: -1e9 }]]);
    expect(
      await evaluateTrigger(strengthSeed('화', 'high'), ctx, stemMap, branchMap, huaCuts),
    ).toBe(true);
  });
});

// ─── evaluateTrigger: hwa_sipsung (#477 P4b) ──────────────

describe('evaluateTrigger - hwa_sipsung', () => {
  const hwaSeed = (sipsin: string): SajuSeedWithMetrics =>
    baseSeed({ trigger_target_type: 'hwa_sipsung', trigger_aux: { sipsin, via: 'hwa' } });

  // 본명 갑 + 월운 기 → 갑기합토(통근 술). 化 토는 일간 경(금) 대비 인성(토생금).
  const hwaCtx = baseCtx({ wolun: makePillar('기', '축') });

  it('합화일 효과적 십성 일치 → true (化토 → 인성)', async () => {
    expect(await evaluateTrigger(hwaSeed('인성'), hwaCtx, stemMap, branchMap)).toBe(true);
  });

  it('합화일이지만 다른 십성 → false', async () => {
    expect(await evaluateTrigger(hwaSeed('재성'), hwaCtx, stemMap, branchMap)).toBe(false);
  });

  it('합화 없는 날 → false', async () => {
    const noHwa = baseCtx({
      seun: makePillar('경', '신'),
      wolun: makePillar('경', '신'),
      ilun: makePillar('경', '신'),
    });
    expect(await evaluateTrigger(hwaSeed('인성'), noHwa, stemMap, branchMap)).toBe(false);
  });

  it('잘못된 sipsin aux → false', async () => {
    const seed = baseSeed({ trigger_target_type: 'hwa_sipsung', trigger_aux: { sipsin: 'bogus' } });
    expect(await evaluateTrigger(seed, hwaCtx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: relation ────────────────────────────

describe('evaluateTrigger - relation', () => {
  beforeEach(() => {
    // branch_relations 마스터 모킹 — 사술 원진 + 진술 충
    mockQuery.mockImplementation((sql: string) => {
      if (/branch_relations/.test(sql)) {
        return Promise.resolve({
          rows: [
            { relation_type: '원진', branch_a_name: '사', branch_b_name: '술' },
            { relation_type: '충', branch_a_name: '진', branch_b_name: '술' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('일운 지지 사 + 본명에 술 있음 + 원진 관계 → true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: {
        day_branch: '사',
        natal_branches: ['술'],
        relation_types: ['원진'],
      },
    });
    const ctx = baseCtx({ dayBranch: '사' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('일운 지지가 aux.day_branch와 다르면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: {
        day_branch: '사',
        natal_branches: ['술'],
        relation_types: ['원진'],
      },
    });
    const ctx = baseCtx({ dayBranch: '오' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('본명에 natal_branches가 없으면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: {
        day_branch: '사',
        natal_branches: ['진'],
        relation_types: ['충'],
      },
    });
    const ctx = baseCtx({
      dayBranch: '사',
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '축', '신', '유'], // 진 없음
        dayMaster: '경',
      }),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('aux 필드 누락 시 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { day_branch: '사' }, // natal_branches·relation_types 없음
    });
    const ctx = baseCtx({ dayBranch: '사' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  // ── 풀셋 형태 (마스터 #434 Phase 2): {type, members} ──

  it('풀셋 branch_충 — 본명 멤버 있고 일운이 반대 멤버면 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { type: 'branch_충', members: ['자', '오'] },
    });
    // 본명 자 있음, 일운 오 → trigger
    const ctx = baseCtx({
      dayBranch: '오',
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      }),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('풀셋 branch_충 — 본명 + 일운 양방향 평가, 반대도 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { type: 'branch_충', members: ['자', '오'] },
    });
    // 본명 오 있음, 일운 자 → trigger (양방향)
    const ctx = baseCtx({
      dayBranch: '자',
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['오', '술', '술', '술'],
        dayMaster: '경',
      }),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('풀셋 branch_충 — 본명에 양쪽 멤버 모두 없으면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { type: 'branch_충', members: ['자', '오'] },
    });
    const ctx = baseCtx({
      dayBranch: '자',
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['신', '술', '술', '술'], // 자/오 둘 다 없음
        dayMaster: '경',
      }),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('풀셋 stem_합 — 본명 천간 + 일운 천간 양방향 평가', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { type: 'stem_합', members: ['을', '경'] },
    });
    // 본명 경 있음, 일운 을 → trigger
    const ctx = baseCtx({
      dayStem: '을',
      dayBranch: '술',
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      }),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('풀셋 type prefix 알 수 없으면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'relation',
      trigger_aux: { type: 'unknown_x', members: ['자', '오'] },
    });
    const ctx = baseCtx({ dayBranch: '오' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: sibiunsung ──────────────────────────

describe('evaluateTrigger - sibiunsung', () => {
  it('일간 경 기준 일운 지지의 12운성이 aux.states에 포함 → true', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/sibiunsung_lookup/.test(sql)) {
        return Promise.resolve({ rows: [{ state: '묘' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const seed = baseSeed({
      trigger_target_type: 'sibiunsung',
      trigger_aux: { states: ['사', '묘'] },
    });
    const ctx = baseCtx({ dayBranch: '축' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('lookup 결과가 aux.states에 미포함이면 false', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/sibiunsung_lookup/.test(sql)) {
        return Promise.resolve({ rows: [{ state: '제왕' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const seed = baseSeed({
      trigger_target_type: 'sibiunsung',
      trigger_aux: { states: ['사', '묘'] },
    });
    const ctx = baseCtx({ dayBranch: '유' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateMetric ───────────────────────────────────────

describe('evaluateMetric', () => {
  const baseMetric = (overrides: Partial<SajuMetric> = {}): SajuMetric => ({
    link_id: 1,
    signal_id: 1,
    pattern_id: 1,
    metric_name: 'test_metric',
    kind: 'sql',
    source: 'seed',
    expected_metric_sql: 'SELECT 1',
    expected_direction: 'above_avg',
    expected_threshold: null,
    value_type: 'continuous',
    tag_name: null,
    domain: 'schedule',
    ...overrides,
  });

  it('above_abs — todayValue >= threshold면 passed', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ count: 3 }] }));
    const metric = baseMetric({ expected_direction: 'above_abs', expected_threshold: 2 });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(true);
    expect(result.todayValue).toBe(3);
  });

  it('above_abs — todayValue < threshold면 not passed', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ count: 0 }] }));
    const metric = baseMetric({ expected_direction: 'above_abs', expected_threshold: 1 });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(false);
  });

  it('flag_present — todayValue >= 1이면 passed (기본 임계 1)', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ count: 1 }] }));
    const metric = baseMetric({
      expected_direction: 'flag_present',
      expected_threshold: 1,
      domain: 'diary_meta',
    });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(true);
  });

  it('above_avg — 오늘 값이 baseline 평균보다 크면 passed', async () => {
    // 첫 호출(오늘) 5, 이후 28일 baseline은 1씩 → 평균 1
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ rows: [{ v: 5 }] });
      return Promise.resolve({ rows: [{ v: 1 }] });
    });
    const metric = baseMetric({ expected_direction: 'above_avg' });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.todayValue).toBe(5);
    expect(result.baselineAvg).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('below_avg — 오늘 값이 baseline 평균보다 작으면 passed', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ rows: [{ v: 1 }] });
      return Promise.resolve({ rows: [{ v: 5 }] });
    });
    const metric = baseMetric({ expected_direction: 'below_avg' });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(true);
  });

  it('빈 결과는 todayValue=0 처리', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const metric = baseMetric({ expected_direction: 'above_abs', expected_threshold: 1 });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.todayValue).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('kind=tag — 그날 태그 존재하면 passed (binary, #477 P1)', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const metric = baseMetric({
      kind: 'tag',
      tag_name: 'anxiety',
      domain: 'diary_meta',
      expected_metric_sql: null,
      expected_direction: null,
    });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(true);
    expect(result.todayValue).toBe(1);
    expect(result.direction).toBe('flag_present');
  });

  it('kind=tag — 그날 태그 없으면 not passed', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const metric = baseMetric({
      kind: 'tag',
      tag_name: 'anxiety',
      domain: 'diary_meta',
      expected_metric_sql: null,
      expected_direction: null,
    });
    const result = await evaluateMetric(metric, 1, '2026-05-17');
    expect(result.passed).toBe(false);
    expect(result.todayValue).toBe(0);
  });
});

// ─── Phase 2.5: pillar_level (운 레벨) 분기 ────────────────

describe('evaluateTrigger - pillar_level (Phase 2.5)', () => {
  it('pillar_level=wolun + stem trigger — 월운 천간이 target과 일치하면 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 1, // 갑
      pillar_level: 'wolun',
    });
    const ctx = baseCtx({
      dayStem: '경', // ilun.cheongan=경
      wolun: makePillar('갑', '인'), // wolun.cheongan=갑 → trigger
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('pillar_level=wolun + stem trigger — 일운만 일치하고 월운 미일치면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 7, // 경
      pillar_level: 'wolun',
    });
    const ctx = baseCtx({
      dayStem: '경', // ilun.cheongan=경 (target과 같지만 무시)
      wolun: makePillar('갑', '인'), // wolun.cheongan=갑 → 미일치
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('pillar_level=seun + branch trigger — 세운 지지 일치 시 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'branch',
      trigger_target_id: 3, // 인
      pillar_level: 'seun',
    });
    const ctx = baseCtx({
      dayBranch: '술',
      seun: makePillar('병', '인'), // seun.jiji=인 → trigger
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('pillar_level=daeun + stem trigger — 대운 적용 시 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 1, // 갑
      pillar_level: 'daeun',
    });
    const ctx = baseCtx({
      dayStem: '경',
      daeun: makePillar('갑', '인'), // daeun.cheongan=갑 → trigger
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('pillar_level=daeun + daeun=null이면 false (미적용 구간)', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 7, // 경
      pillar_level: 'daeun',
    });
    const ctx = baseCtx({
      dayStem: '경',
      daeun: null, // 대운 미시작 / 미등록
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('pillar_level=wonguk이면 stem/branch trigger는 false (직접 매칭 불가)', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 7, // 경
      pillar_level: 'wonguk',
    });
    const ctx = baseCtx({ dayStem: '경' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('pillar_level=null이면 일운 기준 (기존 동작 유지)', async () => {
    const seed = baseSeed({
      trigger_target_type: 'stem',
      trigger_target_id: 7, // 경
      pillar_level: null,
    });
    const ctx = baseCtx({ dayStem: '경' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });
});

// ─── Phase 2.5: cumulative_pillar_count ────────────────────

describe('evaluateTrigger - cumulative_pillar_count (Phase 2.5)', () => {
  it('element 화 count_min=2 — 본명(병/정)에 화 + 월운 화 천간이면 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { element: '화', count_min: 2 },
      pillar_level: 'cumulative',
    });
    // 본명에 정(화)/오(화) 있음 → wonguk 화 +1
    // wolun.cheongan=병(화) → wolun 화 +1
    // 합계 2 ≥ 2 → true
    const ctx = baseCtx({
      natal: buildNatal({
        stems: ['정', '경', '경', '경'],
        branches: ['오', '술', '술', '술'],
        dayMaster: '경',
      }),
      wolun: makePillar('병', '자'),
      seun: makePillar('갑', '술'), // 화 없음
      ilun: makePillar('경', '술'), // 화 없음
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('element 화 count_min=3 — 화가 2개 레벨에만 있으면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { element: '화', count_min: 3 },
      pillar_level: 'cumulative',
    });
    const ctx = baseCtx({
      natal: buildNatal({
        stems: ['정', '경', '경', '경'],
        branches: ['오', '술', '술', '술'],
        dayMaster: '경',
      }),
      wolun: makePillar('병', '자'),
      seun: makePillar('갑', '술'),
      ilun: makePillar('경', '술'),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('sipsin 편재 count_min=2 — 일간 경 기준 갑(편재)이 본명+일운에서 발현', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { sipsin: '편재', count_min: 2 },
      pillar_level: 'cumulative',
    });
    // 일간 경 기준 편재 = 갑(천간) / 인(지지)
    // 본명 stems에 갑 → wonguk +1
    // ilun.cheongan=갑 → ilun +1
    // 합계 2 ≥ 2 → true
    const ctx = baseCtx({
      natal: buildNatal({
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      }),
      ilun: makePillar('갑', '술'),
      wolun: makePillar('경', '자'),
      seun: makePillar('경', '자'),
    });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('count_min<=0이면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { element: '화', count_min: 0 },
      pillar_level: 'cumulative',
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('aux에 element/sipsin 둘 다 없으면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { count_min: 1 },
      pillar_level: 'cumulative',
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('element 값이 오행이 아니면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'cumulative_pillar_count',
      trigger_aux: { element: '잘못된오행', count_min: 1 },
      pillar_level: 'cumulative',
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── evaluateTrigger: life_signal (Phase 3, ADR-0029) ──────

describe('evaluateTrigger - life_signal', () => {
  it('weekday(dow=1) 시드는 월요일 ctx에 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: { kind: 'weekday', dow: 1 },
    });
    // 2026-06-01 = 월요일
    const ctx = baseCtx({ date: '2026-06-01' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('weekday(dow=1) 시드는 화요일 ctx에 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: { kind: 'weekday', dow: 1 },
    });
    const ctx = baseCtx({ date: '2026-06-02' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('season(spring) 시드는 5월 ctx에 true', async () => {
    const seed = baseSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: { kind: 'season', season: 'spring' },
    });
    const ctx = baseCtx({ date: '2026-05-17' });
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(true);
  });

  it('잘못된 trigger_aux는 false (isLifeSignalAux 가드)', async () => {
    const seed = baseSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: { kind: 'invalid_kind' } as unknown as Record<string, unknown>,
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });

  it('trigger_aux=null이면 false', async () => {
    const seed = baseSeed({
      trigger_target_type: 'life_signal',
      trigger_aux: null,
    });
    const ctx = baseCtx();
    expect(await evaluateTrigger(seed, ctx, stemMap, branchMap)).toBe(false);
  });
});

// ─── recordDailyMatches (#477 P2 — seed_daily_activations 슬림 write) ──

describe('recordDailyMatches (#477 P2)', () => {
  const makeResult = (overrides: Partial<SeedMatchResult>): SeedMatchResult => ({
    seed: baseSeed({ id: 42 }),
    triggerActivated: false,
    metricEvaluations: [],
    matched: null,
    isEvidenceOnly: false,
    triggerError: null,
    ...overrides,
  });

  /** INSERT INTO seed_daily_activations 호출들의 params 목록 추출. */
  const findInsertCalls = (): unknown[][] =>
    mockQuery.mock.calls
      .filter(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seed_daily_activations'),
      )
      .map((call) => call[1] as unknown[]);

  it('seed_daily_activations에 trigger_activated/matched만 기록 (verify 컬럼 없음)', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = makeResult({ seed: baseSeed({ id: 7 }), triggerActivated: true, matched: false });
    await recordDailyMatches(1, '2026-05-29', [r]);

    const calls = findInsertCalls();
    expect(calls).toHaveLength(1);
    // params = [user_id, date, pattern_id, trigger_activated, matched]
    expect(calls[0]).toEqual([1, '2026-05-29', 7, true, false]);
  });

  it('matched=null(evidence-only)도 그대로 기록', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = makeResult({ triggerActivated: true, isEvidenceOnly: true, matched: null });
    await recordDailyMatches(1, '2026-05-29', [r]);

    const calls = findInsertCalls();
    expect(calls[0]?.[4]).toBeNull();
  });

  it('SQL은 metric_values·verify_status·error_message 컬럼을 쓰지 않는다', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    await recordDailyMatches(1, '2026-05-29', [makeResult({ triggerActivated: true })]);

    const call = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seed_daily_activations'),
    );
    const sql = call?.[0] as string;
    expect(sql).not.toContain('metric_values');
    expect(sql).not.toContain('verify_status');
    expect(sql).not.toContain('error_message');
  });

  it('결과 N건 → INSERT N회 호출', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const results = [
      makeResult({ seed: baseSeed({ id: 1 }), triggerActivated: true }),
      makeResult({ seed: baseSeed({ id: 2 }), triggerActivated: false }),
      makeResult({ seed: baseSeed({ id: 3 }), triggerActivated: true }),
    ];
    await recordDailyMatches(1, '2026-05-29', results);
    expect(findInsertCalls()).toHaveLength(3);
  });
});

describe('LLM 신호 실행 격리 (#477 P5b, ADR-0040)', () => {
  describe('runnerForSource — source별 실행기 디스패치', () => {
    it("source='llm'은 runLlmSignalSql(격리), 'seed'는 runMetricSql(신뢰)", () => {
      expect(runnerForSource('llm')).toBe(runLlmSignalSql);
      expect(runnerForSource('seed')).toBe(runMetricSql);
    });
  });

  describe('runLlmSignalSql — 게이트 #2 (재검증 + read-only 실행)', () => {
    it('검증 실패 SQL은 실행 전 throw (DB 미접근)', async () => {
      await expect(
        runLlmSignalSql('SELECT sum(value) FROM assets WHERE user_id = $1', 1, '2026-06-06'),
      ).rejects.toThrow(/검증 실패/);
      expect(mockQuery).not.toHaveBeenCalled(); // 데이터 쿼리 미실행
    });

    it('쓰기 시도(DML) SQL도 검증 게이트에서 차단(read-only 도달 전)', async () => {
      await expect(
        runLlmSignalSql('DELETE FROM schedules WHERE user_id = $1', 1, '2026-06-06'),
      ).rejects.toThrow(/검증 실패/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('검증 통과 SQL은 read-only TX로 실행되어 단일 숫자 반환', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 4 }], rowCount: 1 });
      const v = await runLlmSignalSql(
        'SELECT count(*) AS cnt FROM schedules WHERE user_id = $1 AND date = $2',
        1,
        '2026-06-06',
      );
      expect(v).toBe(4);
      // $1/$2 치환 후 데이터 쿼리가 mockQuery에 도달(제어문은 mock에서 통과 처리).
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const issued = mockQuery.mock.calls[0]?.[0] as string;
      expect(issued).toContain('FROM schedules');
      expect(issued).not.toContain('$1'); // userId 치환됨
    });
  });

  describe("evaluateMetric — source='llm' 분기", () => {
    it('llm 신호는 격리 경로로 todayValue를 얻는다(절대 임계)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ v: 2 }], rowCount: 1 });
      const metric: SajuMetric = {
        link_id: 1,
        signal_id: 1,
        pattern_id: 1,
        metric_name: 'llm_test',
        kind: 'sql',
        source: 'llm',
        expected_metric_sql: 'SELECT count(*) AS v FROM expenses WHERE user_id = $1 AND date = $2',
        expected_direction: 'above_abs',
        expected_threshold: 1,
        value_type: 'continuous',
        tag_name: null,
        domain: 'expense',
      };
      const ev = await evaluateMetric(metric, 1, '2026-06-06');
      expect(ev.todayValue).toBe(2);
      expect(ev.passed).toBe(true); // 2 >= 1
    });
  });
});
