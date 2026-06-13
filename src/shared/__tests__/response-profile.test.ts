import { describe, it, expect } from 'vitest';
import {
  mapSeedToCell,
  buildResponseProfile,
  groupElement,
  indexCells,
  resolveHierarchyCell,
  resolveElementBandCell,
  cellKey,
  type ProfileLink,
  type ResponseCell,
  type SeedForCell,
} from '../response-profile.js';
import type { Cheongan } from '../saju-calendar.js';

// ─── 고정 일간 갑(양목) — 십성 매핑 결정론 검증 기준 ──────
const DM: Cheongan = '갑';
const CHEONGAN = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const JIJI = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
// stems_master/branches_master id → 글자 역맵 (id i = i번째 글자, 1-based).
const stemNameById = new Map<number, string>(CHEONGAN.map((c, i) => [i + 1, c]));
const branchNameById = new Map<number, string>(JIJI.map((j, i) => [i + 1, j]));

const stemSeed = (id: number, stemId: number): [number, SeedForCell] => [
  id,
  { trigger_target_type: 'stem', trigger_target_id: stemId, trigger_aux: null },
];
const branchSeed = (
  id: number,
  branchId: number,
  aux: Record<string, unknown> | null = null,
): [number, SeedForCell] => [
  id,
  { trigger_target_type: 'branch', trigger_target_id: aux ? null : branchId, trigger_aux: aux },
];
const hwaSeed = (id: number, sipsin: string): [number, SeedForCell] => [
  id,
  {
    trigger_target_type: 'hwa_sipsung',
    trigger_target_id: null,
    trigger_aux: { sipsin, via: 'hwa' },
  },
];
const bandSeed = (id: number, target: string, band: string): [number, SeedForCell] => [
  id,
  { trigger_target_type: 'strength_band', trigger_target_id: null, trigger_aux: { target, band } },
];

/** 기본 confirmed 링크(=verified tier 항상 출현 → 카운팅 불변식 깔끔). over로 tier/효과 조정. */
const mkLink = (linkId: number, seedId: number, over: Partial<ProfileLink> = {}): ProfileLink => ({
  linkId,
  seedId,
  status: 'confirmed',
  domain: 'sleep',
  posteriorAlpha: 13,
  posteriorBeta: 8,
  posteriorP: 0.6,
  rateOff: 0.3,
  nActive: 20,
  stability: true,
  explainedAway: false,
  attenuatedEffect: null,
  ...over,
});

const isChar = (c: { axisLevel: string }): boolean =>
  c.axisLevel === 'char_stem' || c.axisLevel === 'char_branch';

// ─── mapSeedToCell ────────────────────────────────────────

