import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DailyContext,
  MetricEvaluation,
  SajuMetric,
  SajuSeedWithMetrics,
} from '../match-types.js';
import type { SignalDef } from '../types.js';

// SQL 도구 전용 연결 거절 시 LLM 신호 건너뛰기 (#665).
// 거절은 결측(null)·미발현(false)으로 바뀌지 않고, 로그는 실행 단계마다 한 번만 남는다.

let seeds: SajuSeedWithMetrics[];

vi.mock('../../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db.js')>();
  return { ...actual, query: vi.fn(async () => ({ rows: [] })) };
});

vi.mock('../match-metric.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-metric.js')>();
  return {
    ...actual,
    runLlmSignalSql: vi.fn(),
    runMetricSql: vi.fn(async () => 1),
    evaluateMetric: vi.fn(),
  };
});

vi.mock('../match-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-context.js')>();
  return { ...actual, getDailyContext: vi.fn(async () => ({}) as DailyContext) };
});

vi.mock('../match-seeds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-seeds.js')>();
  return { ...actual, loadActiveSeeds: vi.fn(async () => seeds) };
});

vi.mock('../match-trigger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-trigger.js')>();
  return { ...actual, evaluateTrigger: vi.fn(async () => true) };
});

const { SqlToolUnavailableError } = await import('../../db.js');
const { runLlmSignalSql, evaluateMetric } = await import('../match-metric.js');
const { computeSignalSeries } = await import('../series.js');
const { matchAllSeedsForDay } = await import('../match-day.js');

const DATES = ['2026-01-01', '2026-01-02', '2026-01-03'];

const llmSignal: SignalDef = {
  id: 1,
  name: 'llm_signal',
  kind: 'sql',
  source: 'llm',
  sqlBody: 'SELECT 1',
  valueType: 'continuous',
  direction: 'above_abs',
  threshold: 1,
  tagName: null,
  windowDays: null,
  domain: 'sleep',
};

const metric = (name: string, source: 'seed' | 'llm'): SajuMetric =>
  ({ metric_name: name, source, kind: 'sql' }) as SajuMetric;

const evaluation = (name: string, passed: boolean): MetricEvaluation => ({
  metric_name: name,
  domain: 'sleep',
  todayValue: passed ? 1 : 0,
  baselineAvg: null,
  threshold: 1,
  direction: 'above_abs',
  passed,
});

const seed = (id: number, metrics: SajuMetric[]): SajuSeedWithMetrics =>
  ({ id, name: `seed_${id}`, metrics }) as SajuSeedWithMetrics;

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  seeds = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeSignalSeries — 도구 연결 거절', () => {
  it('거절은 결측으로 바꾸지 않고 그대로 던진다', async () => {
    vi.mocked(runLlmSignalSql).mockRejectedValue(new SqlToolUnavailableError());

    await expect(computeSignalSeries(1, llmSignal, DATES)).rejects.toBeInstanceOf(
      SqlToolUnavailableError,
    );
  });

  it('그 밖의 실행 오류는 기존대로 그날 결측(null)', async () => {
    vi.mocked(runLlmSignalSql).mockRejectedValue(new Error('timeout'));

    const { raw } = await computeSignalSeries(1, llmSignal, DATES);

    expect([...(raw?.values() ?? [])]).toEqual([null, null, null]);
  });
});

describe('matchAllSeedsForDay — 도구 연결 거절', () => {
  const rejectLlm = (m: SajuMetric): Promise<MetricEvaluation> =>
    m.source === 'llm'
      ? Promise.reject(new SqlToolUnavailableError())
      : Promise.resolve(evaluation(m.metric_name, m.metric_name.endsWith('_pass')));

  it('LLM 신호만 남고 통과가 없으면 matched=false가 아니라 null(미채점), 로그는 한 번', async () => {
    seeds = [
      seed(1, [metric('a', 'llm'), metric('b', 'llm')]),
      seed(2, [metric('c', 'llm'), metric('d_fail', 'seed')]),
    ];
    vi.mocked(evaluateMetric).mockImplementation(rejectLlm);

    const results = await matchAllSeedsForDay(1, '2026-01-01');

    expect(results.map((r) => [r.triggerActivated, r.matched])).toEqual([
      [true, null],
      [true, null],
    ]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('LLM 신호 3개');
  });

  it('다른 metric이 통과하면 matched=true, 거절이 없으면 로그 없음', async () => {
    seeds = [
      seed(1, [metric('a', 'llm'), metric('b_pass', 'seed')]),
      seed(2, [metric('c_fail', 'seed')]),
    ];
    vi.mocked(evaluateMetric).mockImplementation(rejectLlm);

    const results = await matchAllSeedsForDay(1, '2026-01-01');
    expect(results.map((r) => r.matched)).toEqual([true, false]);
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockClear();
    seeds = [seed(2, [metric('c_fail', 'seed')])];
    await matchAllSeedsForDay(1, '2026-01-01');
    expect(errSpy).not.toHaveBeenCalled();
  });
});
