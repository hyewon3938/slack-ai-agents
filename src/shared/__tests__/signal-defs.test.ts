import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── db mock — findEquivalentSignal의 단일 SELECT를 캡처하고 rows를 되돌린다 ──
interface EquivRow {
  id: number;
  status: 'active' | 'pending' | 'rejected';
}
let equivRows: EquivRow[];
let captured: Array<{ sql: string; params: readonly unknown[] }>;

const resetDb = (): void => {
  equivRows = [];
  captured = [];
};
resetDb();

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    captured.push({ sql, params: params ?? [] });
    return { rows: equivRows };
  }),
}));

import { findEquivalentSignal, type SignalIdentity } from '../signal-defs.js';

const sqlIdentity = (over: Partial<SignalIdentity> = {}): SignalIdentity => ({
  name: 'schedule_completion_rate',
  kind: 'sql',
  direction: 'above_avg',
  threshold: null,
  tagName: null,
  sqlBody: 'SELECT 1',
  ...over,
});

describe('findEquivalentSignal', () => {
  beforeEach(() => resetDb());

  it('동일 정의 부재 → absent (생성 허용)', async () => {
    equivRows = [];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res.decision).toBe('absent');
  });

  it('active 동일 정의 존재 → reuse (그 id 반환, 재생성 금지)', async () => {
    equivRows = [{ id: 42, status: 'active' }];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res).toEqual({ decision: 'reuse', signalId: 42, status: 'active' });
  });

  it('pending 동일 정의 존재 → reuse', async () => {
    equivRows = [{ id: 7, status: 'pending' }];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res).toEqual({ decision: 'reuse', signalId: 7, status: 'pending' });
  });

  it('rejected 동일 정의만 존재 → skip_rejected (기각 재생성 차단)', async () => {
    equivRows = [
      { id: 3, status: 'rejected' },
      { id: 9, status: 'rejected' },
    ];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res.decision).toBe('skip_rejected');
  });

  it('active + rejected 혼재 → reuse가 rejected보다 우선', async () => {
    equivRows = [
      { id: 3, status: 'rejected' },
      { id: 42, status: 'active' },
    ];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res.decision).toBe('reuse');
    if (res.decision === 'reuse') expect(res.signalId).toBe(42);
  });

  it('active 여러 벌 → active 우선 + MIN id 선택', async () => {
    equivRows = [
      { id: 50, status: 'pending' },
      { id: 30, status: 'active' },
      { id: 20, status: 'active' },
    ];
    const res = await findEquivalentSignal(1, sqlIdentity());
    expect(res.decision).toBe('reuse');
    if (res.decision === 'reuse') {
      expect(res.status).toBe('active');
      expect(res.signalId).toBe(20); // active 중 MIN id
    }
  });

  it('동일성 쿼리는 user_id 격리 + name·kind·direction·threshold·tag_name·sql_body(IS NOT DISTINCT FROM) 매칭', async () => {
    equivRows = [];
    await findEquivalentSignal(1, sqlIdentity({ threshold: 5, direction: 'below_avg' }));
    const rec = captured[0];
    expect(rec?.sql).toMatch(/FROM signal_defs/);
    expect(rec?.sql).toMatch(/user_id = \$1/);
    expect(rec?.sql).toMatch(/direction IS NOT DISTINCT FROM \$4/);
    expect(rec?.sql).toMatch(/threshold IS NOT DISTINCT FROM \$5/);
    expect(rec?.sql).toMatch(/tag_name IS NOT DISTINCT FROM \$6/);
    expect(rec?.sql).toMatch(/sql_body IS NOT DISTINCT FROM \$7/);
    // 파라미터 순서: [userId, name, kind, direction, threshold, tagName, sqlBody, excludeId]
    expect(rec?.params?.[0]).toBe(1);
    expect(rec?.params?.[2]).toBe('sql');
    expect(rec?.params?.[3]).toBe('below_avg');
    expect(rec?.params?.[4]).toBe(5);
    expect(rec?.params?.[7]).toBeNull(); // excludeId 미지정
  });

  it('excludeId 지정 시 자기 자신 제외 조건 포함', async () => {
    equivRows = [];
    await findEquivalentSignal(1, sqlIdentity(), 88);
    const rec = captured[0];
    expect(rec?.sql).toMatch(/id <> \$8/);
    expect(rec?.params?.[7]).toBe(88);
  });

  it('tag 신호도 동일 헬퍼로 판정 (tag_name 매칭, sql_body는 양쪽 NULL)', async () => {
    equivRows = [{ id: 12, status: 'active' }];
    const res = await findEquivalentSignal(
      1,
      sqlIdentity({ kind: 'tag', direction: null, sqlBody: null, tagName: 'flow' }),
    );
    expect(res.decision).toBe('reuse');
    const rec = captured[0];
    expect(rec?.params?.[2]).toBe('tag');
    expect(rec?.params?.[5]).toBe('flow');
    expect(rec?.params?.[6]).toBeNull(); // sqlBody
  });
});
