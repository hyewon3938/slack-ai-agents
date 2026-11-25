import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PeriodContext } from '../period/types.js';

interface Call {
  sql: string;
  params: unknown[];
}

const calls: Call[] = [];
let sleepRow: Record<string, unknown> | undefined;
let routineRow: Record<string, unknown> | undefined;
let diaryRow: Record<string, unknown> | undefined;

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('sleep_records')) return { rows: sleepRow ? [sleepRow] : [] };
    if (sql.includes('routine_records')) return { rows: routineRow ? [routineRow] : [] };
    if (sql.includes('diary_entries')) return { rows: diaryRow ? [diaryRow] : [] };
    return { rows: [] };
  }),
}));

const { buildDescriptiveStats } = await import('../period/interpretation-stats.js');

// buildDescriptiveStats는 periodType·branch만 읽는다.
const ctx = (periodType: PeriodContext['periodType'], branch = '미'): PeriodContext =>
  ({ periodType, branch }) as PeriodContext;

const USER = 7;
const TODAY = '2026-11-25';

const sleepCall = (): Call | undefined => calls.find((c) => c.sql.includes('sleep_records'));

beforeEach(() => {
  calls.length = 0;
  sleepRow = { avg_duration: 420, cnt: 10 };
  routineRow = { done: 2, total: 3 };
  diaryRow = { cnt: 4 };
});

// ─── wolun: 과거 동일 월지 구간 ─────────────────────────

describe('buildDescriptiveStats — wolun', () => {
  it('2026 미월은 과거 미월 2개(2025·2024)를 절기 경계대로 모은다', async () => {
    const s = await buildDescriptiveStats(
      ctx('wolun', '미'),
      { start: '2026-07-07', end: '2026-08-06' },
      USER,
      TODAY,
    );
    expect(s.rangeCount).toBe(2);
    expect(s.scope).toBe('과거 같은 미월(절기달) 2개 누적');
    // 2025 소서 07-07 ~ 입추 08-07 전날, 2024 소서 07-06 ~ 입추 08-07 전날
    expect(sleepCall()?.params).toEqual([
      USER,
      '2025-07-07',
      '2025-08-06',
      '2024-07-06',
      '2024-08-06',
    ]);
  });

  it('구간 placeholder는 $2부터 구간당 2개씩 이어진다', async () => {
    await buildDescriptiveStats(
      ctx('wolun', '미'),
      { start: '2026-07-07', end: '2026-08-06' },
      USER,
      TODAY,
    );
    expect(sleepCall()?.sql).toContain('date BETWEEN $2 AND $3 OR date BETWEEN $4 AND $5');
    for (const c of calls) expect(c.params).toHaveLength(5);
  });

  it('과거 구간은 최대 5개까지만 모은다 (백스톱)', async () => {
    // 2031 미월 → 2030~2026 5개에서 멈추고 2025·2024는 안 본다
    const s = await buildDescriptiveStats(
      ctx('wolun', '미'),
      { start: '2031-07-07', end: '2031-08-07' },
      USER,
      TODAY,
    );
    expect(s.rangeCount).toBe(5);
    const params = sleepCall()?.params ?? [];
    expect(params).toHaveLength(11);
    expect(params[1]).toMatch(/^2030-/);
    expect(params[9]).toMatch(/^2026-/);
  });

  it('절기 표 하한(2024 소한 이전)에 닿으면 throw 없이 멈춘다', async () => {
    // 2025 축월 → 2024-01-06~02-03 축월 1개, 그 이전 날짜는 2023 표가 없어 중단
    const s = await buildDescriptiveStats(
      ctx('wolun', '축'),
      { start: '2025-01-05', end: '2025-02-02' },
      USER,
      TODAY,
    );
    expect(s.rangeCount).toBe(1);
    expect(sleepCall()?.params).toEqual([USER, '2024-01-06', '2024-02-03']);
  });

  it('과거 같은 월지가 없으면 DB를 조회하지 않고 통계는 전부 null', async () => {
    const s = await buildDescriptiveStats(
      ctx('wolun', '미'),
      { start: '2024-07-06', end: '2024-08-06' },
      USER,
      TODAY,
    );
    expect(calls).toHaveLength(0);
    expect(s).toEqual({
      scope: '과거 같은 미월(절기달) 기록이 아직 없어 — 이번이 처음 쌓는 구간이야',
      rangeCount: 0,
      sleep: null,
      routine: null,
      diary: null,
    });
  });
});

// ─── seun/daeun: 기간 시작 ~ 오늘 ──────────────────────

describe('buildDescriptiveStats — seun/daeun', () => {
  it('끝이 없거나 오늘 이후면 오늘까지로 자른다', async () => {
    const s = await buildDescriptiveStats(
      ctx('seun'),
      { start: '2026-02-04', end: null },
      USER,
      TODAY,
    );
    expect(s.rangeCount).toBe(1);
    expect(s.scope).toBe('올해(입춘 기준) 시작 이후 ~ 오늘');
    expect(sleepCall()?.params).toEqual([USER, '2026-02-04', TODAY]);

    calls.length = 0;
    await buildDescriptiveStats(
      ctx('seun'),
      { start: '2026-02-04', end: '2027-02-03' },
      USER,
      TODAY,
    );
    expect(sleepCall()?.params).toEqual([USER, '2026-02-04', TODAY]);
  });

  it('끝이 오늘보다 앞이면 그 끝을 쓴다', async () => {
    await buildDescriptiveStats(
      ctx('daeun'),
      { start: '2016-05-01', end: '2026-04-30' },
      USER,
      TODAY,
    );
    expect(sleepCall()?.params).toEqual([USER, '2016-05-01', '2026-04-30']);
  });

  it('시작이 오늘 이후면 조회 없이 "시작 전"', async () => {
    const s = await buildDescriptiveStats(
      ctx('daeun'),
      { start: '2027-01-01', end: null },
      USER,
      TODAY,
    );
    expect(calls).toHaveLength(0);
    expect(s.scope).toBe('이번 대운 시작 전');
    expect(s.rangeCount).toBe(0);
    expect(s.sleep).toBeNull();
  });
});

// ─── 집계 결과 변환 ─────────────────────────────────────

describe('buildDescriptiveStats — 집계 결과 변환', () => {
  const run = (): ReturnType<typeof buildDescriptiveStats> =>
    buildDescriptiveStats(ctx('seun'), { start: '2026-02-04', end: null }, USER, TODAY);

  it('루틴 완료율은 반올림한 정수 퍼센트 (2/3 → 67)', async () => {
    const s = await run();
    expect(s.routine).toEqual({ rate: 67, total: 3 });
  });

  it('건수가 0이면 해당 통계는 null', async () => {
    sleepRow = { avg_duration: null, cnt: 0 };
    routineRow = { done: 0, total: 0 };
    diaryRow = { cnt: 0 };
    const s = await run();
    expect(s.sleep).toBeNull();
    expect(s.routine).toBeNull();
    expect(s.diary).toBeNull();
  });

  it('루틴이 있는데 하나도 안 했으면 0%로 남긴다 (null 아님)', async () => {
    routineRow = { done: 0, total: 5 };
    const s = await run();
    expect(s.routine).toEqual({ rate: 0, total: 5 });
  });
});
