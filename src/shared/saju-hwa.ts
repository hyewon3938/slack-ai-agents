/**
 * 결정론 합화(合化) 변환 탐지 — #477 P4b (ADR-0038).
 *
 * 합(천간합/육합/삼합)이 化신 통근 조건을 만족하면 구성 글자의 오행을 化 오행으로 변환한다.
 * 변환 결과는 두 렌즈로 소비된다:
 *   - magnitude: saju-strength가 변환 글자 기준으로 강도를 재계산(입력단 공통 변환).
 *   - role: pattern-match의 hwa_sipsung 트리거가 化 오행의 일간 대비 효과적 십성을 검정 시드로.
 *
 * 검증 깊이 = v1a (합 성립[化신 통근] + 충개합[충이 합 멤버를 치면 무효]).
 * 탐합망충·쟁합/투합·형파·거리 같은 깊은 상호작용은 SAJU_HWA_PARAMS 노브(기본 off)로 둔다 —
 * 검증은 얕게(off-day가 v1a/v1c를 구분할 검정력이 없음), 깊은 해석은 narrative LLM 책임(ADR-0038 §3).
 *
 * 순수 함수(DB·시각 의존 0) → SET 결정론 리플레이·e-value 불변(ADR-0034) + 단위 테스트 용이.
 */

import {
  CHEONGAN_HAP_RULES,
  JIJI_YUKHAP_RULES,
  JIJI_SAMHAP_RULES,
  JIJI_CHUNG_PAIRS,
  getElementByCheongan,
  getElementByJiji,
  getJijanggan,
  type Cheongan,
  type Element,
  type Jiji,
  type Pillar,
  type PillarSet,
} from './saju-calendar.js';
import type { HwaParams } from './saju-strength-params.js';

/** 효과적 십성 5그룹 (化 오행의 일간 대비 관계 — polarity 무관, 학파 의존성 회피). */
export type SipsinGroup = '비겁' | '식상' | '재성' | '관성' | '인성';

const SIPSIN_GROUPS: readonly SipsinGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

/** trigger_aux.sipsin을 SipsinGroup으로 좁히는 type guard (잘못된 값은 false). */
export const isSipsinGroup = (v: unknown): v is SipsinGroup =>
  typeof v === 'string' && (SIPSIN_GROUPS as readonly string[]).includes(v);

const ELEMENT_ORDER: readonly Element[] = ['목', '화', '토', '금', '수'];

/**
 * 일간 오행 대비 대상 오행의 효과적 십성 그룹. 상생/상극 순환(목→화→토→금→수)으로 분류.
 *   같음=비겁 / 일간이 생=식상 / 일간이 극=재성 / 대상이 일간을 극=관성 / 대상이 일간을 생=인성
 */
export const elementToSipsinGroup = (dayMasterElement: Element, target: Element): SipsinGroup => {
  const d = ELEMENT_ORDER.indexOf(dayMasterElement);
  const t = ELEMENT_ORDER.indexOf(target);
  const diff = (((t - d) % 5) + 5) % 5;
  switch (diff) {
    case 1:
      return '식상'; // 일간 → 대상 (목생화)
    case 2:
      return '재성'; // 일간 극 대상 (목극토)
    case 3:
      return '관성'; // 대상 극 일간 (금극목 → 금=관)
    case 4:
      return '인성'; // 대상 → 일간 (수생목 → 수=인)
    default:
      return '비겁'; // diff 0
  }
};

/** 합화 변환 1건 (디버그·표시용 + 검정 입력). */
export interface HwaTransform {
  /** 변환 종류 — 천간합/지지합 */
  slot: 'cheongan' | 'jiji';
  /** 化 오행 */
  element: Element;
  /** 합을 이룬 글자 (표시용) */
  chars: string[];
}

export interface HwaResult {
  transforms: HwaTransform[];
  /** 변환된 천간 글자 위치(Pillar 참조) → 化 오행. 강도 계산이 effective element로 사용. */
  stemOverride: Map<Pillar, Element>;
  /** 변환된 지지 본기 위치(Pillar 참조) → 化 오행. */
  branchOverride: Map<Pillar, Element>;
}

/** PillarSet → 활성 pillar 평탄화 (saju-strength.flattenPillars와 동일 집합 — Pillar 객체 참조 공유). */
const flatten = (ps: PillarSet): Pillar[] => {
  const list: Pillar[] = [...ps.wonguk];
  if (ps.daeun) list.push(ps.daeun);
  list.push(ps.seun, ps.wolun, ps.ilun);
  return list;
};

