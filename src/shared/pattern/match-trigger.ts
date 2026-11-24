/**
 * 트리거 평가 (pattern-match에서 분리).
 */

import { query } from '../db.js';
import { dispatchLifeSignal } from '../life-signal-evaluators/index.js';
import { type BandCuts, classifyBand, isBand } from './quantile.js';
import { type Cheongan, type Jiji } from '../saju/types.js';
import { getElementByCheongan } from '../saju/pillar-utils.js';
import { detectHwaTransforms, elementToSipsinGroup, isSipsinGroup } from '../saju/hwa.js';
import { SAJU_HWA_PARAMS } from '../saju/strength-params.js';
import { computeStrengthForTarget, isStrengthTarget } from '../saju/strength.js';
import { isLifeSignalAux } from './match-aux-types.js';
import {
  ELEMENT_BY_BRANCH,
  ELEMENT_BY_STEM,
  getNumberField,
  isStringArray,
  loadBranchRelations,
  lookupSibiunsung,
  pickPillarByLevel,
  pillarSetOf,
} from './match-trigger-lookups.js';
import type { DailyContext, SajuSeedWithMetrics } from './match-types.js';

export const evaluateTrigger = async (
  seed: SajuSeedWithMetrics,
  ctx: DailyContext,
  stemNameToId: Map<string, number>,
  branchNameToId: Map<string, number>,
  strengthCuts?: Map<string, BandCuts>,
): Promise<boolean> => {
  const aux = seed.trigger_aux ?? {};

  switch (seed.trigger_target_type) {
    case 'stem': {
      const pillar = pickPillarByLevel(seed.pillar_level, ctx);
      if (!pillar) return false;
      const stemId = stemNameToId.get(pillar.cheongan);
      return seed.trigger_target_id !== null && seed.trigger_target_id === stemId;
    }

    case 'branch': {
      const pillar = pickPillarByLevel(seed.pillar_level, ctx);
      if (!pillar) return false;
      const branchId = branchNameToId.get(pillar.jiji);
      if (seed.trigger_target_id !== null && seed.trigger_target_id === branchId) return true;
      const orBranches = aux['or_branches'];
      if (isStringArray(orBranches) && orBranches.includes(pillar.jiji)) return true;
      return false;
    }

    case 'ganji': {
      // ganji_master.id 매칭 — 일운 stem+branch 조합의 ganji id
      const result = await query<{ id: number }>(
        `SELECT g.id
           FROM ganji_master g
           JOIN stems_master s ON s.id = g.stem_id
           JOIN branches_master b ON b.id = g.branch_id
          WHERE s.name = $1 AND b.name = $2`,
        [ctx.dayStem, ctx.dayBranch],
      );
      const dayGanjiId = result.rows[0]?.id;
      return dayGanjiId !== undefined && dayGanjiId === seed.trigger_target_id;
    }

    case 'sibiunsung': {
      const states = aux['states'];
      if (!isStringArray(states)) return false;
      const state = await lookupSibiunsung(ctx.natal.dayMaster, ctx.dayBranch);
      return state !== null && states.includes(state);
    }

    case 'element_density': {
      const element = typeof aux['element'] === 'string' ? aux['element'] : null;
      const minCount = getNumberField(aux as Record<string, unknown>, 'min_count');
      if (!element || minCount === null) return false;
      let count = 0;
      for (const s of ctx.natal.stems) if (ELEMENT_BY_STEM[s] === element) count++;
      for (const b of ctx.natal.branches) if (ELEMENT_BY_BRANCH[b] === element) count++;
      if (ELEMENT_BY_STEM[ctx.dayStem] === element) count++;
      if (ELEMENT_BY_BRANCH[ctx.dayBranch] === element) count++;
      return count >= minCount;
    }

    case 'relation': {
      // 풀셋 형태 (마스터 #434 Phase 2): {type, members} — 양 멤버 자동 양방향 평가
      // type='branch_<관계명>' 또는 'stem_<관계명>', members=['<a>', '<b>']
      const typeAux = aux['type'];
      const membersAux = aux['members'];
      if (typeof typeAux === 'string' && isStringArray(membersAux) && membersAux.length === 2) {
        const [a, b] = membersAux;
        if (typeAux.startsWith('branch_')) {
          if (ctx.natal.branches.includes(a as Jiji) && ctx.dayBranch === b) return true;
          if (ctx.natal.branches.includes(b as Jiji) && ctx.dayBranch === a) return true;
          return false;
        }
        if (typeAux.startsWith('stem_')) {
          if (ctx.natal.stems.includes(a as Cheongan) && ctx.dayStem === b) return true;
          if (ctx.natal.stems.includes(b as Cheongan) && ctx.dayStem === a) return true;
          return false;
        }
        return false;
      }

      // 기존 형태 (N3 진술충, S2 사술원진): day_branch + natal_branches + relation_types
      const dayBranchName = typeof aux['day_branch'] === 'string' ? aux['day_branch'] : null;
      const natalBranches = aux['natal_branches'];
      const relationTypes = aux['relation_types'];
      if (!dayBranchName || !isStringArray(natalBranches) || !isStringArray(relationTypes)) {
        return false;
      }
      if (ctx.dayBranch !== dayBranchName) return false;

      const relations = await loadBranchRelations();
      for (const natalBranch of natalBranches) {
        if (!ctx.natal.branches.includes(natalBranch as Jiji)) continue;
        for (const rt of relationTypes) {
          const matched = relations.some(
            (r) =>
              r.relation_type === rt &&
              ((r.branch_a_name === ctx.dayBranch && r.branch_b_name === natalBranch) ||
                (r.branch_a_name === natalBranch && r.branch_b_name === ctx.dayBranch)),
          );
          if (matched) return true;
        }
      }
      return false;
    }

    case 'strength_band': {
      // #477 P4a — 강도 밴드. 일별 cron은 윈도우가 없어 주간 엔진이 저장한 분위수 컷으로 판정.
      // 컷 없으면(첫 주간 엔진 실행 전) false — 발현 없음(정직). 가설=시드×신호 (off-day 검증).
      if (!strengthCuts) return false;
      const target = aux['target'];
      const band = aux['band'];
      if (!isStrengthTarget(target) || !isBand(band)) return false;
      const cuts = strengthCuts.get(target);
      if (!cuts) return false;
      const strength = computeStrengthForTarget(target, ctx.natal.dayMaster, pillarSetOf(ctx));
      return classifyBand(strength, cuts) === band;
    }

    case 'hwa_sipsung': {
      // #477 P4b — 효과적 십성(ADR-0038). 오늘 풀셋에서 합화 변환이 일어나면 化 오행의 일간 대비
      // 5그룹 십성을 산출 → seed.sipsin과 일치 시 발현. 합화 성립일에만 fire(sparse, 윈도우 비의존).
      const sipsin = aux['sipsin'];
      if (!isSipsinGroup(sipsin)) return false;
      const { transforms } = detectHwaTransforms(pillarSetOf(ctx), SAJU_HWA_PARAMS);
      if (transforms.length === 0) return false;
      const dmElement = getElementByCheongan(ctx.natal.dayMaster);
      return transforms.some((t) => elementToSipsinGroup(dmElement, t.element) === sipsin);
    }

    case 'life_signal': {
      // Phase 3 — life_signal 단일 type + trigger_aux.kind 분기 (ADR-0029)
      if (!isLifeSignalAux(aux)) return false;
      return dispatchLifeSignal(aux, ctx);
    }

    default:
      return false;
  }
};
