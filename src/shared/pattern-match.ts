/**
 * 사주 시드 카탈로그 기반 일일 매칭 엔진.
 * ADR-0017 + ADR-0026(pattern_* rename) + ADR-0033(매트릭=가설 5어휘 재정의, #477 P1) 참조.
 *
 * 흐름:
 *   1) loadActiveSeeds — pattern_catalog + pattern_links × signal_defs(전역 신호) 조회
 *   2) getDailyContext — 일운(getDayPillar) + 본명(saju_profiles) 로드
 *   3) evaluateTrigger — trigger_target_type별 분기 평가
 *   4) evaluateMetric — 신호 평가: kind=sql(SQL + baseline/임계 비교) | kind=tag(그날 태그 존재 여부)
 *   5) recordDailyMatches — seed_daily_activations UPSERT (오늘 발현 시드 핸드오프 로그)
 *
 * #477 P2: 검증 단위는 (시드 × 신호) = pattern_links, 검증은 주간 엔진(pattern-verification)이
 * raw에서 윈도우 재계산. 본 모듈은 매칭 + 일별 핸드오프 기록(seed_daily_activations)까지만 담당.
 */

import { query, queryWithClient, queryReadOnly } from './db.js';
import { validateSignalSql, SIGNAL_ROW_CAP } from './signal-sql-guard.js';
import {
  getDayPillar,
  getDaeunPillar,
  getElementByCheongan,
  getMonthPillar,
  getYearPillar,
  makePillar,
  type Cheongan,
  type Jiji,
  type Pillar,
  type PillarSet,
} from './saju-calendar.js';
import { computeStrengthForTarget, isStrengthTarget } from './saju-strength.js';
import { detectHwaTransforms, elementToSipsinGroup, isSipsinGroup } from './saju-hwa.js';
import { SAJU_HWA_PARAMS } from './saju-strength-params.js';
import { classifyBand, isBand, type BandCuts } from './quantile.js';
import { addDays } from './kst.js';
import { dispatchLifeSignal } from './life-signal-evaluators/index.js';

const METRIC_TIMEOUT_MS = 5_000;
const BASELINE_WINDOW_DAYS = 28;

export type PillarLevel = 'wonguk' | 'daeun' | 'seun' | 'wolun' | 'ilun';

export interface SajuSeed {
  id: number;
  user_id: number;
  name: string;
  sipsin: string | null;
  description: string | null;
  trigger_target_type:
    | 'stem'
    | 'branch'
    | 'ganji'
    | 'element_density'
    | 'sibiunsung'
    | 'relation'
    | 'strength_band'
    | 'hwa_sipsung'
    | 'life_signal';
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
  /** 사주 시드 발현 운 레벨. life_signal/null은 미적용 (마스터 #434 Phase 2.5). */
  pillar_level: PillarLevel | null;
  active: boolean;
  source: 'seed' | 'llm_promoted';
}

/**
 * (시드 × 신호) 평가 단위. #477 P1: pattern_links × signal_defs JOIN 결과.
 * kind=sql이면 expected_metric_sql/expected_direction 보유(CHECK 보장),
 * kind=tag이면 tag_name 보유 + 그날 태그 존재 여부를 binary로 평가.
 */
export interface SajuMetric {
  link_id: number;
  signal_id: number;
  pattern_id: number;
  metric_name: string;
  kind: 'sql' | 'tag';
  /** signal_defs.source — 'llm'이면 실행 시 untrusted SQL 격리 경로(runLlmSignalSql) 사용 (#477 P5b). */
  source: 'seed' | 'llm';
  expected_metric_sql: string | null;
  expected_direction: 'above_avg' | 'below_avg' | 'above_abs' | 'below_abs' | 'flag_present' | null;
  expected_threshold: number | null;
  value_type: 'binary' | 'continuous' | null;
  tag_name: string | null;
  domain:
    | 'schedule'
    | 'routine'
    | 'sleep'
    | 'expense'
    | 'diary_meta'
    | 'audit'
    | 'expense_category_present';
}

export interface SajuSeedWithMetrics extends SajuSeed {
  metrics: SajuMetric[];
}

