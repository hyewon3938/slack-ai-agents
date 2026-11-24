/** 예측 장부 — 사전등록 예측 생성. */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type {
  MeasuredCell,
  LedgerPeriodType,
  ForecastSourceCell,
  NoCallReason,
  ForecastEntry,
  ForecastRange,
} from './types.js';
import { loadForecastsForPeriod } from './forecast-rows.js';

const PF = INSIGHT_THRESHOLDS.periodForecast;

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
