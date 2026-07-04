/**
 * off-day 대조 검증 엔진 코어 — #477 P2 (ADR-0032 통계 스택 + ADR-0033 매트릭=가설).
 *
 * (시드 × 신호) = pattern_links 를 off-day 대조로 검증한다:
 *   발현일(트리거 fire) vs 비발현일에서 신호 pass율을 2×2로 비교 → Fisher + BH-FDR + Beta-Binomial.
 *   "본인 패턴"과 "그냥 base rate가 높은 신호(기분탓)"를 분리하는 게 핵심(헌장 ②).
 *
 * P1 신호 전역화의 payoff: 신호별 일자 시리즈를 **신호당 1회**, 시드별 활성 시리즈를 **시드당 1회**
 * 계산하고, 링크는 그 위 조인 + 2×2 → O(신호 + 시드)로 환원(옛 per-link 재계산 대비).
 *
 * P3(ADR-0034): 확정 게이트 = 누적 e-value(순차 anytime-valid). q는 screening, e≥1/α(=20)이
 * 'confirmed' 승격(verified tier). 일자 순서가 필요해 2×2 collapse 외에 day 시퀀스도 만든다.
 * 본 모듈은 순수 계산 + 읽기만. UPDATE pattern_links·Slack 발송은 weekly-verification.ts.
 */

import { query } from './db.js';
import { findEquivalentSignal } from './signal-defs.js';
import { addDays } from './kst.js';
import {
  fisherExact,
  bhFdr,
  evalueTestMartingale,
  mannWhitneyU,
  blockPermutationP,
  type DayObservation,
  type MannWhitneyResult,
} from './stats.js';
import {
  cumulativePosteriorFromHitMiss,
  empiricalBetaPrior,
  posteriorMean,
  type BetaPosterior,
} from './bayesian-posterior.js';
import {
  evaluateTrigger,
  getDailyContext,
  loadActiveSeeds,
  runMetricSql,
  runLlmSignalSql,
  buildNameIdMap,
  type SajuSeedWithMetrics,
  type DailyContext,
} from './pattern-match.js';
import {
  computeStrengthForTarget,
  isStrengthTarget,
  type StrengthTarget,
} from './saju-strength.js';
import { tertileCuts, classifyBand, isBand, type BandCuts } from './quantile.js';
import type { PillarSet } from './saju-calendar.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';
import { seedLabel, signalLabel } from './insight-labels.js';
import { BEHAVIOR_SIGNAL_DOMAIN } from './insights.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

export type SignalDirection =
  | 'above_avg'
  | 'below_avg'
  | 'above_abs'
  | 'below_abs'
  | 'flag_present';

export type LinkLifecycleStatus =
  | 'active'
  | 'pending'
  | 'weak'
  | 'confirmed'
  | 'rejected'
  | 'archived';

// direction_mismatch(#555): 충분한 표본에서 명확한 역방향(effect ≤ directionMismatchMaxEffect).
// reject(무연관)와 lifecycle은 같이 'rejected'로 종결하되 사유를 분리 — reject=무연관, direction_mismatch=역방향.
export type Verdict = 'confirm' | 'reject' | 'insufficient' | 'inconclusive' | 'direction_mismatch';

/** 신호 일자 시리즈: pass=true / fail=false / 측정불가=null(2×2에서 제외). */
export type DaySeries = Map<string, boolean | null>;

export interface SignalDef {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  /** signal_defs.source — 'llm'이면 sql 신호 시리즈 계산 시 격리 실행기 사용 (#477 P5b). */
  source: 'seed' | 'llm';
  sqlBody: string | null;
  valueType: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: number | null;
  tagName: string | null;
  windowDays: number | null;
  /** signal_defs.domain — 데이터-존재 윈도우 산출용 (#504, ADR-0044). */
  domain: string | null;
}

export interface Contingency {
  a: number; // 발현 & pass
  b: number; // 발현 & fail
  c: number; // 비발현 & pass
  d: number; // 비발현 & fail
  inconclusive: number; // 발현일인데 신호 측정불가(null)
}

export interface ContingencyVerification {
  p: number;
  effect: number; // rate ratio = (a/(a+b)) / (c/(c+d))
  rateActive: number;
  rateOff: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  nActive: number;
  nOff: number;
}

export interface LinkVerification {
  linkId: number;
  seedId: number;
  signalId: number;
  seedName: string;
  /** 카드용 자연어 라벨 — seedName 변수명 대체 (#504 P2, ADR-0045). */
  seedLabel: string;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  /** 카드용 자연어 라벨 — signalName 변수명·깨진 provenance 대체 (#504 P2, ADR-0045). */
  signalLabel: string;
  signalKind: 'sql' | 'tag';
  valueType: 'binary' | 'continuous' | null;
  currentStatus: LinkLifecycleStatus;
  a: number;
  b: number;
  c: number;
  d: number;
  inconclusive: number;
  nActive: number;
  nOff: number;
  rateActive: number;
  rateOff: number;
  effect: number;
  pValue: number; // block permutation p (자기상관 보정, BH-FDR 입력) — P3
  fisherP: number; // Fisher exact p (참고용 → test_detail)
  qValue: number; // bhFdr(blockP)
  mannWhitney: MannWhitneyResult | null; // 연속 신호 보고용 효과크기 (test_detail) — P3
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  eValue: number; // 누적 e-value sup (P3, ADR-0034). ≥ evalueThreshold → confirmed.
  lastMatchedAt: string | null;
  /** 데이터-존재 + enrollment 클립 합성 윈도우 시작 (관측성 → test_detail.window_start). #523 P0. */
  windowStart: string | null;
  /** BH-FDR 가족 (관측성 → 주간 로그 가족별 m 추적). #523 P0. */
  family: FdrFamily;
  /** 전·후반 효과 부호 일치(표시용, 게이트 아님) → test_detail + 프로필 셀. #523 P1, §2-6. */
  stability: boolean | null;
  verdict: Verdict;
  nextStatus: LinkLifecycleStatus;
}

