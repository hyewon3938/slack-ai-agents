/** 기간 해석 — 기간 pillar의 십성·오행·합충 결정론 도출. */

import {
  getSipsung,
  getJijiSipsung,
  getElementByCheongan,
  getElementByJiji,
  getRelations,
  type Cheongan,
  type Jiji,
  type Pillar,
} from '../saju-calendar.js';
import type { PeriodType, PeriodContext } from './types.js';

// ─── A. derivePeriodContext (결정론) ──────────────────────

/** 기간 pillar → 십성·오행·합충 결정론 도출. 합충은 해석 전용 텍스트(가중치 편입 금지 — D7). */
export const derivePeriodContext = (
  natal: { dayMaster: Cheongan; stems: readonly Cheongan[]; branches: readonly Jiji[] },
  pillar: Pillar,
  periodType: PeriodType,
): PeriodContext => {
  const stem = pillar.cheongan;
  const branch = pillar.jiji;
  return {
    periodType,
    pillar,
    stem,
    branch,
    stemElement: getElementByCheongan(stem),
    branchElement: getElementByJiji(branch),
    stemSipsung: getSipsung(natal.dayMaster, stem),
    branchSipsung: getJijiSipsung(natal.dayMaster, branch),
    relations: getRelations(natal.stems, natal.branches, stem, branch),
  };
};