describe('mapSeedToCell', () => {
  it('stem → char_stem 천간 글자 + 오행', () => {
    expect(mapSeedToCell(stemSeed(1, 1)[1], DM, stemNameById, branchNameById)).toEqual({
      axisLevel: 'char_stem',
      axisKey: '갑',
      element: '목',
    });
    // 병(화)
    expect(mapSeedToCell(stemSeed(2, 3)[1], DM, stemNameById, branchNameById)).toEqual({
      axisLevel: 'char_stem',
      axisKey: '병',
      element: '화',
    });
  });

  it('branch → char_branch 지지 글자 + 본기 오행 (단일만)', () => {
    // 인(본기 갑, 목)
    expect(mapSeedToCell(branchSeed(3, 3)[1], DM, stemNameById, branchNameById)).toEqual({
      axisLevel: 'char_branch',
      axisKey: '인',
      element: '목',
    });
    // or_branches 정확히 1개 → 그 글자
    expect(
      mapSeedToCell(branchSeed(4, 0, { or_branches: ['자'] })[1], DM, stemNameById, branchNameById),
    ).toMatchObject({ axisLevel: 'char_branch', axisKey: '자' });
    // or_branches 다중 → 비편입(null)
    expect(
      mapSeedToCell(
        branchSeed(5, 0, { or_branches: ['자', '축'] })[1],
        DM,
        stemNameById,
        branchNameById,
      ),
    ).toBeNull();
  });

  it('hwa_sipsung → group 직접 + 오행 별칭', () => {
    expect(mapSeedToCell(hwaSeed(6, '재성')[1], DM, stemNameById, branchNameById)).toEqual({
      axisLevel: 'group',
      axisKey: '재성',
      element: '토', // 갑(목)의 재성 = 목극토
    });
  });

  it('strength_band — 강 밴드 × 오행만 element_band, 그 외 비편입', () => {
    expect(mapSeedToCell(bandSeed(7, '화', 'high')[1], DM, stemNameById, branchNameById)).toEqual({
      axisLevel: 'element_band',
      axisKey: '화',
      element: '화',
    });
    expect(
      mapSeedToCell(bandSeed(8, 'day_master', 'high')[1], DM, stemNameById, branchNameById),
    ).toBeNull();
    expect(mapSeedToCell(bandSeed(9, '목', 'low')[1], DM, stemNameById, branchNameById)).toBeNull();
    expect(
      mapSeedToCell(bandSeed(10, '목', 'mid')[1], DM, stemNameById, branchNameById),
    ).toBeNull();
  });

  it('relation·sibiunsung·element_density·life_signal·ganji → 비편입(null)', () => {
    for (const t of ['relation', 'sibiunsung', 'element_density', 'life_signal', 'ganji']) {
      const seed: SeedForCell = { trigger_target_type: t, trigger_target_id: 1, trigger_aux: {} };
      expect(mapSeedToCell(seed, DM, stemNameById, branchNameById)).toBeNull();
    }
  });
});

// ─── groupElement — 일간 고정 시 그룹↔오행 동형 ───────────

describe('groupElement (갑 일간)', () => {
  it('비겁=목·식상=화·재성=토·관성=금·인성=수', () => {
    expect(groupElement(DM, '비겁')).toBe('목');
    expect(groupElement(DM, '식상')).toBe('화');
    expect(groupElement(DM, '재성')).toBe('토');
    expect(groupElement(DM, '관성')).toBe('금');
    expect(groupElement(DM, '인성')).toBe('수');
  });
});

// ─── 십성 매핑 결정론 스냅샷 + 이중계산 부재 불변식 ───────

