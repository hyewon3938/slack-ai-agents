import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignalDef } from '../pattern-verification.js';
import type { MeasuredCell } from '../period-interpretation.js';

// ─── 인메모리 DB 페이크 (period_forecasts 테이블 + pattern_links 대표 링크) ──
// generate/score/load는 query()를 SQL 형태로 분기 — 멱등·동결·채점 분기를 실DB 없이 검증.

interface Row {
  id: number;
  user_id: number;
  period_type: string;
  period_start: string;
  period_end: string;
  signal_id: number | null;
  status: string;
  predicted_direction: string | null;
  baseline_rate: number | null;
  source_cell: unknown;
  measured_rate: number | null;
  measured_delta: number | null;
  direction_hit: boolean | null;
}

interface RepLink {
  signal_id: number;
  n_active: number;
  rate_off: number | null;
}

const dbState = {
  table: [] as Row[],
  nextId: 1,
  repLinks: new Map<number, RepLink>(),
  signalDefs: new Map<number, SignalDef>(),
  seriesBySignal: new Map<number, Map<string, boolean | null>>(),
};

const forecastCols = (r: Row): Record<string, unknown> => ({
  signal_id: r.signal_id,
  status: r.status,
  predicted_direction: r.predicted_direction,
  baseline_rate: r.baseline_rate,
  source_cell: r.source_cell,
  measured_rate: r.measured_rate,
  measured_delta: r.measured_delta,
  direction_hit: r.direction_hit,
});

function handleQuery(sql: string, params: ReadonlyArray<unknown>): { rows: unknown[] } {
  const t = dbState.table;

  // resolveRepresentative
  if (sql.includes('FROM pattern_links')) {
    const ids = (params[0] as number[]) ?? [];
    const rows = ids
      .map((id) => dbState.repLinks.get(id))
      .filter((r): r is RepLink => r !== undefined)
      .map((r) => ({ signal_id: r.signal_id, n_active: r.n_active, rate_off: r.rate_off }));
    return { rows };
  }

  // loadForecastsForPeriod (멱등 가드)
  if (
    sql.includes('FROM period_forecasts') &&
    sql.includes('period_start = $3') &&
    sql.includes("status IN ('open', 'no_call')")
  ) {
    const [user, type, start] = params as [number, string, string];
    const rows = t.filter(
      (r) =>
        r.user_id === user &&
        r.period_type === type &&
        r.period_start === start &&
        (r.status === 'open' || r.status === 'no_call'),
    );
    return { rows: rows.map(forecastCols) };
  }

  // scoreForecasts open 로드
  if (sql.includes("status = 'open' AND period_end <= $3")) {
    const [user, type, today] = params as [number, string, string];
    const rows = t.filter(
      (r) =>
        r.user_id === user &&
        r.period_type === type &&
        r.status === 'open' &&
        r.period_end <= today,
    );
    return {
      rows: rows.map((r) => ({
        id: r.id,
        period_start: r.period_start,
        period_end: r.period_end,
        signal_id: r.signal_id,
        predicted_direction: r.predicted_direction,
        baseline_rate: r.baseline_rate,
        source_cell: r.source_cell,
      })),
    };
  }

  // loadLatestEntries
  if (sql.includes('status = ANY($3::text[])') && sql.includes('MAX(period_start)')) {
    const [user, type, statuses] = params as [number, string, string[]];
    const matching = t.filter(
      (r) => r.user_id === user && r.period_type === type && statuses.includes(r.status),
    );
    const maxStart = matching.reduce<string | null>(
      (m, r) => (m === null || r.period_start > m ? r.period_start : m),
      null,
    );
    const rows = matching.filter((r) => r.period_start === maxStart);
    return { rows: rows.map(forecastCols) };
  }

  // INSERT open
  if (sql.includes('INSERT INTO period_forecasts') && sql.includes("'open'")) {
    const [user, type, start, end, signalId, direction, baseline, cellJson] = params as [
      number,
      string,
      string,
      string,
      number,
      string,
      number,
      string,
    ];
    const dup = t.some(
      (r) =>
        r.user_id === user &&
        r.period_type === type &&
        r.period_start === start &&
        r.signal_id === signalId,
    );
    if (!dup) {
      t.push({
        id: dbState.nextId++,
        user_id: user,
        period_type: type,
        period_start: start,
        period_end: end,
        signal_id: signalId,
        status: 'open',
        predicted_direction: direction,
        baseline_rate: baseline,
        source_cell: JSON.parse(cellJson),
        measured_rate: null,
        measured_delta: null,
        direction_hit: null,
      });
    }
    return { rows: [] };
  }

  // INSERT no_call
  if (sql.includes('INSERT INTO period_forecasts') && sql.includes("'no_call'")) {
    const [user, type, start, end, reasonJson] = params as [number, string, string, string, string];
    const dup = t.some(
      (r) =>
        r.user_id === user &&
        r.period_type === type &&
        r.period_start === start &&
        r.status === 'no_call',
    );
    if (!dup) {
      t.push({
        id: dbState.nextId++,
        user_id: user,
        period_type: type,
        period_start: start,
        period_end: end,
        signal_id: null,
        status: 'no_call',
        predicted_direction: null,
        baseline_rate: null,
        source_cell: JSON.parse(reasonJson),
        measured_rate: null,
        measured_delta: null,
        direction_hit: null,
      });
    }
    return { rows: [] };
  }

  // UPDATE scored
  if (sql.includes("SET status = 'scored'")) {
    const [id, mRate, mDelta, hit] = params as [number, number, number, boolean];
    const r = t.find((x) => x.id === id && x.status === 'open');
    if (r) {
      r.status = 'scored';
      r.measured_rate = mRate;
      r.measured_delta = mDelta;
      r.direction_hit = hit;
    }
    return { rows: [] };
  }

  // UPDATE unmeasurable
  if (sql.includes("SET status = 'unmeasurable'")) {
    const [id] = params as [number];
    const r = t.find((x) => x.id === id && x.status === 'open');
    if (r) r.status = 'unmeasurable';
    return { rows: [] };
  }

  throw new Error(`mock 미처리 SQL: ${sql.slice(0, 80)}`);
}

