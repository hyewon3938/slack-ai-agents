import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── fixtures ────────────────────────────────────────────
interface SatRow {
  id: number;
  name: string;
  description: string | null;
  n_eval: string;
  n_active: string;
}
interface ArchivedRow {
  id: number;
  user_id: number;
  name: string;
  sipsin: string | null;
  description: string | null;
  trigger_target_type: string;
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
  pillar_level: string | null;
  active: boolean;
  source: string;
}

let detectRows: SatRow[];
let archivedRows: ArchivedRow[];
let activationBySeed: Map<number, Map<string, boolean>>;
let updates: Array<{ sql: string; params: readonly unknown[] }>;

const reset = (): void => {
  detectRows = [];
  archivedRows = [];
  activationBySeed = new Map();
  updates = [];
};
reset();

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (/MIN\(date\)/i.test(sql)) return { rows: [{ d: null }] }; // computeUserDataStarts → 무클립
    if (/JOIN seed_daily_activations/i.test(sql)) return { rows: detectRows }; // detectSaturatedActive
    if (/archived_reason = \$2/i.test(sql) && /active = false/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: archivedRows }; // reviveDesaturated 로드
    }
    if (/^UPDATE/i.test(sql.trim())) {
      updates.push({ sql: sql.trim(), params: params ?? [] });
      return { rows: [] };
    }
    throw new Error(`[fixture] unexpected SQL: ${sql.slice(0, 60)}`);
  }),
}));

vi.mock('../pattern-verification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pattern-verification.js')>();
  return {
    ...actual,
    computeSeedActivationSeries: vi.fn(
      async (seed: { id: number }): Promise<Map<string, boolean>> =>
        activationBySeed.get(seed.id) ?? new Map(),
    ),
  };
});

vi.mock('../pattern-match.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pattern-match.js')>();
  return { ...actual, buildNameIdMap: vi.fn(async () => new Map<string, number>()) };
});

const { isSaturated, isDesaturated, SATURATION_REASON, runSaturationSweep } =
  await import('../seed-saturation.js');
const { buildHygieneNotice } = await import('../../agents/insight/hypothesis-cards.js');

const TODAY = '2026-06-08';

// 활성 시리즈 헬퍼: nActive 켜진 날 + nOff 꺼진 날.
const series = (nActive: number, nOff: number): Map<string, boolean> => {
  const m = new Map<string, boolean>();
  let i = 0;
  const base = new Date('2025-01-01T00:00:00Z');
  const next = (): string => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i++);
    return d.toISOString().slice(0, 10);
  };
  for (let k = 0; k < nActive; k++) m.set(next(), true);
  for (let k = 0; k < nOff; k++) m.set(next(), false);
  return m;
};

describe('isSaturated / isDesaturated — 경계 (rate=0.95, minDays=30)', () => {
  it('포화: 활성률 ≥ 0.95 & 윈도우 ≥ 30일', () => {
    expect(isSaturated(0.95, 30)).toBe(true);
    expect(isSaturated(1.0, 100)).toBe(true);
    expect(isSaturated(0.96, 30)).toBe(true);
  });
  it('포화 아님: 활성률 < 0.95 또는 윈도우 < 30일', () => {
    expect(isSaturated(0.94, 30)).toBe(false); // rate 미달
    expect(isSaturated(1.0, 29)).toBe(false); // 소표본 가드
    expect(isSaturated(0.5, 100)).toBe(false);
  });
  it('탈포화(부활): 활성률 < 0.95 & 윈도우 ≥ 30일', () => {
    expect(isDesaturated(0.94, 30)).toBe(true);
    expect(isDesaturated(0.5, 60)).toBe(true);
  });
  it('탈포화 아님: 여전히 포화거나 소표본', () => {
    expect(isDesaturated(0.95, 30)).toBe(false); // 여전히 포화
    expect(isDesaturated(0.94, 29)).toBe(false); // 소표본 가드
  });
  it('minDays 이상이면 포화/탈포화는 상호배타(정확히 하나)', () => {
    for (const rate of [0.0, 0.5, 0.9499, 0.95, 0.99, 1.0]) {
      expect(isSaturated(rate, 40) !== isDesaturated(rate, 40)).toBe(true);
    }
    // 소표본은 둘 다 false
    expect(isSaturated(0.99, 10)).toBe(false);
    expect(isDesaturated(0.99, 10)).toBe(false);
  });
});