describe('buildResponseProfile — 천간10·지지12 결정론 롤업', () => {
  // 천간 10 + 지지 12 = 22 글자 링크(각 confirmed, domain sleep). 일간 갑 기준.
  const seedEntries: [number, SeedForCell][] = [];
  const links: ProfileLink[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = 100 + i;
    seedEntries.push(stemSeed(id, i));
    links.push(mkLink(id, id));
  }
  for (let i = 1; i <= 12; i++) {
    const id = 200 + i;
    seedEntries.push(branchSeed(id, i));
    links.push(mkLink(id, id));
  }
  const cells = buildResponseProfile(links, new Map(seedEntries), DM, stemNameById, branchNameById);

  it('글자 셀 = 22개, 각 1링크 (Σ char nLinks == 편입 글자 링크)', () => {
    const chars = cells.filter((c) => isChar(c));
    expect(chars.length).toBe(22);
    expect(chars.every((c) => c.nLinks === 1)).toBe(true);
    expect(chars.reduce((s, c) => s + c.nLinks, 0)).toBe(22);
  });

  it('십성 롤업 결정론 — 갑 일간 십성별 글자 수', () => {
    const sip = new Map(
      cells.filter((c) => c.axisLevel === 'sipsung').map((c) => [c.axisKey, c.nLinks]),
    );
    // 천간: 갑비견 을겁재 병식신 정상관 무편재 기정재 경편관 신정관 임편인 계정인
    // 지지: 자정인 축정재 인비견 묘겁재 진편재 사식신 오상관 미정재 신편관 유정관 술편재 해편인
    expect(sip.get('비견')).toBe(2); // 갑, 인
    expect(sip.get('겁재')).toBe(2); // 을, 묘
    expect(sip.get('식신')).toBe(2); // 병, 사
    expect(sip.get('상관')).toBe(2); // 정, 오
    expect(sip.get('편재')).toBe(3); // 무, 진, 술
    expect(sip.get('정재')).toBe(3); // 기, 축, 미
    expect(sip.get('편관')).toBe(2); // 경, 신(지지)
    expect(sip.get('정관')).toBe(2); // 신(천간), 유
    expect(sip.get('편인')).toBe(2); // 임, 해
    expect(sip.get('정인')).toBe(2); // 계, 자
    expect([...sip.values()].reduce((a, b) => a + b, 0)).toBe(22); // Σ sipsung == Σ char
  });

  it('그룹 롤업 = 십성 합산 (Σ group nLinks == Σ char nLinks)', () => {
    const grp = new Map(
      cells.filter((c) => c.axisLevel === 'group').map((c) => [c.axisKey, c.nLinks]),
    );
    expect(grp.get('비겁')).toBe(4); // 비견2+겁재2
    expect(grp.get('식상')).toBe(4); // 식신2+상관2
    expect(grp.get('재성')).toBe(6); // 편재3+정재3
    expect(grp.get('관성')).toBe(4); // 편관2+정관2
    expect(grp.get('인성')).toBe(4); // 편인2+정인2
    expect([...grp.values()].reduce((a, b) => a + b, 0)).toBe(22);
  });

  it('오행 별칭 — char 갑=목, group 재성=토', () => {
    const cha = cells.find((c) => isChar(c) && c.axisKey === '갑');
    expect(cha?.element).toBe('목');
    const grp = cells.find((c) => c.axisLevel === 'group' && c.axisKey === '재성');
    expect(grp?.element).toBe('토');
    const sip = cells.find((c) => c.axisLevel === 'sipsung');
    expect(sip?.element).toBeNull(); // 십성 레벨은 오행 별칭 없음
  });

  it('동음이의 천간 辛/지지 申(=한글 "신") 별도 셀 — 정관 vs 편관', () => {
    // 천간 신(stemId8)=정관, 지지 신(branchId9)=편관. char 레벨 분리 안 하면 한 셀로 병합됨(버그).
    const stemSin = cells.find((c) => c.axisLevel === 'char_stem' && c.axisKey === '신');
    const branchSin = cells.find((c) => c.axisLevel === 'char_branch' && c.axisKey === '신');
    expect(stemSin?.nLinks).toBe(1);
    expect(branchSin?.nLinks).toBe(1);
    expect(stemSin).not.toBe(branchSin); // 다른 셀
  });
});

// ─── 그룹 = 십성 롤업 + hwa 직접 ──────────────────────────

describe('buildResponseProfile — hwa 직접 기여', () => {
  it('group 재성 = 무/기(롤업) + hwa 재성(직접) 합산', () => {
    const seeds = new Map<number, SeedForCell>([
      stemSeed(1, 5),
      stemSeed(2, 6),
      hwaSeed(3, '재성'),
    ]);
    // 무(stemId5)→편재→재성, 기(stemId6)→정재→재성, hwa 재성 직접.
    const links = [mkLink(1, 1), mkLink(2, 2), mkLink(3, 3)];
    const cells = buildResponseProfile(links, seeds, DM, stemNameById, branchNameById);
    const grp = cells.find((c) => c.axisLevel === 'group' && c.axisKey === '재성');
    expect(grp?.nLinks).toBe(3); // 무1 + 기1 + hwa1
    expect(grp?.sourceLinkIds).toEqual([1, 2, 3]);
    // hwa는 char·sipsung 미기여 → 글자/십성 셀은 무·기에서만(각 1)
    expect(cells.filter((c) => isChar(c)).reduce((s, c) => s + c.nLinks, 0)).toBe(2);
    expect(cells.filter((c) => c.axisLevel === 'sipsung').reduce((s, c) => s + c.nLinks, 0)).toBe(
      2,
    );
  });

  it('element_band은 별도 축 — char/sipsung/group과 분리', () => {
    const seeds = new Map<number, SeedForCell>([stemSeed(1, 1), bandSeed(2, '화', 'high')]);
    const links = [mkLink(1, 1), mkLink(2, 2)];
    const cells = buildResponseProfile(links, seeds, DM, stemNameById, branchNameById);
    const eb = cells.filter((c) => c.axisLevel === 'element_band');
    expect(eb.length).toBe(1);
    expect(eb[0]?.axisKey).toBe('화');
    expect(eb[0]?.element).toBe('화');
    // 글자 축은 갑 1개만(밴드는 글자축에 안 들어감)
    expect(cells.filter((c) => isChar(c)).length).toBe(1);
  });
});

