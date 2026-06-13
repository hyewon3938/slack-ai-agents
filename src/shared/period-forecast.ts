/**
 * 예측 장부 — 생성·채점·로드 (#531 / #523 Phase 3, ADR-0050).
 *
 * 상위 주기(월운·세운) 해석을 사전등록 → 사후 채점 장부로 잇는다. 검증 불가 층에
 * 확증편향 차단 규율을 심는 자기검증 메커니즘:
 *   - 시간 구동: 생성·채점 모두 periodFortune 절기/입춘 게이트만으로 무인 작동(수동 트리거 0).
 *   - 멱등: 같은 (user,type,start) 재생성 안 함 → baseline 동결 무결성. 채점은 status='open' 가드.
 *   - self-heal: 채점은 period_end <= today(== 아님) — 놓친 전환을 다음 전환이 자동 회수.
 *   - 동결 = 등록 시 봉인: baseline_rate는 생성 시점 캡처, 채점이 절대 재계산 안 함(사다리 Decision 3).
 *
 * 검증가능성 사다리(ADR-0050): wolun/seun만(대운 비편입 — 채점 주기가 수명 초과 = 비실증 층).
 * Brier 등 확률점수 금지 — 표본 없는 층에서 확률 산출은 과대주장. 방향 적중 + 실측 delta만.
 *
 * 순수 도출(랭킹·대표선택·방향·집계)은 결정론, DB I/O는 격리. period-interpretation은
 * LedgerCardData를 type-only import(런타임 순환 0) — 이 파일은 순수 데이터만 산출.
 */

import { query } from './db.js';
import { addDays } from './kst.js';
import {
  computeSignalSeries,
  computeUserDataStarts,
  signalDataStart,
  loadSignalDefsByIds,
} from './pattern-verification.js';
import type { MeasuredCell } from './period-interpretation.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

const PF = INSIGHT_THRESHOLDS.periodForecast;

/** 장부 편입 주기 — wolun/seun만(대운 비편입). */
export type LedgerPeriodType = 'wolun' | 'seun';

/** 근거 셀 provenance — 예측 행이 어느 측정 셀·대표 신호에서 나왔는지(채점은 안 읽음, 카드·감사용). */
export type ForecastSourceCell = Omit<MeasuredCell, 'sourceLinkIds'> & { signalId: number };

/** no_call 사유 — 예측할 측정 셀이 없었음(D8: '예측 안 함'도 정보). */
export interface NoCallReason {
  reason: string;
}

/** 생성/로드 결과 1행 (open 예측 또는 no_call). */
export interface ForecastEntry {
  signalId: number | null;
  status: 'open' | 'no_call';
  predictedDirection: 'up' | 'down' | null;
  baselineRate: number | null;
  sourceCell: ForecastSourceCell | NoCallReason;
}

/** 채점 결과 1행. */
export interface ScoredEntry {
  signalId: number | null;
  status: 'scored' | 'unmeasurable';
  predictedDirection: 'up' | 'down' | null;
  baselineRate: number | null;
  measuredRate: number | null;
  measuredDelta: number | null;
  directionHit: boolean | null;
  sourceCell: ForecastSourceCell;
}

/** 카드 렌더 입력(순수 데이터) — period-interpretation이 type-only import. */
export interface LedgerCardData {
  periodType: LedgerPeriodType;
  scored: ScoredEntry[]; // 지난 기간 채점 결과
  forecasts: ForecastEntry[]; // 이번 기간 예측(open + no_call)
}

export interface ForecastRange {
  start: string;
  end: string;
}

// ─── 순수 도출 (결정론) ───────────────────────────────────

/** 셀 랭킹 — tier(verified>emerging) → shrunkEffect desc → nActiveDays desc → (도메인·키 tie-break = 결정론). */
const rankCells = (cells: ReadonlyArray<MeasuredCell>): MeasuredCell[] =>
  [...cells].sort((a, b) => {
    const ta = a.tier === 'verified' ? 0 : 1;
    const tb = b.tier === 'verified' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const ea = a.shrunkEffect ?? -Infinity;
    const eb = b.shrunkEffect ?? -Infinity;
    if (ea !== eb) return eb - ea;
    if (a.nActiveDays !== b.nActiveDays) return b.nActiveDays - a.nActiveDays;
    return a.domain.localeCompare(b.domain) || a.axisKey.localeCompare(b.axisKey);
  });

