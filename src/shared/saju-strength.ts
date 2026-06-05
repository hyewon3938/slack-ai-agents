/**
 * 결정론 사주 실효강도 엔진 — #477 P4a (ADR-0036).
 *
 * saju-calendar.ts의 결정론 primitive(오행·지장간) 위에 "오행/일간의 실효 강도"를 올린다.
 *   strength(X) = Σ글자[ ±contrib · 위치가중 · 월령배수 ] + 통근보너스(X)
 *     부호: 비겁·인성(생조) → +saengjo  /  식상·재·관(극설) → −geukseol
 *     위치: 천간 / 지지 본기(정기) / 지장간 중기 / 지장간 여기
 *     월령(간결판): 원국 월지 본기 오행과 같은 글자는 ×W_WOLLYEONG (득령)
 *     통근(게이트): 대상 오행이 천간 투출 + 지장간 뿌리를 동시에 가지면 +W_TONGGEUN
 *
 * 전부 파라미터(saju-strength-params.ts) — 0이면 그 규칙 비활성(헌장 ⑤).
 * 상대 분위수 밴드(ADR-0036)로 검정에 태우므로 절대 스케일이 아니라 "내 안 상대 강/약"만 의미.
 * 본 모듈은 순수 계산(DB·시각 의존 0) → 단위 테스트 용이.
 */

import {
  getElementByCheongan,
  getElementByJiji,
  getJijanggan,
  type Cheongan,
  type Element,
  type Pillar,
  type PillarSet,
} from './saju-calendar.js';
import { SAJU_STRENGTH_PARAMS, type SajuStrengthParams } from './saju-strength-params.js';

const ELEMENTS: readonly Element[] = ['목', '화', '토', '금', '수'];
const ELEMENT_INDEX: Record<Element, number> = { 목: 0, 화: 1, 토: 2, 금: 3, 수: 4 };

/** 강도 밴드 대상 — 일간(일간 오행으로 해석) 또는 특정 오행 */
export type StrengthTarget = 'day_master' | Element;

const STRENGTH_TARGETS: readonly StrengthTarget[] = ['day_master', '목', '화', '토', '금', '수'];

/** trigger_aux.target를 StrengthTarget으로 좁히는 type guard (잘못된 값은 false). */
export const isStrengthTarget = (v: unknown): v is StrengthTarget =>
  typeof v === 'string' && (STRENGTH_TARGETS as readonly string[]).includes(v);

export type AbsoluteStrengthState = '신강' | '중화' | '신약';

export interface ElementStrengths {
  /** 일간 오행의 실효 강도 (= byElement[일간 오행]) — 신강/신약 축 */
  dayMaster: number;
  byElement: Record<Element, number>;
}

/** 글자 1개의 (오행, 위치가중) */
interface CharContribution {
  element: Element;
  weight: number;
}

const isSamePolaritySupport = (cElem: Element, xElem: Element): boolean => {
  const c = ELEMENT_INDEX[cElem];
  const x = ELEMENT_INDEX[xElem];
  // 비겁(동일 오행) 또는 인성(c가 x를 생: (c+1)%5===x) → 생조(+)
  return c === x || (c + 1) % 5 === x;
};

/** 원국 + 운 풀셋의 모든 글자를 (오행, 기본 위치가중)으로 펼친다. 정기=본기로 1회만(중복 방지). */
const collectChars = (
  pillars: readonly Pillar[],
  params: SajuStrengthParams,
): CharContribution[] => {
  const chars: CharContribution[] = [];
  for (const p of pillars) {
    chars.push({ element: getElementByCheongan(p.cheongan), weight: params.W_STEM });
    chars.push({ element: getElementByJiji(p.jiji), weight: params.W_BRANCH_MAIN }); // 본기(정기)
    const jg = getJijanggan(p.jiji);
    if (jg.junggi) {
      chars.push({ element: getElementByCheongan(jg.junggi), weight: params.W_JANGGAN_MID });
    }
    chars.push({ element: getElementByCheongan(jg.yeogi), weight: params.W_JANGGAN_YEOGI });
  }
  return chars;
};

/** PillarSet → 평탄화된 pillar 배열 (null 운 레벨 제외) */
const flattenPillars = (pillarSet: PillarSet): Pillar[] => {
  const list: Pillar[] = [...pillarSet.wonguk];
  if (pillarSet.daeun) list.push(pillarSet.daeun);
  list.push(pillarSet.seun, pillarSet.wolun, pillarSet.ilun);
  return list;
};

/** 간결판 월령 사령 오행 = 원국 월지(wonguk[1]) 본기 오행. 월주 없으면 null(월령 비활성). */
const monthDominantElement = (pillarSet: PillarSet): Element | null => {
  const monthPillar = pillarSet.wonguk[1];
  return monthPillar ? getElementByJiji(monthPillar.jiji) : null;
};

