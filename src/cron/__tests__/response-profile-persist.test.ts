import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResponseCell } from '../../shared/response-profile/axis.js';
import type { ProfileLink } from '../../shared/response-profile/aggregate.js';

// persistResponseProfile — DB 링크 행 → ProfileLink 변환, 그리고 셀 full-replace SQL 조립을 고정.
// 셀 집계 자체(buildResponseProfile)는 src/shared/__tests__/response-profile.test.ts가 맡는다.

interface Call {
  sql: string;
  params: unknown[];
}

const txCalls: Call[] = [];
const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[]) => {
    txCalls.push({ sql, params });
    return { rows: [] };
  }),
};
const mockWithTransaction = vi.fn(
  async (fn: (c: typeof fakeClient) => Promise<unknown>): Promise<unknown> => fn(fakeClient),
);

let linkRows: Array<Record<string, unknown>> = [];
let natal: { dayMaster: string } | null = { dayMaster: '갑' };
let cellsToReturn: ResponseCell[] = [];
const mockBuild = vi.fn((..._a: unknown[]) => cellsToReturn);

vi.mock('../../shared/db.js', () => ({
  query: vi.fn(async () => ({ rows: linkRows })),
  withTransaction: (fn: (c: typeof fakeClient) => Promise<unknown>): Promise<unknown> =>
    mockWithTransaction(fn),
}));
vi.mock('../../shared/pattern/match-context.js', () => ({
  loadNatalContext: vi.fn(async () => natal),
}));
vi.mock('../../shared/pattern/match-day.js', () => ({
  buildNameIdMap: vi.fn(async (table: string) =>
    table === 'stems_master'
      ? new Map([
          ['갑', 1],
          ['을', 2],
        ])
      : new Map([['자', 11]]),
  ),
}));
vi.mock('../../shared/pattern/match-seeds.js', () => ({
  loadActiveSeeds: vi.fn(async () => [{ id: 100 }, { id: 101 }]),
}));
vi.mock('../../shared/response-profile/aggregate.js', () => ({
  buildResponseProfile: (...a: unknown[]): unknown => mockBuild(...a),
}));

const { persistResponseProfile } = await import('../weekly-verification/response-profile.js');

const COLS_PER_CELL = 12;

const cell = (over: Partial<ResponseCell>): ResponseCell => ({
  axisLevel: 'char_stem',
  axisKey: '병',
  element: '화',
  domain: 'sleep',
  tier: 'emerging',
  alpha: 3,
  beta: 2,
  shrunkEffect: 0.2,
  nLinks: 1,
  nActiveDays: 20,
  stability: null,
  sourceLinkIds: [5, 6],
  ...over,
});

const linkRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  link_id: 5,
  seed_id: 100,
  status: 'active',
  domain: 'sleep',
  posterior_alpha: '3.5',
  posterior_beta: '1.5',
  posterior_p: '0.7',
  hit_count: 4,
  miss_count: 2,
  test_detail: { rate_off: 0.3, stability: true },
  confound: null,
  ...over,
});

const insertCall = (): Call | undefined => txCalls.find((c) => c.sql.includes('INSERT'));
const builtLinks = (): ProfileLink[] => mockBuild.mock.calls[0]?.[0] as ProfileLink[];