// ─── 데이터-존재 윈도우 (#504, ADR-0044) ─────────────────
// 발굴·검증의 측정 아티팩트 제거: 윈도우를 365일 고정이 아니라 "그 시드와 그 신호가 둘 다
// 데이터를 가진 구간"으로 한정한다. 사용자가 시스템을 쓰기 시작한 날(첫 기록) 이전의 빈 과거는
// COALESCE(SUM,0)=0=fail로 세지 않는다(비발현 pass율 0 → rate ratio 폭발 = GIGO). 활성 기간 내
// "기록 없음"은 의미로 살린다(floor 위는 보존). 검증·발굴 양쪽이 동일 클립을 경유 → 둘 다 정직.

/** 신호 domain → 데이터-존재 기준 테이블. audit는 기록 계기(schedule_changes) 자체의 시작을 따름. */
const DOMAIN_TABLE: Record<string, string> = {
  schedule: 'schedules',
  routine: 'routine_records',
  sleep: 'sleep_records',
  expense: 'expenses',
  expense_category_present: 'expenses',
  diary_meta: 'diary_meta_tags',
  audit: 'schedule_changes',
};

/** 글로벌 floor(온보딩) 산출 대상 테이블 — DATE+user_id 보유 라이프 데이터 테이블. */
const DATA_TABLES = [
  'schedules',
  'routine_records',
  'sleep_records',
  'expenses',
  'diary_meta_tags',
] as const;

// life_signal behavior_baseline signal_name → 의존 도메인: insights.ts의 BEHAVIOR_SIGNAL_DOMAIN이
// 단일 진실(각 detect 함수의 domain 선언). #510 — 옛 로컬 맵이 slotGap·weekComparison을 schedule로
// 적던 드리프트 제거(실제는 routine_records 집계 = routine).

export interface UserDataStarts {
  /** 테이블별 첫 기록일(YYYY-MM-DD). 데이터 없는 테이블은 키 없음. */
  byTable: Map<string, string>;
  /** 전체 최소 = 글로벌 온보딩 floor. 매핑 누락 도메인·saju 시드 fallback. null=데이터 0(클립 안 함). */
  global: string | null;
}

/**
 * 유저의 라이프 데이터 테이블별 첫 기록일 + 글로벌 floor를 1회 산출 (#504).
 * 테이블명은 고정 allowlist(DATA_TABLES)라 인터폴레이션 안전(파라미터화 불가 대상).
 */
export const computeUserDataStarts = async (userId: number): Promise<UserDataStarts> => {
  const byTable = new Map<string, string>();
  for (const table of DATA_TABLES) {
    const res = await query<{ d: string | null }>(
      `SELECT MIN(date)::text AS d FROM ${table} WHERE user_id = $1`,
      [userId],
    );
    const d = res.rows[0]?.d ?? null;
    if (d) byTable.set(table, d);
  }
  let global: string | null = null;
  for (const d of byTable.values()) if (global === null || d < global) global = d;

  // audit 도메인 특례(#572 ADR-0054): 기록 계기(schedule_changes)는 date 컬럼 없이 changed_at뿐이라
  // DATA_TABLES 루프(MIN(date))에 못 들어간다. audit이 기록 가능해진 날(첫 changed_at, KST)부터가 존재
  // 구간 — schedules 첫 데이터가 아니라. global floor 산출 뒤에 넣어 온보딩 floor를 오염시키지 않는다
  // (audit 계기는 라이프 데이터 시작이 아님).
  const auditRes = await query<{ d: string | null }>(
    `SELECT MIN(DATE(changed_at AT TIME ZONE 'Asia/Seoul'))::text AS d
       FROM schedule_changes WHERE user_id = $1`,
    [userId],
  );
  const auditStart = auditRes.rows[0]?.d ?? null;
  if (auditStart) byTable.set('schedule_changes', auditStart);

  return { byTable, global };
};

/** 신호 domain → 데이터-존재 시작일 (매핑 없거나 데이터 없으면 글로벌 floor). */
export const signalDataStart = (domain: string | null, starts: UserDataStarts): string | null => {
  const table = domain ? DOMAIN_TABLE[domain] : undefined;
  return (table ? starts.byTable.get(table) : undefined) ?? starts.global;
};

/** life_signal trigger_aux → 의존 라이프 도메인 (calendar 류는 null = 데이터 비의존 → floor). */
const lifeSignalDomain = (aux: Record<string, unknown> | null): string | null => {
  if (!aux) return null;
  const kind = aux['kind'];
  if (kind === 'threshold') {
    const source = aux['source'];
    if (source === 'sleep_minutes') return 'sleep';
    if (source === 'routine_streak_max') return 'routine';
    return null;
  }
  if (kind === 'behavior_baseline') {
    const name = aux['signal_name'];
    return (
      (typeof name === 'string'
        ? (BEHAVIOR_SIGNAL_DOMAIN as Record<string, string>)[name]
        : undefined) ?? null
    );
  }
  return null; // weekday/weekday_group/month_position/season/calendar_event = 캘린더(데이터 비의존)
};

/** 시드 데이터-존재 시작일. saju=글로벌 floor(매일 일운 존재), life_signal=의존 도메인 시작(없으면 floor). */
export const seedDataStart = (
  seed: { trigger_target_type: string; trigger_aux: Record<string, unknown> | null },
  starts: UserDataStarts,
): string | null => {
  if (seed.trigger_target_type !== 'life_signal') return starts.global;
  const domain = lifeSignalDomain(seed.trigger_aux);
  const table = domain ? DOMAIN_TABLE[domain] : undefined;
  return (table ? starts.byTable.get(table) : undefined) ?? starts.global;
};

