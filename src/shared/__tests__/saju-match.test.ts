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
  __resetCacheForTest,
  type SajuSeedWithMetrics,
  type DailyContext,
  type SeedMatchResult,
  type SajuMetric,
} from '../saju-match.js';

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
  active: true,
  source: 'seed',
  hit_count: 0,
  miss_count: 0,
  inconclusive_count: 0,
  metrics: [],
  ...overrides,
});

const baseCtx = (overrides: Partial<DailyContext> = {}): DailyContext => ({
  date: '2026-05-17',
  dayStem: '경',
  dayBranch: '술',
  natal: {
    stems: ['갑', '경', '경', '경'],
    branches: ['자', '술', '술', '술'],
    dayMaster: '경',
  },
  ...overrides,
});

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
      natal: {
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '축', '신', '유'], // 진 없음
        dayMaster: '경',
      },
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
      natal: {
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      },
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
      natal: {
        stems: ['갑', '경', '경', '경'],
        branches: ['오', '술', '술', '술'],
        dayMaster: '경',
      },
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
      natal: {
        stems: ['갑', '경', '경', '경'],
        branches: ['신', '술', '술', '술'], // 자/오 둘 다 없음
        dayMaster: '경',
      },
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
      natal: {
        stems: ['갑', '경', '경', '경'],
        branches: ['자', '술', '술', '술'],
        dayMaster: '경',
      },
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
    name: string,
    sipsin: string | null,
    matched: boolean,
    hitCount: number,
    passedDomains: string[] = ['schedule'],
  ): SeedMatchResult => ({
    seed: baseSeed({ name, sipsin, hit_count: hitCount }),
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
  });

  it('matched 시드 없으면 null', () => {
    const results = [buildResult('S1', '편재', false, 5)];
    expect(compactMatchedLine(ctx, results)).toBeNull();
  });

  it('matched 시드 1개 — 일운 + 시드 한 줄 포맷', () => {
    const results = [buildResult('S1_갑목_편재_천간', '편재', true, 5)];
    const line = compactMatchedLine(ctx, results);
    expect(line).toContain('오늘 일운 경술');
    expect(line).toContain('편재');
    expect(line).toContain('schedule');
  });

  it('최대 3개까지만 노출, hit_count 높은 순', () => {
    const results = [
      buildResult('S1', '편재', true, 2),
      buildResult('S2', '식신', true, 10),
      buildResult('S3', '정인', true, 5),
      buildResult('S4', '비견', true, 8),
    ];
    const line = compactMatchedLine(ctx, results);
    expect(line).toContain('식신'); // hit_count 10 (1순위)
    expect(line).toContain('비견'); // hit_count 8 (2순위)
    expect(line).toContain('정인'); // hit_count 5 (3순위)
    expect(line).not.toContain('편재'); // hit_count 2 → cap
  });

  it('sipsin 없으면 name으로 대체', () => {
    const results = [buildResult('S5_토_과다', null, true, 3)];
    const line = compactMatchedLine(ctx, results);
    expect(line).toContain('S5_토_과다');
  });
});