// ─── tier 게이트 ──────────────────────────────────────────

describe('buildResponseProfile — tier 게이트', () => {
  it('confirmed 포함 → verified (효과·발현일 무관 출현)', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'confirmed', nActive: 5, posteriorP: 0.3, rateOff: 0.3 })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    expect(cells.find((c) => isChar(c))?.tier).toBe('verified');
  });

  it('active + nActive≥15 + shrunk≥1.3 → emerging', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    // shrunk = posteriorP/rateOff = 0.6/0.3 = 2.0 ≥ 1.3, nActive 20 ≥ 15
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const cha = cells.find((c) => isChar(c));
    expect(cha?.tier).toBe('emerging');
    expect(cha?.shrunkEffect).toBeCloseTo(2.0, 6);
  });

  it('active + nActive<15 → 행 부재', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active', nActive: 10 })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    expect(cells.length).toBe(0);
  });

  it('active + shrunk<1.3 → 행 부재', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    // shrunk = 0.3/0.3 = 1.0 < 1.3
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active', posteriorP: 0.3, rateOff: 0.3 })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    expect(cells.length).toBe(0);
  });
});

// ─── explained_away 제외 + attenuated min (D3) ────────────

describe('buildResponseProfile — 교란 반영(D3)', () => {
  it('explained_away 링크 제외 → 셀 미생성', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    const cells = buildResponseProfile(
      [mkLink(1, 1, { explainedAway: true })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    expect(cells.length).toBe(0);
  });

  it('attenuated → shrunk = min(posterior_p/rate_off, adjEffect)', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    // base shrunk = 0.6/0.2 = 3.0, attenuatedEffect 1.4 → min = 1.4
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active', posteriorP: 0.6, rateOff: 0.2, attenuatedEffect: 1.4 })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    expect(cells.find((c) => isChar(c))?.shrunkEffect).toBeCloseTo(1.4, 6);
  });

  it('shrunk = nActive 가중평균 (두 링크)', () => {
    // 같은 글자 셀에 두 active 링크: shrunk 2.0(nActive10) + 1.4(nActive30) → 가중평균 = (2.0*10+1.4*30)/40 = 1.55
    const seeds = new Map([stemSeed(1, 1)]);
    const links = [
      mkLink(1, 1, { status: 'active', posteriorP: 0.4, rateOff: 0.2, nActive: 10 }), // 2.0
      mkLink(2, 1, { status: 'active', posteriorP: 0.7, rateOff: 0.5, nActive: 30 }), // 1.4
    ];
    const cells = buildResponseProfile(links, seeds, DM, stemNameById, branchNameById);
    expect(cells.find((c) => isChar(c))?.shrunkEffect).toBeCloseTo(1.55, 6);
  });
});

// ─── stability 전파 ───────────────────────────────────────