/** 두 ISO 일자의 max (null = 제약 없음 = -무한). 둘 다 null이면 null. */
export const maxDate = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
};

/**
 * 등록(enrollment) 클립 시작일 — 선택 편향 차단 (#523 Phase 0, D1, ADR-0048).
 * 발굴(discovery)·LLM 제안 출신 링크는 자기를 뽑은 데이터로 그대로 확정되는 double-dipping을
 * 막기 위해 검정 시퀀스를 등록(created_at, KST) 다음 날부터로 한정한다 — e-value의 "test from now"
 * 정신(가설이 데이터와 독립으로 고정된 뒤부터만 검정). 카탈로그(manual=선험 가설) 링크는 선택이
 * 없으므로 전체 데이터 윈도우 유지(null = 제약 없음). createdDate 결측 시에도 클립 없음(보수적).
 */
export const enrollmentStart = (source: string, createdDateKst: string | null): string | null => {
  if (source === 'manual') return null;
  if (createdDateKst === null) return null;
  return addDays(createdDateKst, 1);
};

// ─── 순수 계산 ───────────────────────────────────────────

/** today 포함 [today - cap, today] 오름차순 ISO 일자 배열. */
export const buildWindowDates = (today: string, cap: number): string[] => {
  const dates: string[] = [];
  for (let i = cap; i >= 0; i--) dates.push(addDays(today, -i));
  return dates;
};

/**
 * above_avg/below_avg용 rolling baseline = 직전 windowDays 일의 non-null raw 평균.
 * 워밍업(i < windowDays) 미충족 시 null(2×2에서 제외 → 초기 28일 같은 미성숙 baseline 배제).
 */
const rollingBaseline = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  i: number,
  windowDays: number,
): number | null => {
  if (i < windowDays) return null;
  let sum = 0;
  let n = 0;
  for (let j = i - windowDays; j < i; j++) {
    const v = rawByDate.get(windowDates[j] ?? '');
    if (v !== null && v !== undefined) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
};

/**
 * sql 신호 raw 값 시리즈를 direction 기준 이진화.
 * above_avg/below_avg는 baseline 이진화(ADR-0032 §3 — e-value 게이트는 이진, 연속은 baseline 이진화).
 * above_abs/below_abs/flag_present는 절대 임계 비교(baseline 불요).
 */
export const binarizeSqlSeries = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  direction: SignalDirection,
  threshold: number | null,
  windowDays: number,
): DaySeries => {
  const series: DaySeries = new Map();
  for (let i = 0; i < windowDates.length; i++) {
    const date = windowDates[i] ?? '';
    const v = rawByDate.get(date);
    if (v === null || v === undefined) {
      series.set(date, null);
      continue;
    }
    switch (direction) {
      case 'above_abs':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'below_abs':
        series.set(date, v <= (threshold ?? 0));
        break;
      case 'flag_present':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'above_avg':
      case 'below_avg': {
        const base = rollingBaseline(rawByDate, windowDates, i, windowDays);
        if (base === null) {
          series.set(date, null);
          break;
        }
        series.set(date, direction === 'above_avg' ? v > base : v < base);
        break;
      }
    }
  }
  return series;
};

/**
 * 시드 활성 시리즈 × 신호 시리즈 → 2×2 (신호 측정불가일은 inconclusive로 분리).
 * windowStart(#504): 데이터-존재 구간 시작 — 이전 날은 빈 과거라 2×2에서 제외(아티팩트 차단).
 */
export const buildContingency = (
  activation: Map<string, boolean>,
  signalSeries: DaySeries,
  windowStart: string | null = null,
): Contingency => {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let inconclusive = 0;
  for (const [date, active] of activation) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거)
    const pass = signalSeries.get(date);
    if (pass === undefined) continue; // 윈도우 밖(이론상 없음)
    if (pass === null) {
      if (active) inconclusive++;
      continue;
    }
    if (active) {
      if (pass) a++;
      else b++;
    } else if (pass) c++;
    else d++;
  }
  return { a, b, c, d, inconclusive };
};

/**
 * 시드 활성 × 신호 시리즈 → 일자 오름차순 (active, pass) 시퀀스 — e-value 마틴게일 입력(P3).
 * 측정불가일(pass=null)은 제외. windowDates 순서로 순회해 결정론 리플레이 불변 보장(ADR-0034).
 */
export const buildDaySequence = (
  activation: Map<string, boolean>,
  signalSeries: DaySeries,
  windowDates: string[],
  windowStart: string | null = null,
): DayObservation[] => {
  const seq: DayObservation[] = [];
  for (const date of windowDates) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거) — #504
    const pass = signalSeries.get(date);
    if (pass === null || pass === undefined) continue;
    seq.push({ active: activation.get(date) ?? false, pass });
  }
  return seq;
};

/**
 * daySeq 전·후반 효과 부호(발현일 pass율 − 비발현일 pass율) 일치 여부 — 비정상성/단일국면 의존 표시 플래그
 * (#523 P1, §2-6). 게이트 아님(노출용 stability). 각 반에 발현·비발현 양쪽 관측이 있어야 부호 산출 가능 —
 * 한쪽이라도 결측이면 null(판정 보류). 길이 < minPerHalf*2 면 null. 입력 순서 고정 = SET 리플레이 불변(ADR-0034).
 */
export const splitHalvesConsistent = (
  daySeq: ReadonlyArray<DayObservation>,
  minPerHalf = 4,
): boolean | null => {
  if (daySeq.length < minPerHalf * 2) return null;
  const mid = Math.floor(daySeq.length / 2);
  const effectSign = (seq: ReadonlyArray<DayObservation>): number | null => {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (const o of seq) {
      if (o.active) {
        if (o.pass) a++;
        else b++;
      } else if (o.pass) c++;
      else d++;
    }
    if (a + b === 0 || c + d === 0) return null; // 한쪽 결측 → 부호 산출 불가
    return Math.sign(a / (a + b) - c / (c + d));
  };
  const s1 = effectSign(daySeq.slice(0, mid));
  const s2 = effectSign(daySeq.slice(mid));
  if (s1 === null || s2 === null) return null;
  return s1 === s2;
};

