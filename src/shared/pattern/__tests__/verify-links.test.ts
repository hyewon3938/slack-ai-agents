import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SajuSeedWithMetrics } from '../match-types.js';
import type { SignalSeriesResult } from '../series.js';

// ─── fixtures ────────────────────────────────────────────
interface LinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
  status: 'active';
  source: string;
  created_date: string | null;
}
interface SignalRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: string | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
  domain: string | null;
  description: string | null;
}

let links: LinkRow[];
let seeds: SajuSeedWithMetrics[];
let signals: SignalRow[];
let dataStartByTable: Map<string, string>;

const reset = (): void => {
  links = [];
  seeds = [];
  signals = [];
  dataStartByTable = new Map();
};
reset();

vi.mock('../../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (/FROM pattern_links l/i.test(sql)) return { rows: links };
    if (/FROM signal_defs/i.test(sql) && /ANY\(\$1::int\[\]\)/i.test(sql)) {
      const ids = (params?.[0] ?? []) as number[];
      return { rows: signals.filter((s) => ids.includes(s.id)) };
    }
    const minDate = /MIN\(date\)::text AS d FROM (\w+)/i.exec(sql);
    if (minDate) return { rows: [{ d: dataStartByTable.get(minDate[1] ?? '') ?? null }] };
    if (/MIN\(DATE\(changed_at/i.test(sql)) return { rows: [{ d: null }] };
    throw new Error(`[fixture] unexpected SQL: ${sql.slice(0, 60)}`);
  }),
}));

vi.mock('../match-seeds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-seeds.js')>();
  return { ...actual, loadActiveSeeds: vi.fn(async () => seeds) };
});

vi.mock('../match-day.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-day.js')>();
  return { ...actual, buildNameIdMap: vi.fn(async () => new Map<string, number>()) };
});

// 시리즈 계산은 DB·사주 계산 경계 — 빈 시리즈를 돌려주고 호출 인자만 본다.
vi.mock('../series.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../series.js')>();
  return {
    ...actual,
    computeSignalSeries: vi.fn(
      async (): Promise<SignalSeriesResult> => ({ series: new Map(), raw: null }),
    ),
    computeSeedActivationSeries: vi.fn(async (): Promise<Map<string, boolean>> => new Map()),
  };
});

const { verifyUserLinks } = await import('../verify-links.js');
const { loadActiveSeeds } = await import('../match-seeds.js');
const { computeSignalSeries, computeSeedActivationSeries } = await import('../series.js');

// ─── helpers ─────────────────────────────────────────────
const TODAY = '2026-03-01';

const makeLink = (linkId: number, seedId: number, signalId: number): LinkRow => ({
  link_id: linkId,
  seed_id: seedId,
  signal_id: signalId,
  status: 'active',
  source: 'manual',
  created_date: null,
});

const makeSeed = (id: number): SajuSeedWithMetrics => ({
  id,
  user_id: 1,
  name: `seed_${id}`,
  sipsin: null,
  description: `시드 ${id}`,
  trigger_target_type: 'stem',
  trigger_target_id: null,
  trigger_aux: null,
  pillar_level: null,
  active: true,
  source: 'seed',
  metrics: [],
});

const makeSignalRow = (id: number, over: Partial<SignalRow> = {}): SignalRow => ({
  id,
  name: `signal_${id}`,
  kind: 'sql',
  source: 'seed',
  sql_body: 'SELECT 1',
  value_type: 'binary',
  direction: 'above_abs',
  threshold: null,
  tag_name: null,
  window_days: null,
  domain: 'sleep',
  description: null,
  ...over,
});

const seedIdsComputed = (): number[] =>
  vi.mocked(computeSeedActivationSeries).mock.calls.map(([seed]) => seed.id);
const signalIdsComputed = (): number[] =>
  vi.mocked(computeSignalSeries).mock.calls.map(([, signal]) => signal.id);

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

// ─── tests ───────────────────────────────────────────────

describe('verifyUserLinks', () => {
  it('active 링크가 없으면 시드·신호를 읽지 않고 빈 배열을 돌려준다', async () => {
    expect(await verifyUserLinks(1, TODAY)).toEqual([]);
    expect(loadActiveSeeds).not.toHaveBeenCalled();
    expect(computeSignalSeries).not.toHaveBeenCalled();
  });

  it('활성 시드 목록에 없는 시드의 링크는 결과에서 빠지고 그 시드 시리즈도 계산하지 않는다', async () => {
    links = [makeLink(1, 1, 10), makeLink(2, 2, 10)];
    seeds = [makeSeed(1)];
    signals = [makeSignalRow(10)];

    const out = await verifyUserLinks(1, TODAY);

    expect(out.map((l) => l.linkId)).toEqual([1]);
    expect(seedIdsComputed()).toEqual([1]);
  });

  it('여러 링크가 같은 시드를 쓰면 시드 시리즈는 한 번만 계산한다', async () => {
    links = [makeLink(1, 1, 10), makeLink(2, 1, 11), makeLink(3, 2, 10)];
    seeds = [makeSeed(1), makeSeed(2)];
    signals = [makeSignalRow(10), makeSignalRow(11)];

    const out = await verifyUserLinks(1, TODAY);

    expect(out.map((l) => l.linkId)).toEqual([1, 2, 3]);
    expect(seedIdsComputed()).toEqual([1, 2]);
  });

  it('여러 링크가 같은 신호를 쓰면 신호 시리즈는 한 번만 계산한다', async () => {
    links = [makeLink(1, 1, 10), makeLink(2, 2, 10), makeLink(3, 1, 11)];
    seeds = [makeSeed(1), makeSeed(2)];
    signals = [makeSignalRow(10), makeSignalRow(11)];

    await verifyUserLinks(1, TODAY);

    expect(signalIdsComputed()).toEqual([10, 11]);
  });

  it('threshold 문자열을 숫자로 바꿔 시리즈 계산과 라벨에 넘긴다', async () => {
    links = [makeLink(1, 1, 10)];
    seeds = [makeSeed(1)];
    signals = [makeSignalRow(10, { threshold: '2.50' })];

    const [l] = await verifyUserLinks(1, TODAY);

    const [, signal] = vi.mocked(computeSignalSeries).mock.calls[0] ?? [];
    expect(signal?.threshold).toBe(2.5);
    expect(l?.signalLabel).toContain('2.5회 이상');
  });

  it('신호 시리즈 계산에 그 신호 도메인의 첫 기록일을 시작일로 넘긴다', async () => {
    links = [makeLink(1, 1, 10), makeLink(2, 1, 11)];
    seeds = [makeSeed(1)];
    signals = [makeSignalRow(10, { domain: 'sleep' }), makeSignalRow(11, { domain: 'expense' })];
    dataStartByTable = new Map([
      ['sleep_records', '2026-02-10'],
      ['expenses', '2026-01-20'],
    ]);

    await verifyUserLinks(1, TODAY);

    const startBySignal = new Map(
      vi.mocked(computeSignalSeries).mock.calls.map(([, signal, , start]) => [signal.id, start]),
    );
    expect(startBySignal).toEqual(
      new Map([
        [10, '2026-02-10'],
        [11, '2026-01-20'],
      ]),
    );
  });
});
