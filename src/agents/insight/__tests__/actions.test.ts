import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Captured {
  sql: string;
  params: readonly unknown[];
}

let captured: Captured[];
let nextRows: Array<{ id: number }>;

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    captured.push({ sql, params: params ?? [] });
    return { rows: nextRows };
  }),
}));

const { approveDiscoveryLink, dismissDiscoveryLink } = await import('../actions.js');

beforeEach(() => {
  captured = [];
  nextRows = [];
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
