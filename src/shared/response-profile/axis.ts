/** 응답 프로필 — 사주 축·셀 정의와 시드 → source 셀 매핑. */

import {
  getElementByCheongan,
  getElementByJiji,
  type Cheongan,
  type Jiji,
  type Element,
  type Sipsung,
} from '../saju-calendar.js';
import { elementToSipsinGroup, isSipsinGroup, type SipsinGroup } from '../saju-hwa.js';

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
export const SIPSUNG_GROUP: Record<Sipsung, SipsinGroup> = {
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

/** 셀 lookup·resolution 키 — (레벨, 키, 도메인). */
export const cellKey = (axisLevel: AxisLevel, axisKey: string, domain: string): string =>
  `${axisLevel}|${axisKey}|${domain}`;