/** 셀 shrunkEffect 부호 → 예측 방향(§5-C). 현재 게이트상 사실상 항상 'up'(effect≥1.3), 컬럼은 명시 보존. */
const predictDirection = (cell: MeasuredCell): 'up' | 'down' =>
  (cell.shrunkEffect ?? 0) >= 1 ? 'up' : 'down';

/** 기간 일자 enumerate (start~end 포함). buildWindowDates는 today-anchored라 부적합 → 로컬. */
const enumerateDates = (start: string, end: string): string[] => {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
};

// ─── 대표 신호 해소 (§5-A) ────────────────────────────────

interface RepresentativeLinkRow {
  signal_id: number;
  n_active: number;
  rate_off: number | null;
}

/**
 * 셀의 sourceLinkIds 중 발현일(nActive) 최대 링크의 (signal, rate_off). 타이=min signal_id(결정론).
 * rate_off 무효(NULL/≤0)인 링크는 건너뜀, 전부 무효면 null(그 셀은 예측 불가 → skip).
 * baseline = 대표 링크 rate_off(발현-부재 비율) 동결(§5-B) — 전이 가설의 올바른 null.
 */
const resolveRepresentative = async (
  userId: number,
  linkIds: ReadonlyArray<number>,
): Promise<{ signalId: number; baseline: number } | null> => {
  if (linkIds.length === 0) return null;
  const res = await query<RepresentativeLinkRow>(
    `SELECT signal_id,
            (hit_count + miss_count) AS n_active,
            (test_detail->>'rate_off')::float AS rate_off
       FROM pattern_links
      WHERE id = ANY($1::int[]) AND user_id = $2`,
    [[...linkIds], userId],
  );
  const valid = res.rows
    .filter((r): r is RepresentativeLinkRow & { rate_off: number } => {
      const ro = r.rate_off === null ? null : Number(r.rate_off);
      return ro !== null && ro > 0;
    })
    .sort((a, b) => b.n_active - a.n_active || a.signal_id - b.signal_id);
  const best = valid[0];
  return best ? { signalId: best.signal_id, baseline: Number(best.rate_off) } : null;
};

// ─── DB 행 ↔ 엔트리 ───────────────────────────────────────

interface ForecastDbRow {
  signal_id: number | null;
  status: string;
  predicted_direction: string | null;
  baseline_rate: number | null;
  source_cell: unknown;
  measured_rate: number | null;
  measured_delta: number | null;
  direction_hit: boolean | null;
}

const parseDirection = (s: string | null): 'up' | 'down' | null =>
  s === 'up' || s === 'down' ? s : null;

const parseSourceCell = (raw: unknown): ForecastSourceCell | NoCallReason => {
  if (typeof raw !== 'object' || raw === null) return { reason: '근거 미상' };
  return raw as ForecastSourceCell | NoCallReason;
};

const toForecastEntry = (row: ForecastDbRow): ForecastEntry => ({
  signalId: row.signal_id,
  status: row.status === 'no_call' ? 'no_call' : 'open',
  predictedDirection: parseDirection(row.predicted_direction),
  baselineRate: row.baseline_rate === null ? null : Number(row.baseline_rate),
  sourceCell: parseSourceCell(row.source_cell),
});

const toScoredEntry = (row: ForecastDbRow): ScoredEntry => ({
  signalId: row.signal_id,
  status: row.status === 'unmeasurable' ? 'unmeasurable' : 'scored',
  predictedDirection: parseDirection(row.predicted_direction),
  baselineRate: row.baseline_rate === null ? null : Number(row.baseline_rate),
  measuredRate: row.measured_rate === null ? null : Number(row.measured_rate),
  measuredDelta: row.measured_delta === null ? null : Number(row.measured_delta),
  directionHit: row.direction_hit,
  sourceCell: parseSourceCell(row.source_cell) as ForecastSourceCell,
});

const FORECAST_COLUMNS = `signal_id, status, predicted_direction, baseline_rate, source_cell,
            measured_rate, measured_delta, direction_hit`;

/** 특정 (user, type, start)의 예측 행 로드 (멱등 가드용). */
const loadForecastsForPeriod = async (
  userId: number,
  periodType: LedgerPeriodType,
  periodStart: string,
): Promise<ForecastEntry[]> => {
  const res = await query<ForecastDbRow>(
    `SELECT ${FORECAST_COLUMNS}
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND period_start = $3
        AND status IN ('open', 'no_call')
      ORDER BY id`,
    [userId, periodType, periodStart],
  );
  return res.rows.map(toForecastEntry);
};

// ─── 생성 (사전등록) ──────────────────────────────────────

