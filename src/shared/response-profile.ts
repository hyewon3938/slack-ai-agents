/**
 * 개인화 가중치 집계 레이어: saju_response_profile (#523 Phase 1, #408 5-B 구체화, ADR-0049).
 *
 * 검증된(confirmed)·검증중(active) pattern_links를 사주 축으로 집계해 "이 사람은 [십성/오행]에
 * 어떻게 반응하는가"의 셀 프로필을 만든다. Phase 2(기간 해석)·Phase 3(예측 장부)가 이 프로필을
 * 기간 pillar(월운/세운/대운)에 조인한다.
 *
 * 이중계산 구조적 차단(D4):
 *   - 원천 기여 = 링크당 정확히 1 source 셀 (stem→천간글자, branch→지지글자, hwa_sipsung→그룹, strength_band 강→오행밴드).
 *   - 글자 source는 결정론 롤업 → 십성 → 십성그룹(α/β·nActive 합산). 어떤 조회도 두 레벨을 합산하지 않음(resolveCell).
 *   - 천간 글자와 지지 글자는 별도 축(char_stem/char_branch) — 한글 동음이의(천간 辛 vs 지지 申='신')가 다른 십성으로
 *     가므로 한 셀로 병합하면 안 됨. axis_key는 깨끗한 글자 유지.
 *   - 오행은 그룹 셀의 별칭(일간 고정 시 십성그룹 5 = 오행 5 동형) — 별도 레벨 저장 안 함.
 *   - element_band(강 밴드만)는 별도 축 — 기간 pillar 오행에 직접 조인(생극 간접추론 배제).
 *
 * winner's curse 차단(D3): 효과 = shrunk(posterior_p/rate_off), explained_away 제외, attenuated는 min.
 * 순수 함수(DB·시각 의존 0) → 결정론·단위 테스트 용이. DB I/O·full-replace는 weekly-verification.ts.
 */

import {
  getElementByCheongan,
  getElementByJiji,
  getSipsung,
  getJijiSipsung,
  type Cheongan,
  type Jiji,
  type Element,
  type Sipsung,
} from './saju-calendar.js';
import { elementToSipsinGroup, isSipsinGroup, type SipsinGroup } from './saju-hwa.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
const RP = INSIGHT_THRESHOLDS.responseProfile;

/** 글자 레벨은 천간/지지 분리(동음이의 차단). 십성·그룹은 통합, element_band는 별도 축. */
export type AxisLevel = 'char_stem' | 'char_branch' | 'sipsung' | 'group' | 'element_band';
export type CellTier = 'verified' | 'emerging';

const CHEONGAN: readonly Cheongan[] = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const JIJI: readonly Jiji[] = [
  '자',
  '축',
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
];
const ELEMENTS: readonly Element[] = ['목', '화', '토', '금', '수'];

const isCheongan = (s: string): s is Cheongan => (CHEONGAN as readonly string[]).includes(s);
const isJiji = (s: string): s is Jiji => (JIJI as readonly string[]).includes(s);
const isElement = (s: string): s is Element => (ELEMENTS as readonly string[]).includes(s);

/** 십성 → 십성그룹 (편/정 한 쌍이 한 그룹). 결정론 룩업. */
const SIPSUNG_GROUP: Record<Sipsung, SipsinGroup> = {
  비견: '비겁',
  겁재: '비겁',
  식신: '식상',
  상관: '식상',
  편재: '재성',
  정재: '재성',
  편관: '관성',
  정관: '관성',
  편인: '인성',
  정인: '인성',
};

/** 십성그룹의 오행 별칭 — 일간 오행 대비 elementToSipsinGroup이 그 그룹을 내는 유일 오행(일간 고정 시 동형). */
export const groupElement = (dayMaster: Cheongan, group: SipsinGroup): Element => {
  const dm = getElementByCheongan(dayMaster);
  for (const el of ELEMENTS) if (elementToSipsinGroup(dm, el) === group) return el;
  return dm; // 비겁=일간 오행 — 도달 불가 방어
};

// ─── 시드 → source 셀 매핑 (링크당 정확히 1셀) ─────────────

/** mapSeedToCell이 읽는 시드 최소 형태 (pattern_catalog 컬럼 일부). */
export interface SeedForCell {
  trigger_target_type: string;
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
}