vi.mock('../db.js', () => ({
  query: vi.fn((sql: string, params: ReadonlyArray<unknown> = []) =>
    Promise.resolve(handleQuery(sql, params)),
  ),
}));

vi.mock('../pattern-verification.js', () => ({
  computeSignalSeries: vi.fn((_userId: number, signal: { id: number }) =>
    Promise.resolve({ series: dbState.seriesBySignal.get(signal.id) ?? new Map(), raw: null }),
  ),
  computeUserDataStarts: vi.fn(() => Promise.resolve({ byTable: new Map(), global: null })),
  signalDataStart: vi.fn(() => null),
  loadSignalDefsByIds: vi.fn((ids: number[]) => {
    const m = new Map<number, SignalDef>();
    for (const id of ids) {
      const s = dbState.signalDefs.get(id);
      if (s) m.set(id, s);
    }
    return Promise.resolve(m);
  }),
}));

import { generateForecasts, scoreForecasts, loadLedger } from '../period-forecast.js';

// ─── 빌더 ─────────────────────────────────────────────────

const USER = 1;

const mkCell = (over: Partial<MeasuredCell> & { sourceLinkIds: number[] }): MeasuredCell => ({
  domain: 'sleep',
  via: 'stem',
  resolvedLevel: 'char_stem',
  axisKey: '병',
  element: '화',
  tier: 'emerging',
  shrunkEffect: 1.5,
  nActiveDays: 20,
  ...over,
});

const mkSignal = (id: number): SignalDef => ({
  id,
  name: `sig${id}`,
  kind: 'sql',
  source: 'seed',
  sqlBody: 'SELECT 1',
  valueType: 'binary',
  direction: 'flag_present',
  threshold: null,
  tagName: null,
  windowDays: null,
  domain: 'sleep',
});

/** 날짜 범위에 균일 pass/fail 시리즈 — passCount개 pass, 나머지 measurable fail, 그 외 null. */
const series = (
  dates: string[],
  passCount: number,
  nullFrom = dates.length,
): Map<string, boolean | null> => {
  const m = new Map<string, boolean | null>();
  dates.forEach((d, i) => {
    if (i >= nullFrom) m.set(d, null);
    else m.set(d, i < passCount);
  });
  return m;
};