/** 2×2 → Fisher p + rate ratio + Beta-Binomial posterior. */
export const verifyContingency = (cont: Contingency): ContingencyVerification => {
  const nActive = cont.a + cont.b;
  const nOff = cont.c + cont.d;
  const p = nActive > 0 && nOff > 0 ? fisherExact(cont.a, cont.b, cont.c, cont.d) : NaN;
  const rateActive = nActive > 0 ? cont.a / nActive : NaN;
  const rateOff = nOff > 0 ? cont.c / nOff : NaN;
  const effect =
    Number.isFinite(rateActive) && Number.isFinite(rateOff) && rateOff > 0
      ? rateActive / rateOff
      : NaN;
  const { alpha, beta } = cumulativePosteriorFromHitMiss(cont.a, cont.b);
  return {
    p,
    effect,
    rateActive,
    rateOff,
    posteriorAlpha: alpha,
    posteriorBeta: beta,
    posteriorP: posteriorMean(alpha, beta),
    nActive,
    nOff,
  };
};

/**
 * verdict 분류 (provisional). confirm은 P3 e-value 전까지 승격 안 함(statusForVerdict 참조).
 *   confirm:            nActive≥MIN & q≤CONFIRM_Q & effect≥MIN_RATE_RATIO
 *   direction_mismatch: nActive≥MIN & effect≤DIRECTION_MISMATCH_MAX (명확한 역방향 — #555)
 *   reject:             nActive≥MIN & effect∈[REJECT_LOW, REJECT_HIGH] (연관 없음)
 *   insufficient:       nActive<MIN 또는 effect 산출 불가(off일 0)
 *   inconclusive:       그 외(데이터는 충분하나 판정 보류)
 *
 * direction_mismatch는 reject 밴드보다 먼저 판정한다(#555). 게이트(≤0.77)와 reject 밴드(0.95~1.05)는
 * 겹치지 않지만, 역방향은 "무연관"이 아니라 "반대 방향 신호"이므로 사유를 분리해 종결한다.
 */
export const classifyVerdict = (
  v: Pick<ContingencyVerification, 'nActive' | 'effect'>,
  q: number,
): Verdict => {
  if (v.nActive < V.minActiveDays || !Number.isFinite(v.effect)) return 'insufficient';
  if (Number.isFinite(q) && q <= V.confirmQ && v.effect >= V.minRateRatio) return 'confirm';
  if (v.effect <= V.directionMismatchMaxEffect) return 'direction_mismatch';
  if (v.effect >= V.rejectRatioLow && v.effect <= V.rejectRatioHigh) return 'reject';
  return 'inconclusive';
};

/**
 * P3 status 전이 정책 (ADR-0034 e-value 게이트). verified tier = status='confirmed'.
 *   - reject·direction_mismatch(충분한 데이터의 종결) → 'rejected' (정당한 제거).
 *     둘 다 rejected lifecycle이지만 사유는 test_detail.verdict로 구분(별도 status enum·DB CHECK 불변, #555).
 *   - confirm & e_value ≥ 1/α(=20) → 'confirmed' (verified tier 승격). optional stopping 안전.
 *   - 그 외(confirm이나 e<20, inconclusive, insufficient) → 'active' 유지(emerging은 view가 분류).
 *   - confirmed는 sticky — verifyUserLinks가 active만 재검증하므로 한번 승격되면 동결(금딱지).
 *   - pending/archived 등 non-active는 엔진이 건드리지 않음.
 */
export const statusForVerdict = (
  verdict: Verdict,
  current: LinkLifecycleStatus,
  eValue: number,
): LinkLifecycleStatus => {
  if (current !== 'active') return current;
  if (verdict === 'reject' || verdict === 'direction_mismatch') return 'rejected';
  if (verdict === 'confirm' && eValue >= V.evalueThreshold) return 'confirmed';
  return 'active';
};

// ─── 거울 신호 보장 (#555) ────────────────────────────────
// 역방향 종결(direction_mismatch)로 링크를 버릴 때 정보까지 버리지 않도록, 반대 방향 신호 "정의"를
// 보장한다. 신호 정의 생성은 측정 정의일 뿐 믿음이 아니다(ADR-0039 2층 분리) — 링크 생성·검증은
// 발굴 엔진(P5a)의 기존 게이트가 담당하므로 여기서 pattern_links는 만들지 않는다. 다음 주 발굴 스캔이
// (시드 × 거울신호) 쌍을 자연히 후보로 집어 올린다.

/** above_avg ↔ below_avg 반전. 그 외 direction은 반전 대상 아님(null). */
const mirrorDirection = (direction: SignalDirection | null): SignalDirection | null => {
  if (direction === 'above_avg') return 'below_avg';
  if (direction === 'below_avg') return 'above_avg';
  return null;
};

export type MirrorSignalOutcome = 'created' | 'exists' | 'skipped_rejected' | 'ineligible';

export interface MirrorSignalResult {
  outcome: MirrorSignalOutcome;
  /** 생성됐을 때만 non-null — 새 signal_defs.id. */
  mirrorSignalId: number | null;
}

