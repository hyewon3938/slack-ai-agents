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
  compactMatchedLine,
  verifyDailyMatches,
  recordDailyMatches,
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
        // SET statement_timeout 류는 무시 — 데이터 쿼리만 mockQuery로 위임
        if (typeof sql === 'string' && /^\s*SET\s+statement_timeout/i.test(sql)) {
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
    id: 1,
    pattern_id: 1,
    metric_name: 'test_metric',
    expected_metric_sql: 'SELECT 1',
    expected_direction: 'above_avg',
    expected_threshold: null,
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
});

// ─── compactMatchedLine ───────────────────────────────────

describe('compactMatchedLine', () => {
  const ctx = baseCtx({ dayStem: '경', dayBranch: '술' });

  const buildResult = (
    id: number,
    name: string,
    sipsin: string | null,
    matched: boolean,
    passedDomains: string[] = ['schedule'],
  ): SeedMatchResult => ({
    seed: baseSeed({ id, name, sipsin }),
    triggerActivated: true,
    metricEvaluations: passedDomains.map((d) => ({
      metric_name: `${d}_x`,
      domain: d,
      todayValue: 1,
      baselineAvg: 0,
      threshold: null,
      direction: 'above_abs',
      passed: true,
    })),
    matched,
    isEvidenceOnly: false,
    triggerError: null,
  });

  /** pattern_summary view에서 pattern_id → total_hits 반환을 mock. */
  const mockSummary = (hitsById: Record<number, number>): void => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('pattern_summary')) {
        return Promise.resolve({
          rows: Object.entries(hitsById).map(([id, hits]) => ({
            pattern_id: Number(id),
            total_hits: String(hits),
          })),
        });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('matched 시드 없으면 null', async () => {
    mockSummary({});
    const results = [buildResult(1, 'S1', '편재', false)];
    expect(await compactMatchedLine(ctx, results)).toBeNull();
  });

  it('matched 시드 1개 — 일운 + 시드 한 줄 포맷', async () => {
    mockSummary({ 1: 5 });
    const results = [buildResult(1, 'S1_갑목_편재_천간', '편재', true)];
    const line = await compactMatchedLine(ctx, results);
    expect(line).toContain('오늘 일운 경술');
    expect(line).toContain('편재');
    expect(line).toContain('schedule');
  });

  it('최대 3개까지만 노출, pattern_summary.total_hits 높은 순', async () => {
    mockSummary({ 1: 2, 2: 10, 3: 5, 4: 8 });
    const results = [
      buildResult(1, 'S1', '편재', true),
      buildResult(2, 'S2', '식신', true),
      buildResult(3, 'S3', '정인', true),
      buildResult(4, 'S4', '비견', true),
    ];
    const line = await compactMatchedLine(ctx, results);
    expect(line).toContain('식신'); // total_hits 10 (1순위)
    expect(line).toContain('비견'); // total_hits 8 (2순위)
    expect(line).toContain('정인'); // total_hits 5 (3순위)
    expect(line).not.toContain('편재'); // total_hits 2 → cap
  });

  it('sipsin 없으면 name으로 대체', async () => {
    mockSummary({ 5: 3 });
    const results = [buildResult(5, 'S5_토_과다', null, true)];
    const line = await compactMatchedLine(ctx, results);
    expect(line).toContain('S5_토_과다');
  });

  it('pattern_summary에 행 없으면 total_hits=0으로 취급 (정렬 동률)', async () => {
    mockSummary({}); // 빈 view 결과
    const results = [buildResult(1, 'S1', '편재', true), buildResult(2, 'S2', '식신', true)];
    const line = await compactMatchedLine(ctx, results);
    // 둘 다 동률 — 입력 순서대로 유지되는지만 확인 (cap 3 미만)
    expect(line).toContain('편재');
    expect(line).toContain('식신');
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

// ─── Phase 4: verifyDailyMatches (matched 카운터 + Bayesian posterior) ─────

describe('verifyDailyMatches (Phase 4)', () => {
  /**
   * verifyDailyMatches 호출은 SELECT 2건 + UPDATE 다수 패턴.
   * mockQuery에 순차적 응답을 등록하고 호출 인자를 검증.
   */

  it('hit 매칭은 pattern_metrics hit_count + posterior_alpha UPDATE', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("verify_status = 'pending'") && sql.includes('trigger_activated = true')) {
        return Promise.resolve({ rows: [{ id: 100, pattern_id: 7, matched: true }] });
      }
      if (sql.includes("verify_status = 'pending'") && sql.includes('OR matched IS NULL')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await verifyDailyMatches(1);

    const calls = mockQuery.mock.calls;
    // UPDATE pattern_matches verify_status='hit'
    const matchUpdate = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE pattern_matches') &&
        sql.includes('verify_status') &&
        Array.isArray(params) &&
        params[0] === 'hit',
    );
    expect(matchUpdate).toBeDefined();

    // UPDATE pattern_metrics hit_count + posterior_alpha
    const metricUpdate = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE pattern_metrics') &&
        sql.includes('hit_count       = hit_count + 1') &&
        sql.includes('posterior_alpha = posterior_alpha + 1.0') &&
        Array.isArray(params) &&
        params[0] === 7,
    );
    expect(metricUpdate).toBeDefined();
  });

  it('miss 매칭은 pattern_metrics miss_count + posterior_beta UPDATE', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("verify_status = 'pending'") && sql.includes('trigger_activated = true')) {
        return Promise.resolve({ rows: [{ id: 101, pattern_id: 8, matched: false }] });
      }
      if (sql.includes("verify_status = 'pending'") && sql.includes('OR matched IS NULL')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await verifyDailyMatches(1);

    const calls = mockQuery.mock.calls;
    const metricUpdate = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE pattern_metrics') &&
        sql.includes('miss_count      = miss_count + 1') &&
        sql.includes('posterior_beta  = posterior_beta + 1.0') &&
        Array.isArray(params) &&
        params[0] === 8,
    );
    expect(metricUpdate).toBeDefined();
  });

  it('evidence-only (matched IS NULL)는 SELECT 1에서 제외되어 카운터 UPDATE 안 함', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("verify_status = 'pending'") && sql.includes('trigger_activated = true')) {
        // matched IS NOT NULL 필터로 인해 빈 결과
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("verify_status = 'pending'") && sql.includes('OR matched IS NULL')) {
        // evidence-only 1건
        return Promise.resolve({ rows: [{ id: 200, pattern_id: 9, matched: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await verifyDailyMatches(1);

    const calls = mockQuery.mock.calls;
    const metricUpdate = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE pattern_metrics'),
    );
    expect(metricUpdate).toBeUndefined();

    // verify_status='inconclusive' UPDATE는 실행되어야 함
    const inconclusiveUpdate = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE pattern_matches') &&
        sql.includes("verify_status = 'inconclusive'") &&
        Array.isArray(params) &&
        params[0] === 200,
    );
    expect(inconclusiveUpdate).toBeDefined();
  });

  it('trigger_off (matched IS NOT NULL but trigger_activated=false)는 inconclusive_count UPDATE', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("verify_status = 'pending'") && sql.includes('trigger_activated = true')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("verify_status = 'pending'") && sql.includes('OR matched IS NULL')) {
        return Promise.resolve({ rows: [{ id: 300, pattern_id: 10, matched: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await verifyDailyMatches(1);

    const calls = mockQuery.mock.calls;
    const inconclusiveCounter = calls.find(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE pattern_metrics') &&
        sql.includes('inconclusive_count = inconclusive_count + 1') &&
        Array.isArray(params) &&
        params[0] === 10,
    );
    expect(inconclusiveCounter).toBeDefined();
  });

  it('pending 없으면 UPDATE 호출 0회', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    await verifyDailyMatches(1);

    const updates = mockQuery.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        (sql.includes('UPDATE pattern_matches') || sql.includes('UPDATE pattern_metrics')),
    );
    expect(updates.length).toBe(0);
  });
});

// ─── recordDailyMatches (Phase 8a) ───────────────────────

describe('recordDailyMatches (Phase 8a)', () => {
  const makeResult = (overrides: Partial<SeedMatchResult>): SeedMatchResult => ({
    seed: baseSeed({ id: 42 }),
    triggerActivated: false,
    metricEvaluations: [],
    matched: null,
    isEvidenceOnly: false,
    triggerError: null,
    ...overrides,
  });

  /** INSERT INTO pattern_matches 호출 1건의 params 추출. */
  const findInsertParams = (): unknown[] | null => {
    const call = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO pattern_matches'),
    );
    return call ? (call[1] as unknown[]) : null;
  };

  it('triggerError truthy → verify_status=error + error_message JSONB INSERT', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = makeResult({ triggerError: 'column "wake_at" does not exist' });
    await recordDailyMatches(1, '2026-05-29', [r]);

    const params = findInsertParams();
    expect(params).not.toBeNull();
    expect(params?.[6]).toBe('error');
    const errorJson = params?.[7] as string;
    expect(errorJson).not.toBeNull();
    expect(JSON.parse(errorJson)).toEqual({ reason: 'column "wake_at" does not exist' });
  });

  it('triggerError null + isEvidenceOnly → verify_status=no_metric + error_message=null', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = makeResult({ triggerActivated: true, isEvidenceOnly: true, triggerError: null });
    await recordDailyMatches(1, '2026-05-29', [r]);

    const params = findInsertParams();
    expect(params?.[6]).toBe('no_metric');
    expect(params?.[7]).toBeNull();
  });

  it('triggerError null + metric 있음 → verify_status=pending + error_message=null', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = makeResult({
      triggerActivated: true,
      isEvidenceOnly: false,
      matched: false,
      triggerError: null,
    });
    await recordDailyMatches(1, '2026-05-29', [r]);

    const params = findInsertParams();
    expect(params?.[6]).toBe('pending');
    expect(params?.[7]).toBeNull();
  });
});
