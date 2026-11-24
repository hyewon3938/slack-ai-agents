/** 응답 프로필 — 셀 인덱스와 단일 레벨 resolution. */

import {
  getSipsung,
  getJijiSipsung,
  type Cheongan,
  type Jiji,
  type Element,
} from '../saju-calendar.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { type AxisLevel, SIPSUNG_GROUP, type ResponseCell, cellKey } from './axis.js';

const RP = INSIGHT_THRESHOLDS.responseProfile;

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