export interface NatalContext {
  stems: Cheongan[];
  branches: Jiji[];
  dayMaster: Cheongan;
  /** 원국 4주 (year/month/day/hour 순) — Phase 2.5 cumulative trigger용 */
  pillars: Pillar[];
  /** 생년월일 (YYYY-MM-DD) — 대운 추출용. 미등록 시 null */
  birthDate: string | null;
  /** saju_profiles.daewun_list — 대운 추출용 */
  daewunList: ReadonlyArray<{ age: number; pillar: string }>;
}

export interface DailyContext {
  date: string;
  /** 평가 대상 사용자 ID. life_signal threshold/behavior_baseline evaluator가 본인 데이터 SELECT 시 사용 (마스터 #434 Phase 3). */
  userId: number;
  dayStem: Cheongan;
  dayBranch: Jiji;
  natal: NatalContext;
  /** 일운 Pillar (= {cheongan: dayStem, jiji: dayBranch}) — Phase 2.5 */
  ilun: Pillar;
  /** 월운 Pillar — Phase 2.5 */
  wolun: Pillar;
  /** 세운 Pillar (= year pillar of target date) — Phase 2.5 */
  seun: Pillar;
  /** 대운 Pillar (적용 구간 외 또는 미등록 시 null) — Phase 2.5 */
  daeun: Pillar | null;
}

// ─── life_signal trigger_aux 타입 (ADR-0029) ───────────────
// Phase 3 (마스터 #434) — life_signal 단일 type + trigger_aux.kind 분기
// 7 kinds: weekday / weekday_group / month_position / season / calendar_event / threshold / behavior_baseline
// (lunar는 폐기 — 사주는 절기 기준이지 음력 기준이 아니다. 명절은 calendar_event(holiday/holiday_next)로 커버.)

export type LifeSignalKind =
  | 'weekday'
  | 'weekday_group'
  | 'month_position'
  | 'season'
  | 'calendar_event'
  | 'threshold'
  | 'behavior_baseline';

export type WeekdayDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeekdayAux {
  kind: 'weekday';
  dow: WeekdayDow;
}

export interface WeekdayGroupAux {
  kind: 'weekday_group';
  group: 'weekend' | 'weekday';
}

export interface MonthPositionAux {
  kind: 'month_position';
  position: 'start' | 'end' | 'mid';
  range_days?: number;
  start?: number;
  end?: number;
}

export interface SeasonAux {
  kind: 'season';
  season: 'spring' | 'summer' | 'autumn' | 'winter';
}

export interface CalendarEventAux {
  kind: 'calendar_event';
  event: 'holiday' | 'holiday_next' | 'autopay_day';
  day_of_month?: number;
}

export interface ThresholdAux {
  kind: 'threshold';
  source: 'sleep_minutes' | 'routine_streak_max';
  op: 'lte' | 'gte' | 'eq';
  value: number;
}

export type BehaviorSignalName =
  | 'streak'
  | 'sleepTrend'
  | 'slotGap'
  | 'weekComparison'
  | 'overdueAlert'
  | 'categorySkew'
  | 'drift'
  | 'recovery'
  | 'lapseAlert'
  | 'weeklyRegression'
  | 'spottyPattern';

export interface BehaviorBaselineAux {
  kind: 'behavior_baseline';
  signal_name: BehaviorSignalName;
}

export type LifeSignalAux =
  | WeekdayAux
  | WeekdayGroupAux
  | MonthPositionAux
  | SeasonAux
  | CalendarEventAux
  | ThresholdAux
  | BehaviorBaselineAux;

const BEHAVIOR_SIGNAL_NAMES: ReadonlySet<string> = new Set<BehaviorSignalName>([
  'streak',
  'sleepTrend',
  'slotGap',
  'weekComparison',
  'overdueAlert',
  'categorySkew',
  'drift',
  'recovery',
  'lapseAlert',
  'weeklyRegression',
  'spottyPattern',
]);