/**
 * 종결된 링크의 신호에 대해 반대 방향(above_avg↔below_avg) 신호 정의를 보장한다 (#555).
 *   - 대상: kind='sql' AND direction ∈ {above_avg, below_avg} 인 신호만.
 *     (above_abs/below_abs는 절대 임계라 반전이 임계 의미와 일치하지 않고, tag/flag_present는 방향이 없다 → ineligible.)
 *   - 거울 = 같은 (name, sql_body, threshold, domain, kind, source='seed')에 direction만 반전한 행.
 *   - 거울이 status IN ('active','pending')으로 이미 있으면 no-op('exists').
 *   - 기각 이력만 있으면(active/pending 없음) 생성 스킵('skipped_rejected', 로그) — 재기각을 되살리지 않는다.
 *   - 없으면 status='active'로 INSERT('created'). pattern_links는 만들지 않는다(발굴 엔진 위임).
 * INSERT 컬럼 구성은 signal_defs 기존 생성 경로(마이그 086 등)를 따른다.
 * user_id 가드 — 교차 유저 신호 생성 차단.
 */
export const ensureMirrorSignalDef = async (
  userId: number,
  signalId: number,
): Promise<MirrorSignalResult> => {
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE id = $1 AND user_id = $2`,
    [signalId, userId],
  );
  const row = res.rows[0];
  if (!row) return { outcome: 'ineligible', mirrorSignalId: null };

  const mirror = mirrorDirection(row.direction);
  if (row.kind !== 'sql' || row.source !== 'seed' || mirror === null || row.sql_body === null) {
    return { outcome: 'ineligible', mirrorSignalId: null };
  }

  // 같은 측정 정의(name·kind·threshold·sql) + 반전 direction 신호가 이미 있으면 재생성 금지 (#557 공통 가드).
  // NULL threshold는 IS NOT DISTINCT FROM으로 매칭. active/pending → 재사용(exists), rejected만 → 스킵.
  const eq = await findEquivalentSignal(userId, {
    name: row.name,
    kind: 'sql',
    direction: mirror,
    threshold: row.threshold === null ? null : Number(row.threshold),
    tagName: null,
    sqlBody: row.sql_body,
  });
  if (eq.decision === 'reuse') {
    return { outcome: 'exists', mirrorSignalId: null };
  }
  if (eq.decision === 'skip_rejected') {
    console.warn(
      `[MirrorSignal] user=${userId} signal=${signalId} 거울(${row.name} ${mirror}) 기각 이력만 존재 — 생성 스킵`,
    );
    return { outcome: 'skipped_rejected', mirrorSignalId: null };
  }

  const ins = await query<{ id: number }>(
    `INSERT INTO signal_defs
        (user_id, name, kind, sql_body, value_type, direction, threshold, domain, window_days, description, source, status)
     VALUES ($1, $2, 'sql', $3, $4, $5, $6, $7, $8, $9, 'seed', 'active')
     RETURNING id`,
    [
      userId,
      row.name,
      row.sql_body,
      row.value_type,
      mirror,
      row.threshold,
      row.domain,
      row.window_days,
      row.description ?? '',
    ],
  );
  const mirrorSignalId = ins.rows[0]?.id ?? null;
  console.warn(
    `[MirrorSignal] user=${userId} signal=${signalId} 거울 신호 생성(${row.name} ${row.direction}→${mirror}) id=${mirrorSignalId}`,
  );
  return { outcome: 'created', mirrorSignalId };
};

// ─── FDR 가족 분리 (#477 P4a, ADR-0037) ──────────────────

export type FdrFamily = 'saju_strength' | 'saju_relation' | 'baseline';

/**
 * 사전등록 가족 (ADR-0037 + #477 P4b ADR-0038):
 *   - strength_band → saju_strength (합화 반영 강도)
 *   - relation·hwa_sipsung → saju_relation (자동 생성 관계 batch + 효과적 십성)
 *   - 그 외(life_signal·기존 사주·태그) → baseline
 * 자동 생성 관계 batch(070 + 귀문/암합)가 빠른 life_signal 트랙 확정을 늦추지 않게 격리.
 */
export const familyOf = (seed: { trigger_target_type: string }): FdrFamily => {
  if (seed.trigger_target_type === 'strength_band') return 'saju_strength';
  if (seed.trigger_target_type === 'relation' || seed.trigger_target_type === 'hwa_sipsung') {
    return 'saju_relation';
  }
  return 'baseline';
};

/**
 * 가족별로 BH-FDR 독립 적용 (ADR-0037). 입력 순서를 보존해 q 배열 반환.
 * 자주 발현하는 강도 밴드(유한 p)가 baseline 가족의 m을 키워 life_signal 확정을 늦추는 것을 차단.
 * 한 가족 추가/제거는 다른 가족 q에 영향 없음(가족 간 격리).
 */
export const bhFdrByFamily = (items: ReadonlyArray<{ p: number; family: FdrFamily }>): number[] => {
  const q = new Array<number>(items.length).fill(NaN);
  const families: FdrFamily[] = ['saju_strength', 'saju_relation', 'baseline'];
  for (const fam of families) {
    const idxs = items.map((it, i) => (it.family === fam ? i : -1)).filter((i) => i >= 0);
    if (idxs.length === 0) continue;
    const qs = bhFdr(idxs.map((i) => items[i]?.p ?? NaN));
    idxs.forEach((i, k) => {
      q[i] = qs[k] ?? NaN;
    });
  }
  return q;
};

// ─── 읽기 (시리즈 계산) ──────────────────────────────────

/** 신호 시리즈 결과. raw는 sql continuous 신호일 때만 non-null(Mann-Whitney 보고용). */
export interface SignalSeriesResult {
  series: DaySeries;
  raw: Map<string, number | null> | null;
}

/**
 * 신호 일자 시리즈 (신호당 1회). tag=태그 존재 여부, sql=raw 시리즈 → binarize(+continuous는 raw 보존).
 * dataStart(#504): 그 신호 도메인의 첫 기록일. 이전 날은 결측(null)으로 처리 — 빈 과거의 COALESCE 0이
 * "발현 안 함=fail"로 새거나 rolling baseline을 0으로 오염시키는 측정 아티팩트를 차단(그 날 SQL도 스킵).
 */
export const computeSignalSeries = async (
  userId: number,
  signal: SignalDef,
  windowDates: string[],
  dataStart: string | null = null,
): Promise<SignalSeriesResult> => {
  if (windowDates.length === 0) return { series: new Map(), raw: null };
  const beforeStart = (d: string): boolean => dataStart !== null && d < dataStart;
  if (signal.kind === 'tag') {
    if (!signal.tagName) return { series: new Map(windowDates.map((d) => [d, false])), raw: null };
    const res = await query<{ date: string }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
         FROM diary_meta_tags
        WHERE user_id = $1 AND tag = $2 AND date >= $3 AND date <= $4`,
      [userId, signal.tagName, windowDates[0], windowDates[windowDates.length - 1]],
    );
    const present = new Set(res.rows.map((r) => r.date));
    // 태깅 시작 이전(diary_meta 첫 기록 전)은 결측 — "태그 없음=fail"로 세지 않음.
    return {
      series: new Map(windowDates.map((d) => [d, beforeStart(d) ? null : present.has(d)])),
      raw: null,
    };
  }
  // kind === 'sql'
  if (!signal.sqlBody || !signal.direction) {
    return { series: new Map(windowDates.map((d) => [d, null])), raw: null };
  }
  // source='llm'이면 untrusted 격리 실행기(게이트 #2), seed면 기존 신뢰 경로.
  const runner = signal.source === 'llm' ? runLlmSignalSql : runMetricSql;
  const raw = new Map<string, number | null>();
  for (const d of windowDates) {
    if (beforeStart(d)) {
      raw.set(d, null); // 데이터-존재 이전 = 결측(0 아님). SQL 실행도 생략.
      continue;
    }
    try {
      raw.set(d, await runner(signal.sqlBody, userId, d));
    } catch {
      raw.set(d, null);
    }
  }
  const series = binarizeSqlSeries(
    raw,
    windowDates,
    signal.direction,
    signal.threshold,
    signal.windowDays ?? V.baselineWindowDays,
  );
  // continuous 신호만 raw 보존(MW). binary(flag_present 등)는 raw 불필요.
  return { series, raw: signal.valueType === 'continuous' ? raw : null };
};