const isChung = (a: Jiji, b: Jiji): boolean =>
  JIJI_CHUNG_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

const findCheonganHap = (a: Cheongan, b: Cheongan): Element | null => {
  for (const rule of CHEONGAN_HAP_RULES) {
    const [x, y] = rule.stems;
    if ((a === x && b === y) || (a === y && b === x)) return rule.element;
  }
  return null;
};

const findYukhap = (a: Jiji, b: Jiji): Element | null => {
  for (const rule of JIJI_YUKHAP_RULES) {
    const [x, y] = rule.branches;
    if ((a === x && b === y) || (a === y && b === x)) return rule.element;
  }
  return null;
};

/**
 * 합화 변환 탐지. 입력 = 운 풀셋, 출력 = 변환 목록 + effective element override 맵.
 *
 * 깊은 상호작용 노브(HWA_TAMHAP_MANGCHUNG·HWA_JAENGHAP·HWA_HYUNGPA_BREAK·HWA_DISTANCE)는
 * 본 v1a에서 미적용 — 켜질 자리는 충개합 해소 단계(brokenByChung) 주변에 둔다(헌장 ④, 후속 phase).
 */
export const detectHwaTransforms = (ps: PillarSet, params: HwaParams): HwaResult => {
  const pillars = flatten(ps);
  const dayPillar = ps.wonguk[2] ?? null; // 원국 일주(year/month/day/hour 순) → 일간
  const transforms: HwaTransform[] = [];
  const stemOverride = new Map<Pillar, Element>();
  const branchOverride = new Map<Pillar, Element>();

  /** 化신 통근 — 化 오행이 활성 지지의 본기/지장간(중기/여기)에 뿌리내림. */
  const isRooted = (el: Element): boolean => {
    if (!params.HWA_REQUIRE_ROOT) return true;
    return pillars.some((p) => {
      if (getElementByJiji(p.jiji) === el) return true;
      const jg = getJijanggan(p.jiji);
      if (getElementByCheongan(jg.yeogi) === el) return true;
      return jg.junggi !== undefined && getElementByCheongan(jg.junggi) === el;
    });
  };

  /** 충개합 — 합 멤버 지지 중 하나라도 다른 활성 지지와 충이면 합 무효(v1a). */
  const brokenByChung = (members: readonly Pillar[]): boolean => {
    if (!params.HWA_CHUNGGAEHAP) return false;
    for (const m of members) {
      for (const other of pillars) {
        if (other !== m && isChung(m.jiji, other.jiji)) return true;
      }
    }
    return false;
  };

  // ── 천간합 ──
  for (let i = 0; i < pillars.length; i++) {
    for (let j = i + 1; j < pillars.length; j++) {
      const pa = pillars[i];
      const pb = pillars[j];
      const element = findCheonganHap(pa.cheongan, pb.cheongan);
      if (!element) continue;
      // 일간 예외 — 합이 일간 천간에 닿으면 v1 보수적 불변(학파 의존).
      if (!params.HWA_DAYMASTER_TRANSFORM && dayPillar && (pa === dayPillar || pb === dayPillar)) {
        continue;
      }
      if (!isRooted(element)) continue;
      stemOverride.set(pa, element);
      stemOverride.set(pb, element);
      transforms.push({ slot: 'cheongan', element, chars: [pa.cheongan, pb.cheongan] });
    }
  }

  // ── 지지 육합 ──
  for (let i = 0; i < pillars.length; i++) {
    for (let j = i + 1; j < pillars.length; j++) {
      const pa = pillars[i];
      const pb = pillars[j];
      const element = findYukhap(pa.jiji, pb.jiji);
      if (!element) continue;
      if (brokenByChung([pa, pb])) continue;
      if (!isRooted(element)) continue;
      branchOverride.set(pa, element);
      branchOverride.set(pb, element);
      transforms.push({ slot: 'jiji', element, chars: [pa.jiji, pb.jiji] });
    }
  }

  // ── 지지 삼합 (3지 전부 존재 시 — v1은 반삼합 변환 제외) ──
  for (const rule of JIJI_SAMHAP_RULES) {
    const memberPillars = rule.branches.map((b) => pillars.filter((p) => p.jiji === b));
    if (memberPillars.some((arr) => arr.length === 0)) continue;
    const members = memberPillars.flat();
    if (brokenByChung(members)) continue;
    if (!isRooted(rule.element)) continue;
    for (const p of members) branchOverride.set(p, rule.element);
    transforms.push({ slot: 'jiji', element: rule.element, chars: [...rule.branches] });
  }

  return { transforms, stemOverride, branchOverride };
};