const daysBetween = (start: string, end: string): string[] => {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  for (let d = s; d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

const pushOpen = (over: Partial<Row> & { period_start: string; period_end: string }): Row => {
  const r: Row = {
    id: dbState.nextId++,
    user_id: USER,
    period_type: 'wolun',
    signal_id: 700,
    status: 'open',
    predicted_direction: 'up',
    baseline_rate: 0.3,
    source_cell: { domain: 'sleep', axisKey: '병', tier: 'emerging' },
    measured_rate: null,
    measured_delta: null,
    direction_hit: null,
    ...over,
  } as Row;
  dbState.table.push(r);
  return r;
};

beforeEach(() => {
  dbState.table = [];
  dbState.nextId = 1;
  dbState.repLinks = new Map();
  dbState.signalDefs = new Map();
  dbState.seriesBySignal = new Map();
});

const RANGE = { start: '2026-03-06', end: '2026-04-04' };

// ─── 생성 ─────────────────────────────────────────────────

describe('generateForecasts', () => {
  it('top-K 컷 + 랭킹(tier→effect→nActive) — 4셀 입력 → 3행, verified 우선', async () => {
    dbState.repLinks.set(1, { signal_id: 101, n_active: 30, rate_off: 0.3 });
    dbState.repLinks.set(2, { signal_id: 102, n_active: 30, rate_off: 0.3 });
    dbState.repLinks.set(3, { signal_id: 103, n_active: 30, rate_off: 0.3 });
    dbState.repLinks.set(4, { signal_id: 104, n_active: 30, rate_off: 0.3 });
    const cells = [
      mkCell({ tier: 'emerging', shrunkEffect: 1.6, sourceLinkIds: [3], axisKey: 'c' }),
      mkCell({ tier: 'verified', shrunkEffect: 1.4, sourceLinkIds: [1], axisKey: 'a' }),
      mkCell({ tier: 'emerging', shrunkEffect: 1.8, sourceLinkIds: [2], axisKey: 'b' }),
      mkCell({ tier: 'emerging', shrunkEffect: 1.5, sourceLinkIds: [4], axisKey: 'd' }),
    ];
    const out = await generateForecasts(USER, 'wolun', RANGE, cells);
    expect(out).toHaveLength(3);
    // verified(101) 먼저, 그다음 emerging effect desc: 1.8(102), 1.6(103). 1.5(104)는 컷.
    expect(out.map((e) => e.signalId)).toEqual([101, 102, 103]);
    expect(out.every((e) => e.status === 'open')).toBe(true);
    expect(out.every((e) => e.predictedDirection === 'up')).toBe(true);
    expect(dbState.table).toHaveLength(3);
  });

  it('생성 결정론 — 동일 입력 두 번(독립 상태) → 동일 엔트리', async () => {
    const setup = (): MeasuredCell[] => {
      dbState.repLinks.set(1, { signal_id: 201, n_active: 30, rate_off: 0.25 });
      dbState.repLinks.set(2, { signal_id: 202, n_active: 20, rate_off: 0.4 });
      return [
        mkCell({ shrunkEffect: 1.9, sourceLinkIds: [1], axisKey: 'x' }),
        mkCell({ shrunkEffect: 1.5, sourceLinkIds: [2], axisKey: 'y' }),
      ];
    };
    const first = await generateForecasts(USER, 'wolun', RANGE, setup());
    // 상태 리셋 후 재실행
    dbState.table = [];
    dbState.nextId = 1;
    dbState.repLinks = new Map();
    const second = await generateForecasts(USER, 'wolun', RANGE, setup());
    expect(second).toEqual(first);
  });

  it('dedup — 두 셀이 같은 대표 signal_id로 수렴 → 1행(상위 셀 baseline 유지)', async () => {
    dbState.repLinks.set(1, { signal_id: 300, n_active: 30, rate_off: 0.3 });
    dbState.repLinks.set(2, { signal_id: 300, n_active: 20, rate_off: 0.45 });
    const cells = [
      mkCell({ shrunkEffect: 1.9, sourceLinkIds: [1], axisKey: 'hi' }),
      mkCell({ shrunkEffect: 1.5, sourceLinkIds: [2], axisKey: 'lo' }),
    ];
    const out = await generateForecasts(USER, 'wolun', RANGE, cells);
    expect(out).toHaveLength(1);
    expect(out[0]?.signalId).toBe(300);
    expect(out[0]?.baselineRate).toBe(0.3); // 상위 셀(link1)
  });

  it('no_call — measuredCells=[] → no_call 1행(signal_id NULL, 사유 기록)', async () => {
    const out = await generateForecasts(USER, 'wolun', RANGE, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('no_call');
    expect(out[0]?.signalId).toBeNull();
    const row = dbState.table[0];
    expect(row?.status).toBe('no_call');
    expect(row?.signal_id).toBeNull();
  });

  it('대표 신호 선택 — max nActive 링크 채택, 타이=min signal_id', async () => {
    // 타이(n_active 동일) → min signal_id(400)
    dbState.repLinks.set(1, { signal_id: 500, n_active: 10, rate_off: 0.2 });
    dbState.repLinks.set(2, { signal_id: 400, n_active: 10, rate_off: 0.25 });
    const tie = await generateForecasts(USER, 'wolun', RANGE, [mkCell({ sourceLinkIds: [1, 2] })]);
    expect(tie[0]?.signalId).toBe(400);
    expect(tie[0]?.baselineRate).toBe(0.25);

    // 리셋: max n_active 우선
    dbState.table = [];
    dbState.nextId = 1;
    dbState.repLinks = new Map();
    dbState.repLinks.set(1, { signal_id: 500, n_active: 30, rate_off: 0.2 });
    dbState.repLinks.set(2, { signal_id: 400, n_active: 10, rate_off: 0.25 });
    const max = await generateForecasts(USER, 'wolun', RANGE, [mkCell({ sourceLinkIds: [1, 2] })]);
    expect(max[0]?.signalId).toBe(500);
  });

  it('무효 rate_off 링크는 건너뜀 — 전부 무효면 그 셀 skip → no_call', async () => {
    dbState.repLinks.set(1, { signal_id: 600, n_active: 30, rate_off: null });
    dbState.repLinks.set(2, { signal_id: 601, n_active: 20, rate_off: 0 });
    const out = await generateForecasts(USER, 'wolun', RANGE, [mkCell({ sourceLinkIds: [1, 2] })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('no_call');
  });

  it('멱등 — 같은 (user,type,start) 재생성 시 행 수·baseline 불변', async () => {
    dbState.repLinks.set(1, { signal_id: 700, n_active: 30, rate_off: 0.3 });
    const cells = [mkCell({ sourceLinkIds: [1] })];
    await generateForecasts(USER, 'wolun', RANGE, cells);
    expect(dbState.table).toHaveLength(1);
    const baselineBefore = dbState.table[0]?.baseline_rate;

    // 2차 호출 — rate_off가 바뀌어도 재생성 안 함(동결).
    dbState.repLinks.set(1, { signal_id: 700, n_active: 30, rate_off: 0.9 });
    const again = await generateForecasts(USER, 'wolun', RANGE, cells);
    expect(dbState.table).toHaveLength(1);
    expect(dbState.table[0]?.baseline_rate).toBe(baselineBefore);
    expect(again[0]?.baselineRate).toBe(baselineBefore);
  });
});

// ─── 채점 ─────────────────────────────────────────────────

describe('scoreForecasts', () => {
  it('scored — measurable≥min, up 예측 × 실측>baseline → 적중 + delta', async () => {
    const row = pushOpen({
      signal_id: 700,
      baseline_rate: 0.3,
      period_start: '2026-03-06',
      period_end: '2026-04-04',
    });
    dbState.signalDefs.set(700, mkSignal(700));
    const dates = daysBetween('2026-03-06', '2026-04-04'); // 30일
    dbState.seriesBySignal.set(700, series(dates, 21)); // 21/30 = 0.7
    const out = await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('scored');
    expect(out[0]?.directionHit).toBe(true);
    expect(out[0]?.measuredRate).toBeCloseTo(0.7, 5);
    expect(out[0]?.measuredDelta).toBeCloseTo(0.4, 5);
    expect(dbState.table.find((r) => r.id === row.id)?.status).toBe('scored');
  });

  it('적중 false — up 예측 × 실측<baseline / 동률=미적중', async () => {
    pushOpen({
      signal_id: 701,
      baseline_rate: 0.5,
      period_start: '2026-03-06',
      period_end: '2026-04-04',
    });
    dbState.signalDefs.set(701, mkSignal(701));
    const dates = daysBetween('2026-03-06', '2026-04-04');
    dbState.seriesBySignal.set(701, series(dates, 3)); // 0.1 < 0.5
    const lose = await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(lose[0]?.directionHit).toBe(false);
  });

  it('down 예측 채점 — 실측<baseline → 적중', async () => {
    pushOpen({
      signal_id: 702,
      predicted_direction: 'down',
      baseline_rate: 0.6,
      period_start: '2026-03-06',
      period_end: '2026-04-04',
    });
    dbState.signalDefs.set(702, mkSignal(702));
    const dates = daysBetween('2026-03-06', '2026-04-04');
    dbState.seriesBySignal.set(702, series(dates, 6)); // 0.2 < 0.6 → down 적중
    const out = await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(out[0]?.directionHit).toBe(true);
  });

  it('unmeasurable — 측정가능일 < min(10) → 강제판정 안 함', async () => {
    pushOpen({ signal_id: 703, period_start: '2026-03-06', period_end: '2026-04-04' });
    dbState.signalDefs.set(703, mkSignal(703));
    const dates = daysBetween('2026-03-06', '2026-04-04');
    dbState.seriesBySignal.set(703, series(dates, 3, 5)); // 5일만 측정가능(<10)
    const out = await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(out[0]?.status).toBe('unmeasurable');
    expect(out[0]?.measuredRate).toBeNull();
  });

  it('self-heal — period_end < today인 묵은 open도 채점(== 아님)', async () => {
    pushOpen({ signal_id: 704, period_start: '2026-01-05', period_end: '2026-02-03' });
    dbState.signalDefs.set(704, mkSignal(704));
    const dates = daysBetween('2026-01-05', '2026-02-03');
    dbState.seriesBySignal.set(704, series(dates, 20));
    const out = await scoreForecasts(USER, 'wolun', '2026-05-01'); // 한참 뒤
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('scored');
  });

  it('baseline 동결 불변식 — 채점 전후 baseline_rate 동일', async () => {
    const row = pushOpen({
      signal_id: 705,
      baseline_rate: 0.33,
      period_start: '2026-03-06',
      period_end: '2026-04-04',
    });
    dbState.signalDefs.set(705, mkSignal(705));
    const dates = daysBetween('2026-03-06', '2026-04-04');
    dbState.seriesBySignal.set(705, series(dates, 24));
    await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(dbState.table.find((r) => r.id === row.id)?.baseline_rate).toBe(0.33);
  });

  it('signal 결측 → unmeasurable(강제판정 금지)', async () => {
    pushOpen({ signal_id: 999, period_start: '2026-03-06', period_end: '2026-04-04' });
    // signalDefs에 999 미등록 → 결측
    const out = await scoreForecasts(USER, 'wolun', '2026-04-05');
    expect(out[0]?.status).toBe('unmeasurable');
  });

  it('미래 open(period_end>today)은 채점 대상 아님', async () => {
    pushOpen({ signal_id: 706, period_start: '2026-03-06', period_end: '2026-04-04' });
    const out = await scoreForecasts(USER, 'wolun', '2026-03-20'); // 기간 끝 전
    expect(out).toHaveLength(0);
    expect(dbState.table[0]?.status).toBe('open');
  });
});

// ─── 로드 ─────────────────────────────────────────────────

describe('loadLedger', () => {
  it('최신 예측(open) + 직전 채점(scored)을 분리 로드', async () => {
    // 직전 기간: scored
    pushOpen({
      signal_id: 800,
      status: 'scored',
      period_start: '2026-02-04',
      period_end: '2026-03-05',
      measured_rate: 0.7,
      measured_delta: 0.4,
      direction_hit: true,
    });
    // 이번 기간: open
    pushOpen({ signal_id: 801, period_start: '2026-03-06', period_end: '2026-04-04' });

    const ledger = await loadLedger(USER, 'wolun');
    expect(ledger.periodType).toBe('wolun');
    expect(ledger.forecasts).toHaveLength(1);
    expect(ledger.forecasts[0]?.signalId).toBe(801);
    expect(ledger.scored).toHaveLength(1);
    expect(ledger.scored[0]?.signalId).toBe(800);
    expect(ledger.scored[0]?.directionHit).toBe(true);
  });

  it('빈 장부 — 행 없으면 forecasts·scored 모두 빈 배열', async () => {
    const ledger = await loadLedger(USER, 'seun');
    expect(ledger.forecasts).toEqual([]);
    expect(ledger.scored).toEqual([]);
  });
});