/** 연속 신호 raw를 발현/비발현으로 분리 (Mann-Whitney 입력). 측정불가(null)일·윈도우 밖 제외. */
export const splitRawByActivation = (
  activation: Map<string, boolean>,
  raw: Map<string, number | null>,
  windowDates: string[],
  windowStart: string | null = null,
): { active: number[]; off: number[] } => {
  const active: number[] = [];
  const off: number[] = [];
  for (const date of windowDates) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖 — #504
    const v = raw.get(date);
    if (v === null || v === undefined) continue;
    if (activation.get(date)) active.push(v);
    else off.push(v);
  }
  return { active, off };
};

/** DailyContext → 운 풀셋 PillarSet (강도 계산 입력). */
const pillarSetOf = (ctx: DailyContext): PillarSet => ({
  wonguk: ctx.natal.pillars,
  daeun: ctx.daeun,
  seun: ctx.seun,
  wolun: ctx.wolun,
  ilun: ctx.ilun,
});

/** target('day_master'|오행)의 윈도우 강도 시리즈 (강도 계산 불가일은 제외). target별 1회. */
export const computeTargetStrengthSeries = async (
  target: StrengthTarget,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
): Promise<Map<string, number>> => {
  const series = new Map<string, number>();
  for (const d of windowDates) {
    let ctx = ctxCache.get(d);
    if (ctx === undefined) {
      ctx = await getDailyContext(userId, d);
      ctxCache.set(d, ctx);
    }
    if (!ctx) continue;
    series.set(d, computeStrengthForTarget(target, ctx.natal.dayMaster, pillarSetOf(ctx)));
  }
  return series;
};

/**
 * 강도 밴드 2-pass 활성 시리즈 (#477 P4a). 분위수가 윈도우 의존이라 per-day 평가 불가:
 *   pass1: target 강도 시리즈(캐시 — 18 밴드 시드가 6 target 공유) →
 *   pass2: tertile 컷(캐시) → 각 날 밴드 매핑 → seed.band 일치 여부.
 * 결정론: 같은 윈도우 → 같은 분위수 → 같은 밴드 시퀀스 (SET 리플레이·e-value 불변, ADR-0034).
 */
const computeStrengthBandActivation = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
  strengthCache: Map<string, Map<string, number>>,
  cutCache: Map<string, BandCuts>,
): Promise<Map<string, boolean>> => {
  const series = new Map<string, boolean>();
  const aux = seed.trigger_aux ?? {};
  const target = aux['target'];
  const band = aux['band'];
  if (!isStrengthTarget(target) || !isBand(band)) {
    for (const d of windowDates) series.set(d, false);
    return series;
  }
  let strengthSeries = strengthCache.get(target);
  if (!strengthSeries) {
    strengthSeries = await computeTargetStrengthSeries(target, userId, windowDates, ctxCache);
    strengthCache.set(target, strengthSeries);
  }
  let cuts = cutCache.get(target);
  if (!cuts) {
    cuts = tertileCuts([...strengthSeries.values()]);
    cutCache.set(target, cuts);
  }
  for (const d of windowDates) {
    const v = strengthSeries.get(d);
    series.set(d, v !== undefined && classifyBand(v, cuts) === band);
  }
  return series;
};

