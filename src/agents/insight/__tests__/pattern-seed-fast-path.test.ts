import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SayFn } from '@slack/bolt';

// 사주 시드 fast path — 약속된 단일 명령어만 받고(자유 문장 부분추출 금지), 그 밖은 false로 LLM에 넘긴다.

const mockQuery = vi.fn();
vi.mock('../../../shared/db.js', () => ({
  query: (...a: unknown[]): unknown => mockQuery(...a),
}));

const { tryPatternSeedFastPath } = await import('../pattern-seed-fast-path.js');

const USER = 3;
let said: string[] = [];
const say = vi.fn(async (msg: unknown) => {
  said.push(String(msg));
  return { ok: true };
}) as unknown as SayFn;

const seedRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1,
  name: '시드',
  sipsin: null,
  active: true,
  hit_count: 0,
  miss_count: 0,
  inconclusive_count: 0,
  ...over,
});

beforeEach(() => {
  said = [];
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ─── 매칭 경계 ──────────────────────────────────────────

describe('tryPatternSeedFastPath — 매칭 경계', () => {
  it.each(['사주 시드 보기', '사주시드보기', '사주 시드 보기?', '사주 시드 모두 보기'])(
    '"%s"는 매칭된다',
    async (text) => {
      expect(await tryPatternSeedFastPath(text, say, USER)).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    '사주 시드 보기 좀 해줘',
    '오늘 사주 시드 보기',
    '사주 시드 끄기',
    '사주 시드 끄기 3개만',
    '사주 시드 켜기 abc',
    '사주 시드 어떻게 꺼?',
  ])('명령어를 포함한 자유 문장 "%s"는 false로 넘기고 DB·응답을 건드리지 않는다', async (text) => {
    expect(await tryPatternSeedFastPath(text, say, USER)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(said).toEqual([]);
  });
});

// ─── 목록 ───────────────────────────────────────────────

describe('tryPatternSeedFastPath — 목록', () => {
  it('"보기"는 활성 시드만, "모두 보기"는 비활성까지 조회한다', async () => {
    await tryPatternSeedFastPath('사주 시드 보기', say, USER);
    expect(mockQuery.mock.calls[0][0]).toContain('s.active = true');
    expect(mockQuery.mock.calls[0][1]).toEqual([USER]);

    await tryPatternSeedFastPath('사주 시드 모두 보기', say, USER);
    expect(mockQuery.mock.calls[1][0]).not.toContain('s.active = true');
  });

  it('적중률은 hit/(hit+miss) 반올림이고, 판정 0건이면 "-", 꺼진 시드는 [OFF]', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        seedRow({ id: 4, name: '가상시드A', sipsin: '식신', hit_count: 2, miss_count: 1 }),
        seedRow({ id: 9, name: '가상시드B', active: false, inconclusive_count: 5 }),
      ],
    });
    await tryPatternSeedFastPath('사주 시드 모두 보기', say, USER);
    expect(said[0].split('\n')).toEqual([
      '*사주 시드 (전체)*',
      '#4 가상시드A (식신) — hit 2/3 (67%)',
      '#9 가상시드B — hit 0/0 (-) [OFF]',
    ]);
  });

  it('시드가 없으면 범위에 맞는 안내', async () => {
    await tryPatternSeedFastPath('사주 시드 보기', say, USER);
    await tryPatternSeedFastPath('사주 시드 모두 보기', say, USER);
    expect(said).toEqual(['활성 사주 시드가 없어.', '등록된 사주 시드가 없어.']);
  });
});

// ─── 토글 ───────────────────────────────────────────────

describe('tryPatternSeedFastPath — 토글', () => {
  it('"끄기 N"은 본인 시드 N을 active=false로', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 12, name: '가상시드' }] });
    expect(await tryPatternSeedFastPath('사주 시드 끄기 12', say, USER)).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([USER, 12, false]);
    expect(said).toEqual(['#12 가상시드 껐어.']);
  });

  it('"켜기 #N"도 받고 active=true로', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 12, name: '가상시드' }] });
    await tryPatternSeedFastPath('사주 시드 켜기 #12', say, USER);
    expect(mockQuery.mock.calls[0][1]).toEqual([USER, 12, true]);
    expect(said).toEqual(['#12 가상시드 켰어.']);
  });

  it('갱신된 행이 없으면 찾을 수 없다고 답한다', async () => {
    await tryPatternSeedFastPath('사주 시드 끄기 99', say, USER);
    expect(said).toEqual(['#99 시드를 찾을 수 없어.']);
  });

  it('DB 오류여도 true를 돌려 LLM으로 넘기지 않고 오류 안내를 보낸다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockQuery.mockRejectedValue(new Error('down'));
    expect(await tryPatternSeedFastPath('사주 시드 끄기 1', say, USER)).toBe(true);
    expect(said).toEqual(['사주 시드 처리 중 오류가 발생했어.']);
  });
});