/** 한 시드가 기여하는 source 셀 (편입 안 되면 null). */
export interface PrimaryCell {
  axisLevel: AxisLevel; // char_stem | char_branch | group | element_band (sipsung은 source 아님 — char 롤업으로만)
  axisKey: string;
  element: Element | null;
}

/** branch 시드의 단일 지지 해소 — trigger_target_id 우선, or_branches는 정확히 1개일 때만(다중=비편입). */
const resolveBranchChar = (
  seed: SeedForCell,
  branchNameById: ReadonlyMap<number, string>,
): string | null => {
  if (seed.trigger_target_id !== null) {
    const c = branchNameById.get(seed.trigger_target_id);
    if (c) return c;
  }
  const or = (seed.trigger_aux ?? {})['or_branches'];
  if (Array.isArray(or) && or.length === 1 && typeof or[0] === 'string') return or[0];
  return null;
};

/**
 * 시드 → 1 source 셀. id→글자 역맵은 호출부(DB)에서 주입.
 *   - stem → char_stem(천간 글자) / branch → char_branch(지지 글자, 단일만)
 *   - hwa_sipsung → group(십성그룹 직접)
 *   - strength_band 강 × 오행 → element_band (일간/약/적정 밴드는 비편입)
 *   - relation·sibiunsung·element_density·life_signal·ganji·다중 branch → null (v1 비편입)
 */
export const mapSeedToCell = (
  seed: SeedForCell,
  dayMaster: Cheongan,
  stemNameById: ReadonlyMap<number, string>,
  branchNameById: ReadonlyMap<number, string>,
): PrimaryCell | null => {
  const aux = seed.trigger_aux ?? {};
  switch (seed.trigger_target_type) {
    case 'stem': {
      const char =
        seed.trigger_target_id !== null ? stemNameById.get(seed.trigger_target_id) : undefined;
      if (!char || !isCheongan(char)) return null;
      return { axisLevel: 'char_stem', axisKey: char, element: getElementByCheongan(char) };
    }
    case 'branch': {
      const char = resolveBranchChar(seed, branchNameById);
      if (!char || !isJiji(char)) return null;
      return { axisLevel: 'char_branch', axisKey: char, element: getElementByJiji(char) };
    }
    case 'hwa_sipsung': {
      const sipsin = aux['sipsin'];
      if (!isSipsinGroup(sipsin)) return null;
      return { axisLevel: 'group', axisKey: sipsin, element: groupElement(dayMaster, sipsin) };
    }
    case 'strength_band': {
      const target = aux['target'];
      const band = aux['band'];
      // 강 밴드 × 오행(목화토금수)만 — day_master·약·적정은 비편입(생극 간접추론 배제, §4-1).
      if (band !== 'high' || typeof target !== 'string' || !isElement(target)) return null;
      return { axisLevel: 'element_band', axisKey: target, element: target };
    }
    default:
      return null;
  }
};

// ─── 집계 (1셀 기여 → 결정론 롤업 → tier·shrunk·stability) ──

/** 집계 입력 링크 — pattern_links(confirmed+active) 1행 + 그 신호 도메인 + 교란 판정. */
export interface ProfileLink {
  linkId: number;
  seedId: number;
  status: 'active' | 'confirmed';
  domain: string; // 신호 도메인 (셀 분할 축)
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  rateOff: number; // test_detail.rate_off
  nActive: number; // hit_count + miss_count
  stability: boolean | null; // test_detail.stability
  explainedAway: boolean; // confound.explainedAway → 제외(D3)
  attenuatedEffect: number | null; // confound.adjusted verdict='attenuated'의 adjEffect → min 대상(D3)
}

/** 집계 결과 셀 (saju_response_profile 1행). */
export interface ResponseCell {
  axisLevel: AxisLevel;
  axisKey: string;
  element: Element | null;
  domain: string;
  tier: CellTier;
  alpha: number;
  beta: number;
  shrunkEffect: number | null;
  nLinks: number;
  nActiveDays: number;
  stability: boolean | null;
  sourceLinkIds: number[];
}

interface CellAccumulator {
  axisLevel: AxisLevel;
  axisKey: string;
  element: Element | null;
  domain: string;
  alpha: number;
  beta: number;
  nActiveDays: number;
  nLinks: number;
  hasConfirmed: boolean;
  weightedEffectNum: number; // Σ nActive·linkShrunk (유한 효과 링크만)
  weightedEffectDen: number; // Σ nActive (유한 효과 링크만)
  stabilities: Array<boolean | null>;
  linkIds: number[];
}

