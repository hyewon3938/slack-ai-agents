/**
 * 사주 시드 카탈로그 기반 일일 매칭 엔진.
 * ADR-0017 참조.
 *
 * 흐름:
 *   1) loadActiveSeeds — saju_signal_catalog + metrics 조회
 *   2) getDailyContext — 일운(getDayPillar) + 본명(saju_profiles) 로드
 *   3) evaluateTrigger — trigger_target_type별 분기 평가
 *   4) evaluateMetrics — 메트릭 SQL 실행 + 28일 baseline 비교 → matched 판정
 *   5) recordDailyMatch — saju_daily_matches UPSERT
 */

import { query, queryWithClient } from './db.js';
import { getDayPillar, type Cheongan, type Jiji } from './saju-calendar.js';
import { addDays } from './kst.js';

const METRIC_TIMEOUT_MS = 5_000;
const BASELINE_WINDOW_DAYS = 28;

export interface SajuSeed {
  id: number;
  user_id: number;
  name: string;
  sipsin: string | null;
  description: string | null;
  trigger_target_type: 'stem' | 'branch' | 'ganji' | 'element_density' | 'sibiunsung' | 'relation';
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
  active: boolean;
  source: 'seed' | 'llm_promoted';
  hit_count: number;
  miss_count: number;
  inconclusive_count: number;
}

export interface SajuMetric {
  id: number;
  signal_id: number;
  metric_name: string;
  expected_metric_sql: string;
  expected_direction: 'above_avg' | 'below_avg' | 'above_abs' | 'below_abs' | 'flag_present';
  expected_threshold: number | null;
  domain: 'schedule' | 'routine' | 'sleep' | 'expense' | 'diary_meta' | 'audit';
}

export interface SajuSeedWithMetrics extends SajuSeed {
  metrics: SajuMetric[];
}

export interface NatalContext {
  stems: Cheongan[];
  branches: Jiji[];
  dayMaster: Cheongan;
}

export interface DailyContext {
  date: string;
  dayStem: Cheongan;
  dayBranch: Jiji;
  natal: NatalContext;
}

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
  matched: boolean;
}

// ─── 본명 / 일운 컨텍스트 ────────────────────────────────

interface SajuProfileRow {
  day_pillar: string;
  year_pillar: string;
  month_pillar: string;
  hour_pillar: string;
}

