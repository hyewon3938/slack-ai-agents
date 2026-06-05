/**
 * 사주 시드 카탈로그 기반 일일 매칭 엔진.
 * ADR-0017 + ADR-0026(pattern_* rename) + ADR-0033(매트릭=가설 5어휘 재정의, #477 P1) 참조.
 *
 * 흐름:
 *   1) loadActiveSeeds — pattern_catalog + pattern_links × signal_defs(전역 신호) 조회
 *   2) getDailyContext — 일운(getDayPillar) + 본명(saju_profiles) 로드
 *   3) evaluateTrigger — trigger_target_type별 분기 평가
 *   4) evaluateMetric — 신호 평가: kind=sql(SQL + baseline/임계 비교) | kind=tag(그날 태그 존재 여부)
 *   5) recordDailyMatch — pattern_matches UPSERT (P2 주간 검증 엔진 전까지 raw trigger-log 지속)
 *
 * P1(#477): 검증 단위는 (시드 × 신호) = pattern_links. hit/miss 카운터는 링크에 누적(이관 완료),
 * 주간 재계산은 P2. 일별 verify(카운터 확정)는 P2 엔진으로 이관 — 본 모듈은 매칭·기록만.
 */

import { query, queryWithClient } from './db.js';
import {
  computeCumulativePillarCount,
  getDayPillar,
  getDaeunPillar,
  getMonthPillar,
  getYearPillar,
  makePillar,
  type Cheongan,
  type Element,
  type Jiji,
  type Pillar,
  type PillarSet,
} from './saju-calendar.js';
import { addDays } from './kst.js';
import { dispatchLifeSignal } from './life-signal-evaluators/index.js';

const METRIC_TIMEOUT_MS = 5_000;
const BASELINE_WINDOW_DAYS = 28;

export type PillarLevel = 'wonguk' | 'daeun' | 'seun' | 'wolun' | 'ilun' | 'cumulative';

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
    | 'cumulative_pillar_count'
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
  /** 풀셋 evidence-only 시드 여부. true면 verify_status='no_metric'로 INSERT. */
  isEvidenceOnly: boolean;
  /** 시드 평가 중 SQL/시스템 오류 발생 시 message. truthy면 verify_status='error'로 INSERT. */
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
            s.name AS metric_name, s.kind,
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
 * - 'wonguk' / 'cumulative' → null (직접 매칭 불가 — wonguk은 Phase 2.5 1차에서 시드 없음, cumulative는 별도 trigger)
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
    case 'cumulative':
      return null;
  }
};

const VALID_ELEMENTS: readonly Element[] = ['목', '화', '토', '금', '수'];

const isElement = (v: unknown): v is Element =>
  typeof v === 'string' && (VALID_ELEMENTS as readonly string[]).includes(v);

/**
 * cumulative_pillar_count trigger 평가 (Phase 2.5).
 * trigger_aux:
 *   - { element: '화', count_min: 3 } — 화 오행이 5개 운 레벨 중 3개 이상에서 발현
 *   - { sipsin: '편재', count_min: 2 } — 편재가 5개 운 레벨 중 2개 이상에서 발현
 */
const evaluateCumulativePillarCount = (seed: SajuSeed, ctx: DailyContext): boolean => {
  const aux = seed.trigger_aux ?? {};
  const countMin = getNumberField(aux as Record<string, unknown>, 'count_min');
  if (countMin === null || countMin <= 0) return false;

  const pillarSet: PillarSet = {
    wonguk: ctx.natal.pillars,
    daeun: ctx.daeun,
    seun: ctx.seun,
    wolun: ctx.wolun,
    ilun: ctx.ilun,
  };
  const count = computeCumulativePillarCount(ctx.natal.dayMaster, pillarSet);

  if (isElement(aux['element'])) {
    return count.element[aux['element']] >= countMin;
  }
  if (typeof aux['sipsin'] === 'string') {
    return (count.sipsin[aux['sipsin']] ?? 0) >= countMin;
  }
  return false;
};