/** 셀 lookup·resolution 키 — (레벨, 키, 도메인). */
export const cellKey = (axisLevel: AxisLevel, axisKey: string, domain: string): string =>
  `${axisLevel}|${axisKey}|${domain}`;

/** 링크 1건의 shrunk 효과(D3): posterior_p/rate_off, attenuated면 min(·, adjEffect). 산출 불가면 null. */
const linkShrunk = (link: ProfileLink): number | null => {
  if (!(link.rateOff > 0) || !Number.isFinite(link.posteriorP)) return null;
  const base = link.posteriorP / link.rateOff;
  if (!Number.isFinite(base)) return null;
  return link.attenuatedEffect !== null ? Math.min(base, link.attenuatedEffect) : base;
};

const addContribution = (
  acc: Map<string, CellAccumulator>,
  axisLevel: AxisLevel,
  axisKey: string,
  element: Element | null,
  link: ProfileLink,
): void => {
  const k = cellKey(axisLevel, axisKey, link.domain);
  let a = acc.get(k);
  if (!a) {
    a = {
      axisLevel,
      axisKey,
      element,
      domain: link.domain,
      alpha: 0,
      beta: 0,
      nActiveDays: 0,
      nLinks: 0,
      hasConfirmed: false,
      weightedEffectNum: 0,
      weightedEffectDen: 0,
      stabilities: [],
      linkIds: [],
    };
    acc.set(k, a);
  }
  a.alpha += link.posteriorAlpha;
  a.beta += link.posteriorBeta;
  a.nActiveDays += link.nActive;
  a.nLinks += 1;
  if (link.status === 'confirmed') a.hasConfirmed = true;
  const e = linkShrunk(link);
  if (e !== null && link.nActive > 0) {
    a.weightedEffectNum += link.nActive * e;
    a.weightedEffectDen += link.nActive;
  }
  a.stabilities.push(link.stability);
  a.linkIds.push(link.linkId);
};

const AXIS_ORDER: Record<AxisLevel, number> = {
  char_stem: 0,
  char_branch: 1,
  sipsung: 2,
  group: 3,
  element_band: 4,
};

/** 집계 → tier 게이트(무증거=행 부재) 적용한 셀(또는 null). */
const finalizeCell = (a: CellAccumulator): ResponseCell | null => {
  const shrunkEffect = a.weightedEffectDen > 0 ? a.weightedEffectNum / a.weightedEffectDen : null;
  let tier: CellTier | null = null;
  if (a.hasConfirmed) {
    tier = 'verified';
  } else if (
    a.nActiveDays >= RP.cellMinActive &&
    shrunkEffect !== null &&
    shrunkEffect >= V.emergingMinEffect
  ) {
    tier = 'emerging';
  }
  if (tier === null) return null; // 무증거 = 행 부재(§4-1)
  const nonNull = a.stabilities.filter((s): s is boolean => s !== null);
  const stability = nonNull.length === 0 ? null : nonNull.every((s) => s);
  return {
    axisLevel: a.axisLevel,
    axisKey: a.axisKey,
    element: a.element,
    domain: a.domain,
    tier,
    alpha: a.alpha,
    beta: a.beta,
    shrunkEffect,
    nLinks: a.nLinks,
    nActiveDays: a.nActiveDays,
    stability,
    sourceLinkIds: [...a.linkIds].sort((x, y) => x - y),
  };
};

/**
 * confirmed+active 링크 → 셀 프로필. 링크당 1 source 기여 + 글자→십성→그룹 결정론 롤업.
 * explained_away 제외(D3). 무증거 셀(tier 미충족)은 행 생략. 결정론(입력 동일 → 출력 동일).
 */