beforeEach(() => {
  txCalls.length = 0;
  mockBuild.mockClear();
  mockWithTransaction.mockClear();
  linkRows = [linkRow({})];
  natal = { dayMaster: '갑' };
  cellsToReturn = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ─── full-replace SQL 조립 ──────────────────────────────

describe('persistResponseProfile — full-replace', () => {
  it('셀 3개면 placeholder가 $2부터 셀당 12개씩 끊김 없이 이어지고 params 길이가 맞다', async () => {
    cellsToReturn = [cell({ axisKey: '병' }), cell({ axisKey: '정' }), cell({ axisKey: '무' })];
    await persistResponseProfile(7);

    const ins = insertCall();
    expect(ins).toBeDefined();
    expect(ins?.params).toHaveLength(1 + 3 * COLS_PER_CELL);
    expect(ins?.params[0]).toBe(7);

    const tuples = ins?.sql.match(/\(\$1, [^)]*\)/g) ?? [];
    expect(tuples).toHaveLength(3);
    tuples.forEach((t, row) => {
      const nums = [...t.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      const expected = Array.from({ length: COLS_PER_CELL }, (_, k) => 2 + row * COLS_PER_CELL + k);
      expect(nums).toEqual([1, ...expected]);
    });
    // 마지막 placeholder 번호 = params 길이
    expect(ins?.sql).toContain(`$${1 + 3 * COLS_PER_CELL}::jsonb`);
  });

  it('셀 값은 컬럼 순서대로 들어가고 source_link_ids는 JSON 문자열로 직렬화된다', async () => {
    cellsToReturn = [
      cell({
        axisLevel: 'element_band',
        axisKey: '수',
        element: null,
        domain: 'routine',
        tier: 'verified',
        alpha: 9,
        beta: 4,
        shrunkEffect: null,
        nLinks: 2,
        nActiveDays: 33,
        stability: false,
        sourceLinkIds: [1, 2],
      }),
    ];
    await persistResponseProfile(7);
    expect(insertCall()?.params).toEqual([
      7,
      'element_band',
      '수',
      null,
      'routine',
      'verified',
      9,
      4,
      null,
      2,
      33,
      false,
      '[1,2]',
    ]);
  });

  it('DELETE가 INSERT보다 먼저, 같은 트랜잭션 안에서 실행된다', async () => {
    cellsToReturn = [cell({})];
    await persistResponseProfile(7);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(txCalls.map((c) => c.sql.trim().split(/\s+/)[0])).toEqual(['DELETE', 'INSERT']);
    expect(txCalls[0].params).toEqual([7]);
  });

  it('셀이 0개면 기존 행만 지우고 INSERT는 하지 않는다', async () => {
    cellsToReturn = [];
    await persistResponseProfile(7);
    expect(txCalls).toHaveLength(1);
    expect(txCalls[0].sql).toContain('DELETE FROM saju_response_profile');
    expect(insertCall()).toBeUndefined();
  });

  it('원국이 없으면 집계도 트랜잭션도 하지 않는다 (기존 행 보존)', async () => {
    natal = null;
    await persistResponseProfile(7);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});

// ─── DB 행 → ProfileLink 변환 ───────────────────────────

describe('persistResponseProfile — 링크 행 변환', () => {
  it('NUMERIC 문자열을 숫자로, hit+miss를 nActive로 바꾼다', async () => {
    await persistResponseProfile(7);
    expect(builtLinks()).toEqual([
      {
        linkId: 5,
        seedId: 100,
        status: 'active',
        domain: 'sleep',
        posteriorAlpha: 3.5,
        posteriorBeta: 1.5,
        posteriorP: 0.7,
        rateOff: 0.3,
        nActive: 6,
        stability: true,
        explainedAway: false,
        attenuatedEffect: null,
      },
    ]);
  });

  it('도메인 없는 링크는 셀 분할이 안 되므로 뺀다', async () => {
    linkRows = [linkRow({ link_id: 5 }), linkRow({ link_id: 6, domain: null })];
    await persistResponseProfile(7);
    expect(builtLinks().map((l) => l.linkId)).toEqual([5]);
  });

  it('confirmed는 유지하고 그 밖의 status는 active로 본다', async () => {
    linkRows = [linkRow({ link_id: 5, status: 'confirmed' }), linkRow({ link_id: 6 })];
    await persistResponseProfile(7);
    expect(builtLinks().map((l) => l.status)).toEqual(['confirmed', 'active']);
  });

  it('test_detail이 없거나 값이 숫자·불리언이 아니면 rateOff=NaN, stability=null', async () => {
    linkRows = [
      linkRow({ link_id: 5, test_detail: null }),
      linkRow({ link_id: 6, test_detail: { rate_off: '0.3', stability: 'true' } }),
    ];
    await persistResponseProfile(7);
    for (const l of builtLinks()) {
      expect(l.rateOff).toBeNaN();
      expect(l.stability).toBeNull();
    }
  });

  it('posterior_p가 null이면 NaN (0으로 바뀌지 않는다)', async () => {
    linkRows = [linkRow({ posterior_p: null })];
    await persistResponseProfile(7);
    expect(builtLinks()[0].posteriorP).toBeNaN();
  });

  it('교란 explainedAway와 attenuated 조정 효과를 옮긴다', async () => {
    linkRows = [
      linkRow({
        confound: {
          scannedAt: '2026-11-23',
          suspected: [],
          explainedAway: true,
          adjusted: [
            { verdict: 'survives', adjEffect: 1.9 },
            { verdict: 'attenuated', adjEffect: 1.2 },
          ],
        },
      }),
    ];
    await persistResponseProfile(7);
    expect(builtLinks()[0].explainedAway).toBe(true);
    expect(builtLinks()[0].attenuatedEffect).toBe(1.2);
  });

  it('attenuated 조정 효과가 유한수가 아니면 null', async () => {
    linkRows = [
      linkRow({
        confound: {
          scannedAt: '2026-11-23',
          suspected: [],
          adjusted: [{ verdict: 'attenuated', adjEffect: Number.NaN }],
        },
      }),
    ];
    await persistResponseProfile(7);
    expect(builtLinks()[0].attenuatedEffect).toBeNull();
  });

  it('천간·지지 이름→id 맵을 id→이름으로 뒤집어 넘긴다', async () => {
    await persistResponseProfile(7);
    const [, seedById, dayMaster, stemById, branchById] = mockBuild.mock.calls[0] as [
      unknown,
      Map<number, unknown>,
      string,
      Map<number, string>,
      Map<number, string>,
    ];
    expect(dayMaster).toBe('갑');
    expect([...seedById.keys()]).toEqual([100, 101]);
    expect(stemById.get(1)).toBe('갑');
    expect(stemById.get(2)).toBe('을');
    expect(branchById.get(11)).toBe('자');
  });
});
