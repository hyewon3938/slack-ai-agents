import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Captured {
  sql: string;
  params: readonly unknown[];
}

let captured: Captured[];
let nextRows: Array<Record<string, unknown>>;
/** 다중 query 호출(예: approveLlmSignal의 SELECT→UPDATE)용 순차 응답 큐. 비면 nextRows로 폴백. */
let resultQueue: Array<{ rows: Array<Record<string, unknown>> }>;

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    captured.push({ sql, params: params ?? [] });
    const queued = resultQueue.shift();
    if (queued) return queued;
    return { rows: nextRows };
  }),
}));

const {
  approveDiscoveryLink,
  dismissDiscoveryLink,
  approveLlmSignal,
  rejectLlmSignal,
  extractMessageBlocks,
} = await import('../actions.js');

beforeEach(() => {
  captured = [];
  nextRows = [];
  resultQueue = [];
});

describe('approveDiscoveryLink — pending → active', () => {
  it('pending 링크면 active 전이 + linkId 반환, user_id·status 가드 포함', async () => {
    nextRows = [{ id: 555 }];
    const out = await approveDiscoveryLink(1, 555);
    expect(out).toBe(555);
    expect(captured).toHaveLength(1);
    const rec = captured[0];
    expect(rec?.sql).toMatch(/UPDATE pattern_links SET status = 'active'/);
    expect(rec?.sql).toMatch(/status = 'pending'/); // pending만 전이
    expect(rec?.sql).toMatch(/user_id = \$2/); // 타 유저 차단
    expect(rec?.params).toEqual([555, 1]); // [linkId, userId]
  });

  it('pending 아님/권한 없음(0행)이면 null', async () => {
    nextRows = [];
    expect(await approveDiscoveryLink(1, 999)).toBeNull();
  });
});

describe('dismissDiscoveryLink — pending → archived', () => {
  it('pending 링크면 archived 전이(통계 rejected 아님)', async () => {
    nextRows = [{ id: 777 }];
    const out = await dismissDiscoveryLink(1, 777);
    expect(out).toBe(777);
    const rec = captured[0];
    expect(rec?.sql).toMatch(/UPDATE pattern_links SET status = 'archived'/);
    expect(rec?.sql).toMatch(/status = 'pending'/);
    expect(rec?.sql).not.toMatch(/'rejected'/); // 사용자 패스 ≠ 통계 reject
    expect(rec?.params).toEqual([777, 1]);
  });

  it('이미 처리된 링크(0행)면 null', async () => {
    nextRows = [];
    expect(await dismissDiscoveryLink(1, 999)).toBeNull();
  });
});

describe('approveLlmSignal — pending → active (게이트 #1 재검증, ADR-0040)', () => {
  it('검증 통과 sql_body면 active 전이 + signalId 반환', async () => {
    resultQueue = [
      { rows: [{ sql_body: 'SELECT count(*) FROM schedules WHERE user_id = $1 AND date = $2' }] },
      { rows: [{ id: 88 }] },
    ];
    const out = await approveLlmSignal(1, 88);
    expect(out).toBe(88);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.sql).toMatch(/SELECT sql_body FROM signal_defs/);
    expect(captured[0]?.sql).toMatch(/status = 'pending' AND source = 'llm'/);
    expect(captured[1]?.sql).toMatch(/UPDATE signal_defs SET status = 'active'/);
    expect(captured[1]?.sql).toMatch(/source = 'llm'/); // llm만
    expect(captured[1]?.params).toEqual([88, 1]); // [signalId, userId]
  });

  it('검증 실패 sql_body면 활성화 거부(UPDATE 안 함, null)', async () => {
    resultQueue = [{ rows: [{ sql_body: 'SELECT sum(value) FROM assets WHERE user_id = $1' }] }];
    const out = await approveLlmSignal(1, 88);
    expect(out).toBeNull();
    expect(captured).toHaveLength(1); // SELECT만, UPDATE 미실행
  });

  it('pending/llm/본인 아님(SELECT 0행)이면 null', async () => {
    resultQueue = [{ rows: [] }];
    expect(await approveLlmSignal(1, 99)).toBeNull();
    expect(captured).toHaveLength(1); // UPDATE 미시도
  });
});

describe('rejectLlmSignal — pending → rejected', () => {
  it('pending llm 본인 신호면 rejected 전이', async () => {
    nextRows = [{ id: 88 }];
    const out = await rejectLlmSignal(1, 88);
    expect(out).toBe(88);
    expect(captured[0]?.sql).toMatch(/SET status = 'rejected'/);
    expect(captured[0]?.sql).toMatch(/status = 'pending' AND source = 'llm'/);
    expect(captured[0]?.params).toEqual([88, 1]);
  });

  it('해당 없음(0행)이면 null', async () => {
    nextRows = [];
    expect(await rejectLlmSignal(1, 99)).toBeNull();
  });
});

describe('extractMessageBlocks — body.message.blocks 안전 추출', () => {
  it('정상 body면 원본 blocks 배열을 반환한다', () => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '제안 본문' } }];
    expect(extractMessageBlocks({ message: { blocks } })).toEqual(blocks);
  });

  it('message가 없으면 []', () => {
    expect(extractMessageBlocks({})).toEqual([]);
  });

  it('message.blocks가 배열이 아니면 []', () => {
    expect(extractMessageBlocks({ message: { blocks: 'nope' } })).toEqual([]);
    expect(extractMessageBlocks({ message: {} })).toEqual([]);
  });

  it('null·undefined·비객체 body면 [] (폴백)', () => {
    expect(extractMessageBlocks(null)).toEqual([]);
    expect(extractMessageBlocks(undefined)).toEqual([]);
    expect(extractMessageBlocks('str')).toEqual([]);
    expect(extractMessageBlocks(42)).toEqual([]);
  });
});