export const buildResponseProfile = (
  links: ReadonlyArray<ProfileLink>,
  seedById: ReadonlyMap<number, SeedForCell>,
  dayMaster: Cheongan,
  stemNameById: ReadonlyMap<number, string>,
  branchNameById: ReadonlyMap<number, string>,
): ResponseCell[] => {
  const acc = new Map<string, CellAccumulator>();
  for (const link of links) {
    if (link.explainedAway) continue; // D3 — 어부지리 링크 제외
    const seed = seedById.get(link.seedId);
    if (!seed) continue;
    const primary = mapSeedToCell(seed, dayMaster, stemNameById, branchNameById);
    if (!primary) continue;

    if (primary.axisLevel === 'char_stem' || primary.axisLevel === 'char_branch') {
      // source: 글자 셀 1개. 결정론 롤업 → 십성 → 십성그룹(같은 링크가 각 레벨 1셀에만 기여 = 비합산 불변).
      addContribution(acc, primary.axisLevel, primary.axisKey, primary.element, link);
      const sipsung =
        primary.axisLevel === 'char_stem'
          ? getSipsung(dayMaster, primary.axisKey as Cheongan)
          : getJijiSipsung(dayMaster, primary.axisKey as Jiji);
      addContribution(acc, 'sipsung', sipsung, null, link);
      const group = SIPSUNG_GROUP[sipsung];
      addContribution(acc, 'group', group, groupElement(dayMaster, group), link);
    } else if (primary.axisLevel === 'group') {
      // hwa_sipsung: 그룹 직접(글자·십성 source 없음). 그룹 셀 = 십성 롤업 + hwa 직접의 합.
      addContribution(acc, 'group', primary.axisKey, primary.element, link);
    } else {
      // element_band: 별도 축.
      addContribution(acc, 'element_band', primary.axisKey, primary.element, link);
    }
  }

  const cells: ResponseCell[] = [];
  for (const a of acc.values()) {
    const cell = finalizeCell(a);
    if (cell) cells.push(cell);
  }
  cells.sort(
    (x, y) =>
      AXIS_ORDER[x.axisLevel] - AXIS_ORDER[y.axisLevel] ||
      x.domain.localeCompare(y.domain) ||
      x.axisKey.localeCompare(y.axisKey),
  );
  return cells;
};

// ─── 읽기: 단일 레벨 resolution (Phase 2·3 공용) ──────────

export interface ResolvedCell {
  cell: ResponseCell;
  resolvedLevel: AxisLevel;
}

/** 셀 배열 → resolution 인덱스. */
export const indexCells = (cells: ReadonlyArray<ResponseCell>): Map<string, ResponseCell> =>
  new Map(cells.map((c) => [cellKey(c.axisLevel, c.axisKey, c.domain), c]));

/** 글자 셀이 write 게이트 통과(verified 또는 nActive≥cellMinActive)면 거기서 정지할 자격. */
const stopAtChar = (cell: ResponseCell | undefined): cell is ResponseCell =>
  cell !== undefined && (cell.tier === 'verified' || cell.nActiveDays >= RP.cellMinActive);

/**
 * 글자 기준 단일 레벨 resolution: 글자(천간/지지) → 십성 → 그룹. 두 레벨을 절대 합산하지 않는다(§4-1).
 * 글자 셀이 존재(=게이트 통과)하면 거기서 정지, 미달이면 한 단계 위. 어느 레벨도 없으면 null(무증거).
 */
export const resolveHierarchyCell = (
  index: ReadonlyMap<string, ResponseCell>,
  dayMaster: Cheongan,
  charType: 'stem' | 'branch',
  char: Cheongan | Jiji,
  domain: string,
): ResolvedCell | null => {
  const charLevel: AxisLevel = charType === 'stem' ? 'char_stem' : 'char_branch';
  const charCell = index.get(cellKey(charLevel, char, domain));
  if (stopAtChar(charCell)) return { cell: charCell, resolvedLevel: charLevel };

  const sipsung =
    charType === 'stem'
      ? getSipsung(dayMaster, char as Cheongan)
      : getJijiSipsung(dayMaster, char as Jiji);
  const sipsungCell = index.get(cellKey('sipsung', sipsung, domain));
  if (stopAtChar(sipsungCell)) return { cell: sipsungCell, resolvedLevel: 'sipsung' };

  const groupCell = index.get(cellKey('group', SIPSUNG_GROUP[sipsung], domain));
  if (groupCell) return { cell: groupCell, resolvedLevel: 'group' };
  return null;
};

/** element_band 축 resolution — 별도 축, fallback 없음(생극 간접추론 배제). */
export const resolveElementBandCell = (
  index: ReadonlyMap<string, ResponseCell>,
  element: Element,
  domain: string,
): ResolvedCell | null => {
  const c = index.get(cellKey('element_band', element, domain));
  return c ? { cell: c, resolvedLevel: 'element_band' } : null;
};