/**
 * 이번 기간 top-K 예측 사전등록 — 멱등(이미 행 있으면 재생성 안 함, baseline 동결 무결성).
 * 셀 랭킹 → 대표 신호 해소(§5-A) → signal_id dedup → topK개 open INSERT, 0개면 no_call 1행(D8).
 */
export const generateForecasts = async (
  userId: number,
  periodType: LedgerPeriodType,
  range: ForecastRange,
  measuredCells: ReadonlyArray<MeasuredCell>,
): Promise<ForecastEntry[]> => {
  // 멱등 가드: 이 기간에 이미 등록됐으면 재생성 금지(첫 등록만 유효 = baseline 동결).
  const existing = await loadForecastsForPeriod(userId, periodType, range.start);
  if (existing.length > 0) return existing;

  const ranked = rankCells(measuredCells);
  const entries: ForecastEntry[] = [];
  const usedSignals = new Set<number>();

  for (const cell of ranked) {
    if (entries.length >= PF.topK) break;
    const rep = await resolveRepresentative(userId, cell.sourceLinkIds);
    if (!rep) continue; // 유효 rate_off 링크 없음 → 예측 불가
    if (usedSignals.has(rep.signalId)) continue; // dedup: 상위 셀 유지
    usedSignals.add(rep.signalId);
    const sourceCell: ForecastSourceCell = {
      domain: cell.domain,
      via: cell.via,
      resolvedLevel: cell.resolvedLevel,
      axisKey: cell.axisKey,
      element: cell.element,
      tier: cell.tier,
      shrunkEffect: cell.shrunkEffect,
      nActiveDays: cell.nActiveDays,
      signalId: rep.signalId,
    };
    entries.push({
      signalId: rep.signalId,
      status: 'open',
      predictedDirection: predictDirection(cell),
      baselineRate: rep.baseline,
      sourceCell,
    });
  }

  if (entries.length > 0) {
    for (const e of entries) {
      await query(
        `INSERT INTO period_forecasts
           (user_id, period_type, period_start, period_end, signal_id, status,
            predicted_direction, baseline_rate, source_cell)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          userId,
          periodType,
          range.start,
          range.end,
          e.signalId,
          e.predictedDirection,
          e.baselineRate,
          JSON.stringify(e.sourceCell),
        ],
      );
    }
    return entries;
  }

  // 예측할 측정 셀 0개 → no_call 1행(침묵 금지, D8). partial unique가 기간당 1행 보장.
  const reason: NoCallReason = {
    reason:
      measuredCells.length === 0
        ? '이 기운에 대해 측정된 반응이 아직 없어'
        : '측정 셀은 있었지만 채점 가능한 baseline을 못 잡았어',
  };
  await query(
    `INSERT INTO period_forecasts
       (user_id, period_type, period_start, period_end, signal_id, status, source_cell)
     VALUES ($1, $2, $3, $4, NULL, 'no_call', $5::jsonb)
     ON CONFLICT DO NOTHING`,
    [userId, periodType, range.start, range.end, JSON.stringify(reason)],
  );
  return [
    {
      signalId: null,
      status: 'no_call',
      predictedDirection: null,
      baselineRate: null,
      sourceCell: reason,
    },
  ];
};

// ─── 채점 (사후) ──────────────────────────────────────────

interface OpenForecastRow {
  id: number;
  period_start: string;
  period_end: string;
  signal_id: number | null;
  predicted_direction: string | null;
  baseline_rate: number | null;
  source_cell: unknown;
}

/**
 * 직전 기간 open 예측 채점 — self-heal(period_end <= today, == 아님)로 놓친 전환 자동 회수.
 * 신호 시리즈를 기간 한정 집계 → measured_rate/delta/방향적중. 측정가능일 부족 시 unmeasurable(강제판정 금지).
 * baseline_rate는 절대 재계산 안 함(동결 불변식). UPDATE는 status='open' 가드(멱등).
 */
export const scoreForecasts = async (
  userId: number,
  periodType: LedgerPeriodType,
  today: string,
): Promise<ScoredEntry[]> => {
  const openRes = await query<OpenForecastRow>(
    `SELECT id, period_start::text, period_end::text, signal_id,
            predicted_direction, baseline_rate, source_cell
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND status = 'open' AND period_end <= $3
      ORDER BY id`,
    [userId, periodType, today],
  );
  if (openRes.rows.length === 0) return [];

  const signalIds = [
    ...new Set(openRes.rows.map((r) => r.signal_id).filter((v): v is number => v !== null)),
  ];
  const signalById = await loadSignalDefsByIds(signalIds);
  const dataStarts = await computeUserDataStarts(userId);

  const out: ScoredEntry[] = [];
  for (const row of openRes.rows) {
    const baseline = row.baseline_rate === null ? null : Number(row.baseline_rate);
    const direction = parseDirection(row.predicted_direction);
    const sourceCell = parseSourceCell(row.source_cell) as ForecastSourceCell;
    const signal = row.signal_id !== null ? signalById.get(row.signal_id) : undefined;

    // 신호 결측/비활성 또는 baseline 없음 → 측정 불가(강제판정 금지).
    if (!signal || baseline === null || direction === null) {
      await markUnmeasurable(row.id);
      out.push(unmeasurableEntry(row.signal_id, direction, baseline, sourceCell));
      continue;
    }

    const windowDates = enumerateDates(
      addDays(row.period_start, -PF.baselineLeadInDays),
      row.period_end,
    );
    const dataStart = signalDataStart(signal.domain, dataStarts);
    const { series } = await computeSignalSeries(userId, signal, windowDates, dataStart);

    // 기간 한정 집계: period_start ≤ d ≤ period_end인 날만(lead-in은 baseline 워밍업 전용).
    let measurable = 0;
    let pass = 0;
    for (let d = row.period_start; d <= row.period_end; d = addDays(d, 1)) {
      const v = series.get(d);
      if (v === null || v === undefined) continue; // 측정불가일
      measurable += 1;
      if (v === true) pass += 1;
    }

    if (measurable < PF.minMeasurableDays) {
      await markUnmeasurable(row.id);
      out.push(unmeasurableEntry(row.signal_id, direction, baseline, sourceCell));
      continue;
    }

    const measuredRate = pass / measurable;
    const measuredDelta = measuredRate - baseline;
    const directionHit = direction === 'up' ? measuredRate > baseline : measuredRate < baseline; // 동률=미적중
    await query(
      `UPDATE period_forecasts
          SET status = 'scored', measured_rate = $2, measured_delta = $3,
              direction_hit = $4, scored_at = NOW()
        WHERE id = $1 AND status = 'open'`,
      [row.id, measuredRate, measuredDelta, directionHit],
    );
    out.push({
      signalId: row.signal_id,
      status: 'scored',
      predictedDirection: direction,
      baselineRate: baseline,
      measuredRate,
      measuredDelta,
      directionHit,
      sourceCell,
    });
  }
  return out;
};

const markUnmeasurable = async (id: number): Promise<void> => {
  await query(
    `UPDATE period_forecasts SET status = 'unmeasurable', scored_at = NOW()
      WHERE id = $1 AND status = 'open'`,
    [id],
  );
};

const unmeasurableEntry = (
  signalId: number | null,
  direction: 'up' | 'down' | null,
  baseline: number | null,
  sourceCell: ForecastSourceCell,
): ScoredEntry => ({
  signalId,
  status: 'unmeasurable',
  predictedDirection: direction,
  baselineRate: baseline,
  measuredRate: null,
  measuredDelta: null,
  directionHit: null,
  sourceCell,
});

// ─── 로드 (fast path) ─────────────────────────────────────

/** 상태 집합 중 최신 period_start의 행. */
const loadLatestEntries = async (
  userId: number,
  periodType: LedgerPeriodType,
  statuses: ReadonlyArray<string>,
): Promise<ForecastDbRow[]> => {
  const res = await query<ForecastDbRow>(
    `SELECT ${FORECAST_COLUMNS}
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND status = ANY($3::text[])
        AND period_start = (
          SELECT MAX(period_start) FROM period_forecasts
           WHERE user_id = $1 AND period_type = $2 AND status = ANY($3::text[]))
      ORDER BY id`,
    [userId, periodType, [...statuses]],
  );
  return res.rows;
};

/** 최신 기간 예측(open+no_call) + 직전 채점(scored+unmeasurable) — fast path 카드용. */
export const loadLedger = async (
  userId: number,
  periodType: LedgerPeriodType,
): Promise<LedgerCardData> => {
  const [forecastRows, scoredRows] = await Promise.all([
    loadLatestEntries(userId, periodType, ['open', 'no_call']),
    loadLatestEntries(userId, periodType, ['scored', 'unmeasurable']),
  ]);
  return {
    periodType,
    forecasts: forecastRows.map(toForecastEntry),
    scored: scoredRows.map(toScoredEntry),
  };
};
