import { describe, it, expect, vi, beforeEach } from 'vitest';

interface QueryResult<T> {
  rows: T[];
}

type QueryArgs = readonly unknown[];

interface FixtureSignal {
  id: number;
  name: string;
  pattern_kind: 'saju' | 'life_signal';
}

interface FixtureTriggerRow {
  pattern_id: number;
  date: string;
}

interface FixtureEnumRow {
  tag: string;
  date: string;
}

interface Fixture {
  signals: FixtureSignal[];
  triggerRows: FixtureTriggerRow[];
  enumRows: FixtureEnumRow[];
  totalDays: number;
}

let fixture: Fixture = {
  signals: [],
  triggerRows: [],
  enumRows: [],
  totalDays: 0,
};

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async (sql: string, _params?: QueryArgs): Promise<QueryResult<unknown>> => {
    if (/FROM pattern_catalog\b/i.test(sql) && /\bactive = true\b/i.test(sql)) {
      return { rows: fixture.signals };
    }
    if (/FROM pattern_matches\b/i.test(sql)) {
      return { rows: fixture.triggerRows };
    }
    if (/FROM diary_meta_tags\b/i.test(sql)) {
      return { rows: fixture.enumRows };
    }
    if (/DATE\(\$2\) - DATE\(\$1\)/.test(sql)) {
      return { rows: [{ days: String(fixture.totalDays) }] };
    }
    if (/FROM pattern_hypotheses\b/i.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`[fixture] unexpected SQL: ${sql.slice(0, 80)}`);
  }),
}));

const { discoverCandidates } = await import('../hypothesis-discovery.js');

const isoDate = (offsetDays: number): string => {
  const base = new Date('2026-05-01T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
};

describe('discoverCandidates — patternKind 전파', () => {
  beforeEach(() => {
    fixture = {
      signals: [],
      triggerRows: [],
      enumRows: [],
      totalDays: 0,
    };
  });

  it('saju + life_signal 시드가 섞여 있으면 결과 후보에 둘 다 patternKind가 채워진다', async () => {
    fixture.totalDays = 28;
    fixture.signals = [
      { id: 1, name: '갑목일주', pattern_kind: 'saju' },
      { id: 2, name: '저녁 운동', pattern_kind: 'life_signal' },
    ];
    // saju: 8 trigger days, 그중 7일에 enum 발현 → trigger rate 7/8, baseline (1/20)
    // life_signal: 8 trigger days, 그중 6일에 enum 발현 → trigger rate 6/8, baseline (2/20)
    const sajuTriggerDays = Array.from({ length: 8 }, (_, i) => isoDate(i));
    const lifeTriggerDays = Array.from({ length: 8 }, (_, i) => isoDate(i + 10));
    for (const d of sajuTriggerDays) {
      fixture.triggerRows.push({ pattern_id: 1, date: d });
    }
    for (const d of lifeTriggerDays) {
      fixture.triggerRows.push({ pattern_id: 2, date: d });
    }
    // saju enum 발현: trigger 8일 중 7일 + baseline 20일 중 1일
    const sajuEnumOnTrigger = sajuTriggerDays.slice(0, 7);
    const sajuEnumOnBaseline = [isoDate(20)];
    // life_signal enum 발현: trigger 8일 중 6일 + baseline 20일 중 2일
    const lifeEnumOnTrigger = lifeTriggerDays.slice(0, 6);
    const lifeEnumOnBaseline = [isoDate(22), isoDate(23)];
    // 같은 enum_target 한 종류만 발현(테스트 단순화) — energy_high
    for (const d of [...sajuEnumOnTrigger, ...sajuEnumOnBaseline]) {
      fixture.enumRows.push({ tag: 'mood_high', date: d });
    }
    for (const d of [...lifeEnumOnTrigger, ...lifeEnumOnBaseline]) {
      // saju가 발현시킨 날과 겹칠 수 있지만 enum dedup은 set에서 자동 처리
      fixture.enumRows.push({ tag: 'peaceful', date: d });
    }

    const candidates = await discoverCandidates(1, { mode: 'setup', lookbackDays: 28 });

    expect(candidates.length).toBeGreaterThan(0);
    const sajuCand = candidates.find((c) => c.signalName === '갑목일주');
    const lifeCand = candidates.find((c) => c.signalName === '저녁 운동');
    expect(sajuCand?.patternKind).toBe('saju');
    expect(lifeCand?.patternKind).toBe('life_signal');
  });

  it('signals 빈 배열이면 후보도 빈 배열', async () => {
    fixture.totalDays = 28;
    const candidates = await discoverCandidates(1, { mode: 'setup', lookbackDays: 28 });
    expect(candidates).toEqual([]);
  });
});