export const loadNatalContext = async (userId: number): Promise<NatalContext | null> => {
  const result = await query<SajuProfileRow>(
    'SELECT day_pillar, year_pillar, month_pillar, hour_pillar FROM saju_profiles WHERE user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const pillars = [row.year_pillar, row.month_pillar, row.day_pillar, row.hour_pillar];
  const stems = pillars.map((p) => p.charAt(0)) as Cheongan[];
  const branches = pillars.map((p) => p.charAt(1)) as Jiji[];
  return {
    stems,
    branches,
    dayMaster: row.day_pillar.charAt(0) as Cheongan,
  };
};

export const getDailyContext = async (
  userId: number,
  date: string,
): Promise<DailyContext | null> => {
  const natal = await loadNatalContext(userId);
  if (!natal) return null;
  const pillar = getDayPillar(date);
  return {
    date,
    dayStem: pillar.cheongan,
    dayBranch: pillar.jiji,
    natal,
  };
};

// ─── 시드 로드 ──────────────────────────────────────────

type SeedRow = SajuSeed;
type MetricRow = SajuMetric;

export const loadActiveSeeds = async (userId: number): Promise<SajuSeedWithMetrics[]> => {
  const seeds = await query<SeedRow>(
    `SELECT id, user_id, name, sipsin, description,
            trigger_target_type, trigger_target_id, trigger_aux,
            active, source, hit_count, miss_count, inconclusive_count
       FROM saju_signal_catalog
      WHERE user_id = $1 AND active = true
      ORDER BY id`,
    [userId],
  );
  if (seeds.rows.length === 0) return [];

  const ids = seeds.rows.map((s) => s.id);
  const metrics = await query<MetricRow>(
    `SELECT id, signal_id, metric_name, expected_metric_sql,
            expected_direction, expected_threshold, domain
       FROM saju_signal_metrics
      WHERE signal_id = ANY($1)
      ORDER BY id`,
    [ids],
  );

  const metricBySignal = new Map<number, SajuMetric[]>();
  for (const m of metrics.rows) {
    const list = metricBySignal.get(m.signal_id) ?? [];
    list.push(m);
    metricBySignal.set(m.signal_id, list);
  }

  return seeds.rows.map((s) => ({
    ...s,
    metrics: metricBySignal.get(s.id) ?? [],
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

export const evaluateTrigger = async (
  seed: SajuSeedWithMetrics,
  ctx: DailyContext,
  stemNameToId: Map<string, number>,
  branchNameToId: Map<string, number>,
): Promise<boolean> => {
  const aux = seed.trigger_aux ?? {};
  const dayStemId = stemNameToId.get(ctx.dayStem);
  const dayBranchId = branchNameToId.get(ctx.dayBranch);

  switch (seed.trigger_target_type) {
    case 'stem':
      return seed.trigger_target_id !== null && seed.trigger_target_id === dayStemId;

    case 'branch': {
      if (seed.trigger_target_id !== null && seed.trigger_target_id === dayBranchId) return true;
      const orBranches = aux['or_branches'];
      if (isStringArray(orBranches) && orBranches.includes(ctx.dayBranch)) return true;
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

export const evaluateMetric = async (
  metric: SajuMetric,
  userId: number,
  date: string,
): Promise<MetricEvaluation> => {
  const todayValue = await runMetricSql(metric.expected_metric_sql, userId, date);

  let baseline: number | null = null;
  let passed = false;

  switch (metric.expected_direction) {
    case 'above_avg':
      baseline = await baselineAvg(metric.expected_metric_sql, userId, date);
      passed = todayValue > baseline;
      break;
    case 'below_avg':
      baseline = await baselineAvg(metric.expected_metric_sql, userId, date);
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
    direction: metric.expected_direction,
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
            `[saju-match] metric 평가 실패 seed=${seed.name} metric=${m.metric_name}: ${errMsg}`,
          );
        }
      }
    }

    const matched = triggerActivated && metricEvaluations.some((e) => e.passed);
    results.push({ seed, triggerActivated, metricEvaluations, matched });
  }
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
    await query(
      `INSERT INTO saju_daily_matches
         (user_id, date, signal_id, trigger_activated, metric_values, matched, verify_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending')
       ON CONFLICT (user_id, date, signal_id) DO UPDATE
         SET trigger_activated = EXCLUDED.trigger_activated,
             metric_values = EXCLUDED.metric_values,
             matched = EXCLUDED.matched`,
      [userId, date, r.seed.id, r.triggerActivated, JSON.stringify(metricValues), r.matched],
    );
  }
};

// ─── 검증 사이클 (다음날 verify_status 확정 + outcome 카운트 누적) ─────

export const verifyDailyMatches = async (userId: number): Promise<void> => {
  // 어제 trigger_activated=true 매칭의 pending → hit/miss 확정
  const pending = await query<{ id: number; signal_id: number; matched: boolean | null }>(
    `SELECT id, signal_id, matched
       FROM saju_daily_matches
      WHERE user_id = $1 AND verify_status = 'pending'
        AND date <= (CURRENT_DATE - INTERVAL '1 day')
        AND trigger_activated = true`,
    [userId],
  );

  for (const row of pending.rows) {
    const outcome = row.matched ? 'hit' : 'miss';
    await query(`UPDATE saju_daily_matches SET verify_status = $1 WHERE id = $2`, [
      outcome,
      row.id,
    ]);
    const counter = outcome === 'hit' ? 'hit_count' : 'miss_count';
    await query(`UPDATE saju_signal_catalog SET ${counter} = ${counter} + 1 WHERE id = $1`, [
      row.signal_id,
    ]);
  }

  // trigger_activated=false는 inconclusive 처리 (시드는 카운트하되 outcome에 영향 X)
  await query(
    `UPDATE saju_daily_matches
        SET verify_status = 'inconclusive'
      WHERE user_id = $1 AND verify_status = 'pending'
        AND date <= (CURRENT_DATE - INTERVAL '1 day')
        AND trigger_activated = false`,
    [userId],
  );
};

// ─── Slack 한 줄 압축 ────────────────────────────────────

const MAX_LINE_SEEDS = 3;

export const compactMatchedLine = (
  ctx: DailyContext,
  results: SeedMatchResult[],
): string | null => {
  const matched = results.filter((r) => r.matched);
  if (matched.length === 0) return null;

  // 우선순위: hit_count 높은 시드 = 검증된 시드 우선 (재현성 신뢰도)
  matched.sort((a, b) => b.seed.hit_count - a.seed.hit_count);
  const top = matched.slice(0, MAX_LINE_SEEDS);

  const labels = top.map((r) => {
    const passedDomains = new Set(r.metricEvaluations.filter((e) => e.passed).map((e) => e.domain));
    const summary = Array.from(passedDomains).join('/');
    return `${r.seed.sipsin ?? r.seed.name} (${summary})`;
  });

  return `오늘 일운 ${ctx.dayStem}${ctx.dayBranch} — ${labels.join(', ')}`;
};

// ─── 캐시 reset (테스트용) ───────────────────────────────

export const __resetCacheForTest = (): void => {
  branchRelationCache = null;
};