/** 시드 활성 시리즈 (시드당 1회). strength_band는 2-pass, 그 외는 일자별 evaluateTrigger. */
export const computeSeedActivationSeries = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
  stemMap: Map<string, number>,
  branchMap: Map<string, number>,
  strengthCache: Map<string, Map<string, number>> = new Map(),
  cutCache: Map<string, BandCuts> = new Map(),
): Promise<Map<string, boolean>> => {
  if (seed.trigger_target_type === 'strength_band') {
    return computeStrengthBandActivation(
      seed,
      userId,
      windowDates,
      ctxCache,
      strengthCache,
      cutCache,
    );
  }
  const series = new Map<string, boolean>();
  for (const d of windowDates) {
    let ctx = ctxCache.get(d);
    if (ctx === undefined) {
      ctx = await getDailyContext(userId, d);
      ctxCache.set(d, ctx);
    }
    if (!ctx) {
      series.set(d, false);
      continue;
    }
    try {
      series.set(d, await evaluateTrigger(seed, ctx, stemMap, branchMap));
    } catch {
      series.set(d, false);
    }
  }
  return series;
};

const lastActivationDate = (activation: Map<string, boolean>): string | null => {
  let last: string | null = null;
  for (const [date, active] of activation) {
    if (active && (last === null || date > last)) last = date;
  }
  return last;
};

interface SignalDefRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
  domain: string | null;
  /** llm 신호 자작 라벨용 (#504 P2). seed 신호는 룰로 생성하므로 미사용. */
  description: string | null;
}

const toSignalDef = (row: SignalDefRow): SignalDef => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  source: row.source,
  sqlBody: row.sql_body,
  valueType: row.value_type,
  direction: row.direction,
  threshold: row.threshold === null ? null : Number(row.threshold),
  tagName: row.tag_name,
  windowDays: row.window_days,
  domain: row.domain,
});