/** 대상 오행 X의 생조(support)·극설(drain) 분해. net = support − drain. 통근은 support에 가산. */
const decompose = (
  xElem: Element,
  pillars: readonly Pillar[],
  pillarSet: PillarSet,
  params: SajuStrengthParams,
): { support: number; drain: number } => {
  const chars = collectChars(pillars, params);
  const season = monthDominantElement(pillarSet);

  let support = 0;
  let drain = 0;
  for (const ch of chars) {
    let w = ch.weight;
    if (season !== null && ch.element === season) w *= params.W_WOLLYEONG;
    if (isSamePolaritySupport(ch.element, xElem)) support += params.saengjo * w;
    else drain += params.geukseol * w;
  }

  // 통근 게이트: X가 천간 투출 + 지장간 뿌리를 동시에 가지면 support 보너스(이진).
  const hasStem = pillars.some((p) => getElementByCheongan(p.cheongan) === xElem);
  const hasRoot = pillars.some((p) => {
    const jg = getJijanggan(p.jiji);
    return (
      getElementByJiji(p.jiji) === xElem ||
      (jg.junggi !== undefined && getElementByCheongan(jg.junggi) === xElem) ||
      getElementByCheongan(jg.yeogi) === xElem
    );
  });
  if (hasStem && hasRoot) support += params.W_TONGGEUN;

  return { support, drain };
};

/** 대상 오행 X의 실효 강도 (생조 − 극설) */
const strengthOf = (
  xElem: Element,
  pillars: readonly Pillar[],
  pillarSet: PillarSet,
  params: SajuStrengthParams,
): number => {
  const { support, drain } = decompose(xElem, pillars, pillarSet, params);
  return support - drain;
};

/** 일간 + 오행 5종 실효 강도 일괄 계산. */
export const computeElementStrengths = (
  dayMaster: Cheongan,
  pillarSet: PillarSet,
  params: SajuStrengthParams = SAJU_STRENGTH_PARAMS,
): ElementStrengths => {
  const pillars = flattenPillars(pillarSet);
  const byElement = {} as Record<Element, number>;
  for (const x of ELEMENTS) byElement[x] = strengthOf(x, pillars, pillarSet, params);
  return { dayMaster: byElement[getElementByCheongan(dayMaster)], byElement };
};

/** 단일 대상(day_master | 오행)의 강도 — 2-pass·일별 cron 공용 진입점. */
export const computeStrengthForTarget = (
  target: StrengthTarget,
  dayMaster: Cheongan,
  pillarSet: PillarSet,
  params: SajuStrengthParams = SAJU_STRENGTH_PARAMS,
): number => {
  const xElem = target === 'day_master' ? getElementByCheongan(dayMaster) : target;
  return strengthOf(xElem, flattenPillars(pillarSet), pillarSet, params);
};

/**
 * 절대 신강/중화/신약 상태 (검정 비사용 — 맥락·미래 데이터, ADR-0036).
 * 일간 오행 생조 비율 = support/(support+drain). 스케일 무관(비율)이라 가중치 절대값에 둔감.
 */
export const computeAbsoluteStrengthState = (
  dayMaster: Cheongan,
  pillarSet: PillarSet,
  params: SajuStrengthParams = SAJU_STRENGTH_PARAMS,
): AbsoluteStrengthState => {
  const xElem = getElementByCheongan(dayMaster);
  const { support, drain } = decompose(xElem, flattenPillars(pillarSet), pillarSet, params);
  const total = support + drain;
  if (total <= 0) return '중화';
  const ratio = support / total;
  if (ratio >= params.ABS_STRONG_RATIO) return '신강';
  if (ratio <= params.ABS_WEAK_RATIO) return '신약';
  return '중화';
};

/**
 * 오행 비율 (노출·covariate용, 별도 시드 없음 — 강도에 흡수, ADR-0036).
 * 천간 + 지지 본기 발현 빈도 분포(정규화). 강도와 달리 부호·가중 없는 단순 분포.
 */
export const computeElementRatios = (pillarSet: PillarSet): Record<Element, number> => {
  const counts = { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 } as Record<Element, number>;
  let total = 0;
  for (const p of flattenPillars(pillarSet)) {
    counts[getElementByCheongan(p.cheongan)]++;
    counts[getElementByJiji(p.jiji)]++;
    total += 2;
  }
  if (total === 0) return counts;
  const ratios = {} as Record<Element, number>;
  for (const x of ELEMENTS) ratios[x] = counts[x] / total;
  return ratios;
};