describe('runSaturationSweep — archive (trigger_activated 기반)', () => {
  beforeEach(reset);

  it('포화 시드만 archive — 카탈로그 + 링크 UPDATE 발행, 라벨 동봉', async () => {
    detectRows = [
      {
        id: 1,
        name: 'pool_화_오행_누적_N1',
        description: '화 누적 1개 — 가설',
        n_eval: '40',
        n_active: '40',
      }, // 100% → 포화
      { id: 2, name: 'life_weekend', description: '주말 발현일', n_eval: '40', n_active: '12' }, // 30% → 정상
      { id: 3, name: 'pool_x', description: '뭔가 — 가설', n_eval: '20', n_active: '20' }, // 100%지만 20일 < 30 → 보류
    ];
    const out = await runSaturationSweep(1, TODAY);

    expect(out.archived).toHaveLength(1);
    expect(out.archived[0]?.id).toBe(1);
    // 라벨은 평어 (변수명·언더스코어 미노출).
    expect(out.archived[0]?.label).not.toMatch(/[A-Za-z_]/);
    expect(out.revived).toEqual([]);

    // 카탈로그 active=false + 링크 archived UPDATE가 seed 1에 대해 발행.
    const catUpd = updates.find(
      (u) => /UPDATE pattern_catalog SET active = false/i.test(u.sql) && u.params[0] === 1,
    );
    const linkUpd = updates.find(
      (u) => /UPDATE pattern_links SET status = 'archived'/i.test(u.sql) && u.params[0] === 1,
    );
    expect(catUpd).toBeDefined();
    expect(catUpd?.params).toContain(SATURATION_REASON);
    expect(linkUpd).toBeDefined();
    // seed 2·3은 archive 안 함.
    expect(updates.some((u) => u.params[0] === 2 || u.params[0] === 3)).toBe(false);
  });

  it('포화 시드 없으면 무변화', async () => {
    detectRows = [{ id: 9, name: 's', description: null, n_eval: '40', n_active: '10' }];
    const out = await runSaturationSweep(1, TODAY);
    expect(out.archived).toEqual([]);
    expect(updates).toEqual([]);
  });
});

describe('runSaturationSweep — revive (saturation 스코프만, 재계산)', () => {
  beforeEach(reset);

  const archivedSeed = (id: number, name: string): ArchivedRow => ({
    id,
    user_id: 1,
    name,
    sipsin: null,
    description: `${name} — 가설`,
    trigger_target_type: 'stem',
    trigger_target_id: null,
    trigger_aux: null,
    pillar_level: null,
    active: false,
    source: 'seed',
  });

  it('탈포화된 saturation-archive 시드는 active=true 부활', async () => {
    archivedRows = [archivedSeed(5, 'pool_화_누적')];
    activationBySeed.set(5, series(20, 30)); // 20/50 = 40% < 95% & 50일 ≥ 30 → 탈포화
    const out = await runSaturationSweep(1, TODAY);

    expect(out.revived).toHaveLength(1);
    expect(out.revived[0]?.id).toBe(5);
    const reviveUpd = updates.find(
      (u) => /UPDATE pattern_catalog SET active = true/i.test(u.sql) && u.params[0] === 5,
    );
    expect(reviveUpd).toBeDefined();
    // 부활 UPDATE는 archived_reason='saturation' 스코프로 가드 (delegated·수동 부활 차단).
    expect(reviveUpd?.params).toContain(SATURATION_REASON);
  });

  it('아직 포화면 부활 안 함', async () => {
    archivedRows = [archivedSeed(6, 'pool_화_누적')];
    activationBySeed.set(6, series(49, 1)); // 49/50 = 98% ≥ 95% → 여전히 포화
    const out = await runSaturationSweep(1, TODAY);
    expect(out.revived).toEqual([]);
    expect(updates.some((u) => /SET active = true/i.test(u.sql))).toBe(false);
  });
});

describe('buildHygieneNotice — 카드 말미 알림 (#508 ③)', () => {
  it('archive·revive 둘 다 있으면 두 줄 context, 변수명 미노출', () => {
    const blocks = buildHygieneNotice(['화 기운 강한 날'], ['목 기운 약한 날']);
    expect(blocks).toHaveLength(1);
    const text = JSON.stringify(blocks);
    expect(text).toContain('🧹 포화 시드 1개 정리');
    expect(text).toContain('🌱 부활 1개');
    // 전달한 평어 라벨이 그대로 렌더(변수명은 호출부 seedLabel이 책임 — 여기선 join만).
    expect(text).toContain('화 기운 강한 날');
    expect(text).toContain('목 기운 약한 날');
  });

  it('둘 다 없으면 빈 블록(미추가)', () => {
    expect(buildHygieneNotice([], [])).toEqual([]);
  });
});