export const evaluateTrigger = async (
  seed: SajuSeedWithMetrics,
  ctx: DailyContext,
  stemNameToId: Map<string, number>,
  branchNameToId: Map<string, number>,
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

    case 'cumulative_pillar_count':
      return evaluateCumulativePillarCount(seed, ctx);

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

const runMetricSql = async (sql: string, userId: number, date: string): Promise<number> => {
  const result = await queryWithClient<Record<string, unknown>>(
    // pg parameter binding은 query() 경로로만 가능, queryWithClient는 raw query.
    // metric SQL은 catalog에 영속된 신뢰 SQL이므로 $1/$2 자리에 안전한 값 대입.
    // userId는 INTEGER, date는 'YYYY-MM-DD' 형식 → SQL injection 위험 없음.
    sql.replace(/\$1/g, String(userId)).replace(/\$2/g, `'${date}'`),
    METRIC_TIMEOUT_MS,
  );
  const firstRow = result.rows[0];
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

const baselineAvg = async (sql: string, userId: number, date: string): Promise<number> => {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= BASELINE_WINDOW_DAYS; i++) {
    const d = addDays(date, -i);
    try {
      const v = await runMetricSql(sql, userId, d);
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

  const todayValue = await runMetricSql(sql, userId, date);

  let baseline: number | null = null;
  let passed = false;

  switch (direction) {
    case 'above_avg':
      baseline = await baselineAvg(sql, userId, date);
      passed = todayValue > baseline;
      break;
    case 'below_avg':
      baseline = await baselineAvg(sql, userId, date);
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

const buildNameIdMap = async (
  table: 'stems_master' | 'branches_master',
): Promise<Map<string, number>> => {
  const result = await query<NameIdRow>(`SELECT id, name FROM ${table}`);
  return new Map(result.rows.map((r) => [r.name, r.id]));
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

  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  const results: SeedMatchResult[] = [];
  for (const seed of seeds) {
    // Phase 8a: per-seed try/catch — 한 시드 trigger SQL 실패가 cron 전체를 죽이지 않게 격리.
    // 내부 metric try/catch는 trigger 통과 후 일부 metric만 fail하는 케이스 보호 → 보존.
    try {
      const triggerActivated = await evaluateTrigger(seed, ctx, stemMap, branchMap);

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
    const metricValues = Object.fromEntries(
      r.metricEvaluations.map((e) => [
        e.metric_name,
        {
          today: e.todayValue,
          baseline: e.baselineAvg,
          passed: e.passed,
        },
      ]),
    );
    // Phase 8a: 시드 평가 실패 시 verify_status='error' + error_message JSONB로 INSERT (멱등 + 디버깅).
    // ON CONFLICT에 error_message도 포함 → 다음 cron 재실행 시 성공하면 자동 NULL로 회복.
    const verifyStatus = r.triggerError ? 'error' : r.isEvidenceOnly ? 'no_metric' : 'pending';
    const errorMessage = r.triggerError ? JSON.stringify({ reason: r.triggerError }) : null;
    await query(
      `INSERT INTO pattern_matches
         (user_id, date, pattern_id, trigger_activated, metric_values, matched, verify_status, error_message)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
       ON CONFLICT (user_id, date, pattern_id) DO UPDATE
         SET trigger_activated = EXCLUDED.trigger_activated,
             metric_values     = EXCLUDED.metric_values,
             matched           = EXCLUDED.matched,
             verify_status     = EXCLUDED.verify_status,
             error_message     = EXCLUDED.error_message`,
      [
        userId,
        date,
        r.seed.id,
        r.triggerActivated,
        JSON.stringify(metricValues),
        r.matched,
        verifyStatus,
        errorMessage,
      ],
    );
  }
};

// ─── 검증 사이클 ─────────────────────────────────────────
// #477 P1: 일별 verify(verify_status 확정 + 카운터 누적)는 P2 주간 검증 엔진으로 이관.
// 카운터(hit/miss/posterior)는 pattern_links에 누적(이관 완료) → 주간 재계산이 raw pattern_matches
// 윈도우를 결정론 재산출(ADR-0033 §2). 본 모듈은 매칭·기록(raw trigger-log)까지만 담당.

// ─── Slack 한 줄 압축 ────────────────────────────────────

const MAX_LINE_SEEDS = 3;

export const compactMatchedLine = async (
  ctx: DailyContext,
  results: SeedMatchResult[],
): Promise<string | null> => {
  const matched = results.filter((r) => r.matched);
  if (matched.length === 0) return null;

  // 우선순위: pattern_summary view의 total_hits 높은 시드 = 검증된 시드 우선 (재현성 신뢰도)
  // ADR-0023: 시드 단위 합계는 view에서 derive (catalog 카운터 의존 제거).
  const patternIds = matched.map((r) => r.seed.id);
  const summary = await query<{ pattern_id: number; total_hits: string }>(
    `SELECT pattern_id, total_hits
       FROM pattern_summary
      WHERE pattern_id = ANY($1)`,
    [patternIds],
  );
  const hitsByPattern = new Map<number, number>();
  for (const row of summary.rows) {
    hitsByPattern.set(row.pattern_id, Number(row.total_hits));
  }

  matched.sort((a, b) => (hitsByPattern.get(b.seed.id) ?? 0) - (hitsByPattern.get(a.seed.id) ?? 0));
  const top = matched.slice(0, MAX_LINE_SEEDS);

  const labels = top.map((r) => {
    const passedDomains = new Set(r.metricEvaluations.filter((e) => e.passed).map((e) => e.domain));
    const summaryText = Array.from(passedDomains).join('/');
    return `${r.seed.sipsin ?? r.seed.name} (${summaryText})`;
  });

  return `오늘 일운 ${ctx.dayStem}${ctx.dayBranch} — ${labels.join(', ')}`;
};

// ─── 캐시 reset (테스트용) ───────────────────────────────

export const __resetCacheForTest = (): void => {
  branchRelationCache = null;
};
