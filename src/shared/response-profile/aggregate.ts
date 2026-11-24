/** 응답 프로필 — 링크 기여를 셀로 집계(롤업·tier·shrunk). */

import { getSipsung, getJijiSipsung } from '../saju/sipsung.js';
import { type Cheongan, type Jiji, type Element } from '../saju/types.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import {
  type AxisLevel,
  type CellTier,
  SIPSUNG_GROUP,
  groupElement,
  type SeedForCell,
  mapSeedToCell,
  type ResponseCell,
  cellKey,
} from './axis.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
const RP = INSIGHT_THRESHOLDS.responseProfile;

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