/** signal_defs(active만) id 집합 → 행. SELECT 단일 위치 — verifyUserLinks(라벨까지)·loadSignalDefsByIds 공용. */
const querySignalDefRows = async (ids: number[]): Promise<SignalDefRow[]> => {
  if (ids.length === 0) return [];
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE id = ANY($1::int[]) AND status = 'active'`,
    [ids],
  );
  return res.rows;
};

/**
 * 신호 id 집합 → SignalDef 맵(active만). verifyUserLinks·scoreForecasts(예측 장부 채점, #531) 공용.
 * toSignalDef가 SignalDef 단일 진실 — 채점 측은 라벨 불요라 SignalDef만 받는다.
 */
export const loadSignalDefsByIds = async (ids: number[]): Promise<Map<number, SignalDef>> => {
  const rows = await querySignalDefRows(ids);
  return new Map(rows.map((r) => [r.id, toSignalDef(r)]));
};

interface ActiveLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
  status: LinkLifecycleStatus;
  source: string;
  created_date: string | null;
}

/**
 * 한 유저의 active 링크 전부를 off-day 대조 검증. UPDATE/Slack 없음 — 계산 결과만 반환.
 * BH-FDR은 전 링크 p를 모아 일괄 적용.
 */
export const verifyUserLinks = async (
  userId: number,
  today: string,
): Promise<LinkVerification[]> => {
  const linkRes = await query<ActiveLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.signal_id, l.status,
            l.source, (l.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS created_date
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status = 'active' AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );
  if (linkRes.rows.length === 0) return [];

  const seeds = await loadActiveSeeds(userId);
  const seedById = new Map(seeds.map((s) => [s.id, s]));

  const signalIds = [...new Set(linkRes.rows.map((r) => r.signal_id))];
  const signalRows = await querySignalDefRows(signalIds);
  const signalById = new Map(signalRows.map((r) => [r.id, toSignalDef(r)]));
  // 카드용 신호 라벨 — 룰(seed) / 자작 description(llm). 로드 지점에서 1회 계산해 문자열로 운반.
  const signalLabelById = new Map(
    signalRows.map((r) => [
      r.id,
      signalLabel({
        name: r.name,
        kind: r.kind,
        source: r.source,
        direction: r.direction,
        threshold: r.threshold === null ? null : Number(r.threshold),
        tagName: r.tag_name,
        domain: r.domain,
        description: r.description,
      }),
    ]),
  );

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#504): 신호별·시드별 시작일을 1회 산출 → 링크마다 max로 클립.
  const dataStarts = await computeUserDataStarts(userId);
  const signalStartById = new Map(
    [...signalById].map(([sid, sig]) => [sid, signalDataStart(sig.domain, dataStarts)]),
  );

  // 신호 시리즈(신호당 1회) + 시드 활성 시리즈(시드당 1회) — P1 전역화 payoff.
  // 신호 시리즈는 자기 도메인 시작일 기준으로 빈 과거를 결측 처리(baseline 오염·아티팩트 차단).
  const signalSeriesById = new Map<number, SignalSeriesResult>();
  for (const [sid, signal] of signalById) {
    signalSeriesById.set(
      sid,
      await computeSignalSeries(userId, signal, windowDates, signalStartById.get(sid) ?? null),
    );
  }
  const ctxCache = new Map<string, DailyContext | null>();
  // 강도 시리즈·컷 캐시 — 18 밴드 시드가 6 target(일간+5오행) 계산을 공유(재계산 방지).
  const strengthCache = new Map<string, Map<string, number>>();
  const cutCache = new Map<string, BandCuts>();
  const seedSeriesById = new Map<number, Map<string, boolean>>();
  for (const seedId of new Set(linkRes.rows.map((r) => r.seed_id))) {
    const seed = seedById.get(seedId);
    if (!seed) continue;
    seedSeriesById.set(
      seedId,
      await computeSeedActivationSeries(
        seed,
        userId,
        windowDates,
        ctxCache,
        stemMap,
        branchMap,
        strengthCache,
        cutCache,
      ),
    );
  }

  // 링크별 2×2(Fisher) + block permutation p + e-value + 연속 MW. q는 block-perm p로 일괄 BH-FDR.
  const interim = linkRes.rows
    .map((row) => {
      const signal = signalById.get(row.signal_id);
      const seed = seedById.get(row.seed_id);
      const activation = seedSeriesById.get(row.seed_id);
      const signalSeries = signalSeriesById.get(row.signal_id);
      if (!signal || !seed || !activation || !signalSeries) return null;
      const series = signalSeries.series;
      // 데이터-존재 윈도우(#504) + enrollment 클립(#523 P0, D1): 셋의 max로 합성.
      // ① 시드 데이터-존재 시작 ② 신호 데이터-존재 시작 ③ 발굴/제안 링크의 등록 익일.
      const windowStart = maxDate(
        maxDate(seedDataStart(seed, dataStarts), signalStartById.get(row.signal_id) ?? null),
        enrollmentStart(row.source, row.created_date),
      );
      const cont = buildContingency(activation, series, windowStart);
      const daySeq = buildDaySequence(activation, series, windowDates, windowStart);
      // 연속 신호만 Mann-Whitney(보고용). raw 분리 → U/p/Hodges-Lehmann.
      let mannWhitney: MannWhitneyResult | null = null;
      if (signal.valueType === 'continuous' && signalSeries.raw) {
        const split = splitRawByActivation(activation, signalSeries.raw, windowDates, windowStart);
        if (split.active.length > 0 && split.off.length > 0) {
          mannWhitney = mannWhitneyU(split.active, split.off);
        }
      }
      return {
        row,
        signal,
        seed,
        cont,
        windowStart,
        family: familyOf(seed),
        v: verifyContingency(cont),
        blockP: blockPermutationP(daySeq, V.blockLen, V.blockPermIters),
        mannWhitney,
        eValue: evalueTestMartingale(daySeq),
        stability: splitHalvesConsistent(daySeq),
        lastMatchedAt: lastActivationDate(activation),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // empirical-Bayes 공통 prior — 전 링크 발현일 hit/miss로 추정(헌장 ④: 링크 적으면 약함).
  const ebPrior: BetaPosterior = empiricalBetaPrior(
    interim.map((x) => ({ hits: x.cont.a, misses: x.cont.b })),
  );
  // q는 자기상관 보정된 block-perm p로(Fisher는 test_detail 참고용).
  // FDR 가족 분리 (ADR-0037): 강도 밴드(saju_strength)와 baseline을 독립 보정 → 가족 간 비용 격리.
  const qValues = bhFdrByFamily(interim.map((x) => ({ p: x.blockP, family: x.family })));

  return interim.map((x, i) => {
    const qValue = qValues[i] ?? NaN;
    const verdict = classifyVerdict(x.v, qValue);
    const post = cumulativePosteriorFromHitMiss(x.cont.a, x.cont.b, ebPrior);
    return {
      linkId: x.row.link_id,
      seedId: x.row.seed_id,
      signalId: x.row.signal_id,
      seedName: x.seed.name,
      seedLabel: seedLabel({ name: x.seed.name, description: x.seed.description }),
      patternKind: x.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
      signalName: x.signal.name,
      signalLabel: signalLabelById.get(x.row.signal_id) ?? x.signal.name,
      signalKind: x.signal.kind,
      valueType: x.signal.valueType,
      currentStatus: x.row.status,
      a: x.cont.a,
      b: x.cont.b,
      c: x.cont.c,
      d: x.cont.d,
      inconclusive: x.cont.inconclusive,
      nActive: x.v.nActive,
      nOff: x.v.nOff,
      rateActive: x.v.rateActive,
      rateOff: x.v.rateOff,
      effect: x.v.effect,
      pValue: x.blockP,
      fisherP: x.v.p,
      qValue,
      mannWhitney: x.mannWhitney,
      posteriorAlpha: post.alpha,
      posteriorBeta: post.beta,
      posteriorP: posteriorMean(post.alpha, post.beta),
      eValue: x.eValue,
      lastMatchedAt: x.lastMatchedAt,
      windowStart: x.windowStart,
      family: x.family,
      stability: x.stability,
      verdict,
      nextStatus: statusForVerdict(verdict, x.row.status, x.eValue),
    };
  });
};

// ─── 강도 분위수 컷 산출 (#477 P4a, 저장은 weekly-verification) ──

export interface StrengthCutpoint {
  target: StrengthTarget;
  low: number;
  high: number;
  nSamples: number;
}

/**
 * 활성 strength_band 시드가 있는 target별 주간 분위수 컷 산출 (읽기전용).
 * 일별 cron이 이 저장 컷으로 "오늘 밴드"를 판정 → 발현 로그(seed_daily_activations)·recent tier.
 * 주간 검증 엔진은 자체 윈도우로 컷을 재계산하므로(결정론) 이 저장값에 의존하지 않음 — 일별 경로 전용.
 */
export const computeStrengthCutpoints = async (
  userId: number,
  today: string,
): Promise<StrengthCutpoint[]> => {
  const seedRes = await query<{ trigger_aux: Record<string, unknown> | null }>(
    `SELECT trigger_aux FROM pattern_catalog
      WHERE user_id = $1 AND active = true AND trigger_target_type = 'strength_band'`,
    [userId],
  );
  const targets = new Set<StrengthTarget>();
  for (const r of seedRes.rows) {
    const t = r.trigger_aux?.['target'];
    if (isStrengthTarget(t)) targets.add(t);
  }
  if (targets.size === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const ctxCache = new Map<string, DailyContext | null>();
  const out: StrengthCutpoint[] = [];
  for (const target of targets) {
    const series = await computeTargetStrengthSeries(target, userId, windowDates, ctxCache);
    const values = [...series.values()];
    if (values.length === 0) continue;
    const cuts = tertileCuts(values);
    if (!Number.isFinite(cuts.low) || !Number.isFinite(cuts.high)) continue;
    out.push({ target, low: cuts.low, high: cuts.high, nSamples: values.length });
  }
  return out;
};