describe('buildResponseProfile — stability 전파', () => {
  const seeds = new Map([stemSeed(1, 1)]);
  const cellOf = (links: ProfileLink[]): ResponseCell | undefined =>
    buildResponseProfile(links, seeds, DM, stemNameById, branchNameById).find((c) => isChar(c));

  it('전부 true → true', () => {
    expect(
      cellOf([mkLink(1, 1, { stability: true }), mkLink(2, 1, { stability: true })])?.stability,
    ).toBe(true);
  });
  it('하나라도 false → false', () => {
    expect(
      cellOf([mkLink(1, 1, { stability: true }), mkLink(2, 1, { stability: false })])?.stability,
    ).toBe(false);
  });
  it('null은 무시(있는 것만 AND)', () => {
    expect(
      cellOf([mkLink(1, 1, { stability: true }), mkLink(2, 1, { stability: null })])?.stability,
    ).toBe(true);
  });
  it('전부 null → null', () => {
    expect(
      cellOf([mkLink(1, 1, { stability: null }), mkLink(2, 1, { stability: null })])?.stability,
    ).toBeNull();
  });
});

// ─── 단일 레벨 resolution (정지·fallback·비합산) ──────────

describe('resolveHierarchyCell — 단일 레벨', () => {
  it('글자 셀 존재 → char에서 정지(비합산)', () => {
    const seeds = new Map([stemSeed(1, 1)]); // 갑
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const idx = indexCells(cells);
    const r = resolveHierarchyCell(idx, DM, 'stem', '갑', 'sleep');
    expect(r?.resolvedLevel).toBe('char_stem');
    expect(r?.cell.axisKey).toBe('갑');
    // 반환 셀은 char 셀 객체 그 자체 — 십성/그룹과 합산되지 않음
    expect(r?.cell).toBe(idx.get(cellKey('char_stem', '갑', 'sleep')));
  });

  it('글자 셀 부재 → 십성으로 fallback', () => {
    // 인(branch, 본기 갑 → 비견) 링크만 → char 인 + sipsung 비견. stem 갑 조회는 char 갑 부재 → 비견 fallback.
    const seeds = new Map([branchSeed(1, 3)]); // 인
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const idx = indexCells(cells);
    const r = resolveHierarchyCell(idx, DM, 'stem', '갑', 'sleep');
    expect(r?.resolvedLevel).toBe('sipsung');
    expect(r?.cell.axisKey).toBe('비견');
  });

  it('글자·십성 부재 → 그룹으로 fallback (hwa 직접 그룹)', () => {
    const seeds = new Map([hwaSeed(1, '재성')]); // 그룹 재성만
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const idx = indexCells(cells);
    // 무(stem, 편재→재성) 조회: char 무·sipsung 편재 부재 → group 재성
    const r = resolveHierarchyCell(idx, DM, 'stem', '무', 'sleep');
    expect(r?.resolvedLevel).toBe('group');
    expect(r?.cell.axisKey).toBe('재성');
  });

  it('어느 레벨도 없음 → null', () => {
    const idx = indexCells([]);
    expect(resolveHierarchyCell(idx, DM, 'stem', '갑', 'sleep')).toBeNull();
  });

  it('도메인 다르면 매칭 안 됨', () => {
    const seeds = new Map([stemSeed(1, 1)]);
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active', domain: 'sleep' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const idx = indexCells(cells);
    expect(resolveHierarchyCell(idx, DM, 'stem', '갑', 'routine')).toBeNull();
  });
});

describe('resolveElementBandCell — 별도 축(fallback 없음)', () => {
  it('element_band 셀 직접 조회', () => {
    const seeds = new Map([bandSeed(1, '화', 'high')]);
    const cells = buildResponseProfile(
      [mkLink(1, 1, { status: 'active' })],
      seeds,
      DM,
      stemNameById,
      branchNameById,
    );
    const idx = indexCells(cells);
    expect(resolveElementBandCell(idx, '화', 'sleep')?.resolvedLevel).toBe('element_band');
    expect(resolveElementBandCell(idx, '목', 'sleep')).toBeNull(); // 다른 오행 — fallback 없음
  });
});
