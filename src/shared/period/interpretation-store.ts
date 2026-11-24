/** 기간 해석 — 응답 프로필 인덱스 로드와 해석 영속·조회. */

import type { Element } from '../saju/types.js';
import { query } from '../db.js';
import type { AxisLevel, CellTier, ResponseCell } from '../response-profile/axis.js';
import { indexCells } from '../response-profile/resolve.js';
import type {
  PeriodType,
  ResponseProfileIndex,
  MeasuredCell,
  TextbookCell,
  DescriptiveStats,
  InterpretationPayload,
  PeriodInterpretationRecord,
} from './types.js';

// ─── DB 헬퍼 (cron 영속 + fast path 조회 공용) ─────────────

interface ResponseProfileRow {
  axis_level: string;
  axis_key: string;
  element: string | null;
  domain: string;
  tier: string;
  alpha: string | null;
  beta: string | null;
  shrunk_effect: string | null;
  n_links: number;
  n_active_days: number;
  stability: boolean | null;
  source_link_ids: unknown;
}

const isAxisLevel = (s: string): s is AxisLevel =>
  s === 'char_stem' ||
  s === 'char_branch' ||
  s === 'sipsung' ||
  s === 'group' ||
  s === 'element_band';
const isElement = (s: string | null): s is Element =>
  s === '목' || s === '화' || s === '토' || s === '금' || s === '수';
const isTier = (s: string): s is CellTier => s === 'verified' || s === 'emerging';

/** saju_response_profile 행 → resolveCell 인덱스. cron 생성 시점 로드(ResponseCell 전 필드 복원). */
export const loadResponseProfileIndex = async (userId: number): Promise<ResponseProfileIndex> => {
  const res = await query<ResponseProfileRow>(
    `SELECT axis_level, axis_key, element, domain, tier, alpha, beta, shrunk_effect,
            n_links, n_active_days, stability, source_link_ids
       FROM saju_response_profile WHERE user_id = $1`,
    [userId],
  );
  const cells: ResponseCell[] = [];
  for (const r of res.rows) {
    if (!isAxisLevel(r.axis_level) || !isTier(r.tier)) continue;
    cells.push({
      axisLevel: r.axis_level,
      axisKey: r.axis_key,
      element: isElement(r.element) ? r.element : null,
      domain: r.domain,
      tier: r.tier,
      alpha: r.alpha !== null ? Number(r.alpha) : 0,
      beta: r.beta !== null ? Number(r.beta) : 0,
      shrunkEffect: r.shrunk_effect !== null ? Number(r.shrunk_effect) : null,
      nLinks: r.n_links,
      nActiveDays: r.n_active_days,
      stability: r.stability,
      sourceLinkIds: Array.isArray(r.source_link_ids)
        ? r.source_link_ids.filter((x): x is number => typeof x === 'number')
        : [],
    });
  }
  return indexCells(cells);
};

/** 해석 UPSERT — 같은 (user, type, start) 중복 시 재생성 갱신(cron 재실행 안전). */
export const upsertInterpretation = async (
  userId: number,
  record: PeriodInterpretationRecord,
): Promise<void> => {
  await query(
    `INSERT INTO period_interpretations
       (user_id, period_type, period_start, period_end, pillar, structured, narrative)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET period_end = EXCLUDED.period_end, pillar = EXCLUDED.pillar,
         structured = EXCLUDED.structured, narrative = EXCLUDED.narrative, created_at = NOW()`,
    [
      userId,
      record.periodType,
      record.periodStart,
      record.periodEnd,
      record.pillar,
      JSON.stringify(record.payload),
      record.narrative,
    ],
  );
};

interface InterpretationRow {
  period_type: string;
  period_start: string;
  period_end: string | null;
  pillar: string;
  structured: unknown;
  narrative: string;
}

const isPeriodType = (s: string): s is PeriodType => s === 'wolun' || s === 'seun' || s === 'daeun';

/** JSONB structured → InterpretationPayload(방어적 파싱, 누락 필드는 빈 값). */
const parsePayload = (raw: unknown): InterpretationPayload => {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const measuredCells = Array.isArray(obj['measuredCells'])
    ? (obj['measuredCells'] as MeasuredCell[])
    : [];
  const textbookCells = Array.isArray(obj['textbookCells'])
    ? (obj['textbookCells'] as TextbookCell[])
    : [];
  const ds = (
    typeof obj['descriptiveStats'] === 'object' && obj['descriptiveStats'] !== null
      ? obj['descriptiveStats']
      : {}
  ) as Record<string, unknown>;
  const descriptiveStats: DescriptiveStats = {
    scope: typeof ds['scope'] === 'string' ? ds['scope'] : '',
    rangeCount: typeof ds['rangeCount'] === 'number' ? ds['rangeCount'] : 0,
    sleep: (ds['sleep'] as DescriptiveStats['sleep']) ?? null,
    routine: (ds['routine'] as DescriptiveStats['routine']) ?? null,
    diary: (ds['diary'] as DescriptiveStats['diary']) ?? null,
  };
  return { measuredCells, textbookCells, descriptiveStats };
};

/** period_type별 최신 해석 1행 로드 — fast path 조회용(LLM 미호출). */
export const loadLatestInterpretation = async (
  userId: number,
  periodType: PeriodType,
): Promise<PeriodInterpretationRecord | null> => {
  const res = await query<InterpretationRow>(
    `SELECT period_type, period_start::text, period_end::text, pillar, structured, narrative
       FROM period_interpretations
      WHERE user_id = $1 AND period_type = $2
      ORDER BY period_start DESC, created_at DESC
      LIMIT 1`,
    [userId, periodType],
  );
  const row = res.rows[0];
  if (!row || !isPeriodType(row.period_type)) return null;
  return {
    periodType: row.period_type,
    pillar: row.pillar,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payload: parsePayload(row.structured),
    narrative: row.narrative,
  };
};