/** trigger_aux JSONB를 LifeSignalAux로 안전하게 좁히는 type guard. 잘못된 aux는 false 반환(예외 X). */
export const isLifeSignalAux = (v: unknown): v is LifeSignalAux => {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const kind = obj['kind'];
  switch (kind) {
    case 'weekday':
      return typeof obj['dow'] === 'number' && obj['dow'] >= 0 && obj['dow'] <= 6;
    case 'weekday_group':
      return obj['group'] === 'weekend' || obj['group'] === 'weekday';
    case 'month_position':
      return obj['position'] === 'start' || obj['position'] === 'end' || obj['position'] === 'mid';
    case 'season':
      return (
        obj['season'] === 'spring' ||
        obj['season'] === 'summer' ||
        obj['season'] === 'autumn' ||
        obj['season'] === 'winter'
      );
    case 'calendar_event':
      return (
        obj['event'] === 'holiday' ||
        obj['event'] === 'holiday_next' ||
        obj['event'] === 'autopay_day'
      );
    case 'threshold':
      return (
        (obj['source'] === 'sleep_minutes' || obj['source'] === 'routine_streak_max') &&
        (obj['op'] === 'lte' || obj['op'] === 'gte' || obj['op'] === 'eq') &&
        typeof obj['value'] === 'number'
      );
    case 'behavior_baseline':
      return (
        typeof obj['signal_name'] === 'string' && BEHAVIOR_SIGNAL_NAMES.has(obj['signal_name'])
      );
    default:
      return false;
  }
};

export interface MetricEvaluation {
  metric_name: string;
  domain: string;
  todayValue: number;
  baselineAvg: number | null;
  threshold: number | null;
  direction: string;
  passed: boolean;
}

export interface SeedMatchResult {
  seed: SajuSeedWithMetrics;
  triggerActivated: boolean;
  metricEvaluations: MetricEvaluation[];
  /** 매트릭 평가 결과. 매트릭 없는 풀셋 시드(evidence-only)는 null. */
  matched: boolean | null;
  /** 풀셋 evidence-only 시드 여부(매트릭 없음). matched=null로 기록. */
  isEvidenceOnly: boolean;
  /** 시드 평가 중 SQL/시스템 오류 발생 시 message. 로깅용(일별 핸드오프 로그엔 미기록). */
  triggerError: string | null;
}

// ─── 본명 / 일운 컨텍스트 ────────────────────────────────

interface SajuProfileRow {
  day_pillar: string;
  year_pillar: string;
  month_pillar: string;
  hour_pillar: string;
  birth_date: string | null;
  daewun_list: unknown;
}

interface DaewunEntry {
  age: number;
  pillar: string;
}

const isDaewunEntryArray = (value: unknown): value is DaewunEntry[] => {
  if (!Array.isArray(value)) return false;
  return value.every(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Record<string, unknown>).age === 'number' &&
      typeof (v as Record<string, unknown>).pillar === 'string',
  );
};

export const loadNatalContext = async (userId: number): Promise<NatalContext | null> => {
  const result = await query<SajuProfileRow>(
    `SELECT day_pillar, year_pillar, month_pillar, hour_pillar,
            birth_date::text AS birth_date, daewun_list
       FROM saju_profiles WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const pillarStrs = [row.year_pillar, row.month_pillar, row.day_pillar, row.hour_pillar];
  const stems = pillarStrs.map((p) => p.charAt(0)) as Cheongan[];
  const branches = pillarStrs.map((p) => p.charAt(1)) as Jiji[];
  const pillars = pillarStrs.map((p) => makePillar(p.charAt(0) as Cheongan, p.charAt(1) as Jiji));
  const daewunList = isDaewunEntryArray(row.daewun_list) ? row.daewun_list : [];

  return {
    stems,
    branches,
    dayMaster: row.day_pillar.charAt(0) as Cheongan,
    pillars,
    birthDate: row.birth_date,
    daewunList,
  };
};

export const getDailyContext = async (
  userId: number,
  date: string,
): Promise<DailyContext | null> => {
  const natal = await loadNatalContext(userId);
  if (!natal) return null;
  const ilun = getDayPillar(date);
  const wolun = getMonthPillar(date);
  const seun = getYearPillar(date);
  const daeun = natal.birthDate ? getDaeunPillar(natal.birthDate, natal.daewunList, date) : null;
  return {
    date,
    userId,
    dayStem: ilun.cheongan,
    dayBranch: ilun.jiji,
    natal,
    ilun,
    wolun,
    seun,
    daeun,
  };
};

// ─── 시드 로드 ──────────────────────────────────────────

type SeedRow = SajuSeed;
type MetricRow = SajuMetric;

export const loadActiveSeeds = async (userId: number): Promise<SajuSeedWithMetrics[]> => {
  const seeds = await query<SeedRow>(
    `SELECT id, user_id, name, sipsin, description,
            trigger_target_type, trigger_target_id, trigger_aux, pillar_level,
            active, source
       FROM pattern_catalog
      WHERE user_id = $1 AND active = true
      ORDER BY id`,
    [userId],
  );
  if (seeds.rows.length === 0) return [];

  const ids = seeds.rows.map((s) => s.id);
  // #477 P1: 검증 단위 = (시드 × 신호) 활성 링크 × 활성 신호. pending 링크/신호(LLM 미승인)는 제외.
  const metrics = await query<MetricRow>(
    `SELECT l.id AS link_id, l.seed_id AS pattern_id, s.id AS signal_id,
            s.name AS metric_name, s.kind, s.source,
            s.sql_body AS expected_metric_sql, s.direction AS expected_direction,
            s.threshold AS expected_threshold, s.value_type, s.tag_name, s.domain
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
      WHERE l.seed_id = ANY($1) AND l.status = 'active' AND s.status = 'active'
      ORDER BY l.id`,
    [ids],
  );

  const metricByPattern = new Map<number, SajuMetric[]>();
  for (const m of metrics.rows) {
    const list = metricByPattern.get(m.pattern_id) ?? [];
    list.push(m);
    metricByPattern.set(m.pattern_id, list);
  }

  return seeds.rows.map((s) => ({
    ...s,
    metrics: metricByPattern.get(s.id) ?? [],
  }));
};

// ─── 트리거 평가 ─────────────────────────────────────────

const ELEMENT_BY_STEM: Record<Cheongan, string> = {
  갑: '목',
  을: '목',
  병: '화',
  정: '화',
  무: '토',
  기: '토',
  경: '금',
  신: '금',
  임: '수',
  계: '수',
};
const ELEMENT_BY_BRANCH: Record<Jiji, string> = {
  자: '수',
  축: '토',
  인: '목',
  묘: '목',
  진: '토',
  사: '화',
  오: '화',
  미: '토',
  신: '금',
  유: '금',
  술: '토',
  해: '수',
};

interface BranchRelationRow {
  relation_type: string;
  branch_a_name: string;
  branch_b_name: string;
}

let branchRelationCache: BranchRelationRow[] | null = null;

const loadBranchRelations = async (): Promise<BranchRelationRow[]> => {
  if (branchRelationCache) return branchRelationCache;
  const result = await query<BranchRelationRow>(
    `SELECT br.relation_type, ba.name AS branch_a_name, bb.name AS branch_b_name
       FROM branch_relations br
       JOIN branches_master ba ON ba.id = br.branch_a_id
       JOIN branches_master bb ON bb.id = br.branch_b_id`,
  );
  branchRelationCache = result.rows;
  return branchRelationCache;
};

interface SibiunsungRow {
  state: string;
}

const lookupSibiunsung = async (dayMaster: Cheongan, branch: Jiji): Promise<string | null> => {
  const result = await query<SibiunsungRow>(
    `SELECT state
       FROM sibiunsung_lookup sl
       JOIN stems_master dm ON dm.id = sl.day_master_stem_id
       JOIN branches_master b ON b.id = sl.branch_id
      WHERE dm.name = $1 AND b.name = $2
      LIMIT 1`,
    [dayMaster, branch],
  );
  return result.rows[0]?.state ?? null;
};

const isStringArray = (val: unknown): val is string[] =>
  Array.isArray(val) && val.every((x) => typeof x === 'string');

const getNumberField = (obj: Record<string, unknown>, key: string): number | null => {
  const v = obj[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * pillar_level에 따라 평가 대상 pillar 선택 (Phase 2.5).
 * - null / 'ilun' → 일운 (= ctx.ilun, 기존 dayStem/dayBranch 동등)
 * - 'wolun' / 'seun' / 'daeun' → 해당 운 pillar
 * - 'wonguk' → null (직접 매칭 불가 — Phase 2.5 1차에서 wonguk 시드 없음)
 * - 'daeun'이 미적용 구간이면 null (대운 미시작 사용자 / 데이터 누락)
 */
const pickPillarByLevel = (level: PillarLevel | null, ctx: DailyContext): Pillar | null => {
  switch (level) {
    case null:
    case 'ilun':
      return ctx.ilun;
    case 'wolun':
      return ctx.wolun;
    case 'seun':
      return ctx.seun;
    case 'daeun':
      return ctx.daeun;
    case 'wonguk':
      return null;
  }
};

/** DailyContext → 운 풀셋 PillarSet (strength_band·hwa 공용) */
const pillarSetOf = (ctx: DailyContext): PillarSet => ({
  wonguk: ctx.natal.pillars,
  daeun: ctx.daeun,
  seun: ctx.seun,
  wolun: ctx.wolun,
  ilun: ctx.ilun,
});

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

// ─── 메트릭 평가 ─────────────────────────────────────────

/** 단일 숫자 신호 결과 추출 — 첫 행 첫 컬럼을 number로 좁힘(없거나 비숫자면 0). */
const extractFirstNumber = (rows: Record<string, unknown>[]): number => {
  const firstRow = rows[0];
  if (!firstRow) return 0;
  const firstValue = Object.values(firstRow)[0];
  if (firstValue === null || firstValue === undefined) return 0;
  if (typeof firstValue === 'number') return firstValue;
  if (typeof firstValue === 'string') {
    const n = Number(firstValue);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** 신호 SQL 실행기 — runMetricSql(seed, 신뢰) | runLlmSignalSql(llm, untrusted) 공통 시그니처. */
export type MetricRunner = (sql: string, userId: number, date: string) => Promise<number>;

export const runMetricSql = async (sql: string, userId: number, date: string): Promise<number> => {
  const result = await queryWithClient<Record<string, unknown>>(
    // pg parameter binding은 query() 경로로만 가능, queryWithClient는 raw query.
    // seed metric SQL은 catalog에 영속된 신뢰 SQL이므로 $1/$2 자리에 안전한 값 대입.
    // userId는 INTEGER, date는 'YYYY-MM-DD' 형식 → SQL injection 위험 없음.
    sql.replace(/\$1/g, String(userId)).replace(/\$2/g, `'${date}'`),
    METRIC_TIMEOUT_MS,
  );
  return extractFirstNumber(result.rows);
};

/**
 * LLM 자율 신호 SQL 실행 — 게이트 #2 (#477 P5b, ADR-0040).
 * source='llm' SQL은 untrusted → ① 실행 직전 재검증(저장된 sql_body도 불신, 실패 시 throw)
 * + ② read-only 트랜잭션 격리(INSERT/UPDATE/DELETE를 PG가 거부, 검증 우회 백스톱) + row cap.
 * runMetricSql과 시그니처·반환 동일 → 호출부가 source로 둘 중 하나를 고른다.
 */
export const runLlmSignalSql = async (
  sql: string,
  userId: number,
  date: string,
): Promise<number> => {
  const err = validateSignalSql(sql);
  if (err) throw new Error(`LLM 신호 SQL 검증 실패: ${err}`);
  const result = await queryReadOnly<Record<string, unknown>>(
    sql.replace(/\$1/g, String(userId)).replace(/\$2/g, `'${date}'`),
    METRIC_TIMEOUT_MS,
    SIGNAL_ROW_CAP,
  );
  return extractFirstNumber(result.rows);
};

/** signal_defs.source → 실행기 선택 (llm은 격리 경로). */
export const runnerForSource = (source: 'seed' | 'llm'): MetricRunner =>
  source === 'llm' ? runLlmSignalSql : runMetricSql;

const baselineAvg = async (
  sql: string,
  userId: number,
  date: string,
  runner: MetricRunner = runMetricSql,
): Promise<number> => {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= BASELINE_WINDOW_DAYS; i++) {
    const d = addDays(date, -i);
    try {
      const v = await runner(sql, userId, d);
      sum += v;
      n++;
    } catch {
      // 단일 날짜 실패는 무시
    }
  }
  return n > 0 ? sum / n : 0;
};

/** tag 신호 — 그날 해당 일기 메타 태그 존재 여부 (binary). */
const tagPresent = async (userId: number, date: string, tagName: string): Promise<boolean> => {
  const result = await query(
    `SELECT 1 FROM diary_meta_tags WHERE user_id = $1 AND date = $2 AND tag = $3 LIMIT 1`,
    [userId, date, tagName],
  );
  return result.rows.length > 0;
};

export const evaluateMetric = async (
  metric: SajuMetric,
  userId: number,
  date: string,
): Promise<MetricEvaluation> => {
  // kind=tag — off-day 대조용 객관 보조 신호. 그날 태그가 찍혔으면 hit(binary).
  if (metric.kind === 'tag') {
    const present = metric.tag_name ? await tagPresent(userId, date, metric.tag_name) : false;
    return {
      metric_name: metric.metric_name,
      domain: metric.domain,
      todayValue: present ? 1 : 0,
      baselineAvg: null,
      threshold: 1,
      direction: 'flag_present',
      passed: present,
    };
  }

  // kind=sql — signal_defs CHECK가 sql_body/direction NOT NULL 보장. 방어적으로 좁힘.
  const sql = metric.expected_metric_sql;
  const direction = metric.expected_direction;
  if (!sql || !direction) {
    return {
      metric_name: metric.metric_name,
      domain: metric.domain,
      todayValue: 0,
      baselineAvg: null,
      threshold: metric.expected_threshold,
      direction: direction ?? 'flag_present',
      passed: false,
    };
  }

  // source='llm'이면 untrusted 격리 실행기(runLlmSignalSql), seed면 기존 신뢰 경로(runMetricSql).
  const runner = runnerForSource(metric.source);
  const todayValue = await runner(sql, userId, date);

  let baseline: number | null = null;
  let passed = false;

  switch (direction) {
    case 'above_avg':
      baseline = await baselineAvg(sql, userId, date, runner);
      passed = todayValue > baseline;
      break;
    case 'below_avg':
      baseline = await baselineAvg(sql, userId, date, runner);
      passed = todayValue < baseline;
      break;
    case 'above_abs':
      passed = todayValue >= (metric.expected_threshold ?? 1);
      break;
    case 'below_abs':
      passed = todayValue <= (metric.expected_threshold ?? 0);
      break;
    case 'flag_present':
      passed = todayValue >= (metric.expected_threshold ?? 1);
      break;
  }

  return {
    metric_name: metric.metric_name,
    domain: metric.domain,
    todayValue,
    baselineAvg: baseline,
    threshold: metric.expected_threshold,
    direction,
    passed,
  };
};

// ─── 시드 단일 평가 + 결과 기록 ──────────────────────────

interface NameIdRow {
  name: string;
  id: number;
}

export const buildNameIdMap = async (
  table: 'stems_master' | 'branches_master',
): Promise<Map<string, number>> => {
  const result = await query<NameIdRow>(`SELECT id, name FROM ${table}`);
  return new Map(result.rows.map((r) => [r.name, r.id]));
};

interface CutpointRow {
  target: string;
  low_cut: string;
  high_cut: string;
}

/**
 * strength_band 일별 판정용 저장 컷 로드 (#477 P4a) — target('day_master'|오행) → BandCuts.
 * 주간 검증 엔진이 윈도우 분위수로 산출·저장(strength_band_cutpoints). 없으면 빈 맵 → 발현 없음(정직).
 * 모듈 캐시 안 함 — 봇이 장시간 떠 있어 주간 갱신 컷이 stale해지면 안 됨(매 cron 호출당 1회 로드).
 */
export const loadStrengthCutpoints = async (userId: number): Promise<Map<string, BandCuts>> => {
  const result = await query<CutpointRow>(
    `SELECT target, low_cut, high_cut FROM strength_band_cutpoints WHERE user_id = $1`,
    [userId],
  );
  const map = new Map<string, BandCuts>();
  for (const r of result.rows) {
    map.set(r.target, { low: Number(r.low_cut), high: Number(r.high_cut) });
  }
  return map;
};

export const matchAllSeedsForDay = async (
  userId: number,
  date: string,
): Promise<SeedMatchResult[]> => {
  const t0 = Date.now();
  const ctx = await getDailyContext(userId, date);
  if (!ctx) return [];
  const seeds = await loadActiveSeeds(userId);
  if (seeds.length === 0) return [];

  const [stemMap, branchMap, strengthCuts] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
    loadStrengthCutpoints(userId),
  ]);

  const results: SeedMatchResult[] = [];
  for (const seed of seeds) {
    // Phase 8a: per-seed try/catch — 한 시드 trigger SQL 실패가 cron 전체를 죽이지 않게 격리.
    // 내부 metric try/catch는 trigger 통과 후 일부 metric만 fail하는 케이스 보호 → 보존.
    try {
      const triggerActivated = await evaluateTrigger(seed, ctx, stemMap, branchMap, strengthCuts);

      const metricEvaluations: MetricEvaluation[] = [];
      if (triggerActivated) {
        for (const m of seed.metrics) {
          try {
            const ev = await evaluateMetric(m, userId, date);
            metricEvaluations.push(ev);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[pattern-match] metric 평가 실패 seed=${seed.name} metric=${m.metric_name}: ${errMsg}`,
            );
          }
        }
      }

      // 풀셋 evidence-only 시드(매트릭 없음)는 채점 스킵 — matched=null
      // 마스터 #434 Phase 2: 60+일 evidence 누적 후 Phase 6 LLM 매트릭 제안 슬롯이 활용
      const isEvidenceOnly = seed.metrics.length === 0;
      const matched = isEvidenceOnly
        ? null
        : triggerActivated && metricEvaluations.some((e) => e.passed);
      results.push({
        seed,
        triggerActivated,
        metricEvaluations,
        matched,
        isEvidenceOnly,
        triggerError: null,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[pattern-match] seed 평가 실패 seed=${seed.name} id=${seed.id}: ${errMsg}`);
      results.push({
        seed,
        triggerActivated: false,
        metricEvaluations: [],
        matched: null,
        isEvidenceOnly: seed.metrics.length === 0,
        triggerError: errMsg,
      });
    }
  }

  const elapsedMs = Date.now() - t0;
  console.warn(
    `[pattern-match] user=${userId} date=${date} seeds=${seeds.length} elapsed=${elapsedMs}ms`,
  );
  return results;
};

export const recordDailyMatches = async (
  userId: number,
  date: string,
  results: SeedMatchResult[],
): Promise<void> => {
  for (const r of results) {
    // #477 P2: seed_daily_activations = "오늘 발현 시드" 핸드오프 로그 (검증 진실 아님).
    // 검증 컬럼(metric_values·verify_status·error_message)은 078에서 제거 — 검증은 주간 엔진.
    // trigger_activated/matched만 멱등 UPSERT → daily-insight·recent tier·pillar-level이 소비.
    await query(
      `INSERT INTO seed_daily_activations
         (user_id, date, pattern_id, trigger_activated, matched)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date, pattern_id) DO UPDATE
         SET trigger_activated = EXCLUDED.trigger_activated,
             matched           = EXCLUDED.matched`,
      [userId, date, r.seed.id, r.triggerActivated, r.matched],
    );
  }
};

// ─── 검증 사이클 ─────────────────────────────────────────
// #477 P2: 검증(카운터 확정 + status 전이)은 주간 검증 엔진(pattern-verification)이 raw에서
// 윈도우 재계산(off-day 대조). 본 모듈은 매칭 + 일별 핸드오프 기록까지만 담당.
// (Slack 한 줄 발송 compactMatchedLine은 #477 P2에서 제거 — 사용자가 매일 확인하지 않는 경로.)

// ─── 캐시 reset (테스트용) ───────────────────────────────

export const __resetCacheForTest = (): void => {
  branchRelationCache = null;
};
