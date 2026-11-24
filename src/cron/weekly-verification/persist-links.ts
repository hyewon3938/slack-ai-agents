import { query } from '../../shared/db.js';
import type { LinkVerification, StrengthCutpoint } from '../../shared/pattern-verification.js';
import type { ConfoundResult } from '../../shared/confound.js';

const numOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/**
 * 링크 검증 결과를 pattern_links에 SET 반영 (counters는 raw 재계산 진실로 덮어씀).
 * named export — 재기준선 스크립트(scripts/rebaseline-pattern-links.ts)가 재사용 (#523 P0).
 */
export const persistLinkVerification = async (l: LinkVerification): Promise<void> => {
  const testDetail = JSON.stringify({
    a: l.a,
    b: l.b,
    c: l.c,
    d: l.d,
    n_active: l.nActive,
    n_off: l.nOff,
    inconclusive: l.inconclusive,
    rate_active: numOrNull(l.rateActive),
    rate_off: numOrNull(l.rateOff),
    signal_kind: l.signalKind,
    value_type: l.valueType,
    verdict: l.verdict,
    // 전·후반 효과 부호 일치(표시용, 게이트 아님) — response_profile 셀 stability 입력. #523 P1.
    stability: l.stability,
    // 클립 합성 윈도우 시작(데이터-존재 + enrollment) — 관측성. discovery/llm은 등록 익일 이상이어야 정상.
    window_start: l.windowStart,
    // P3: p_value 컬럼 = block-perm p(자기상관 보정). Fisher·MW·e-value는 참고용 보존.
    fisher_p: numOrNull(l.fisherP),
    block_p: numOrNull(l.pValue),
    e_value: numOrNull(l.eValue),
    mann_whitney: l.mannWhitney
      ? {
          u: numOrNull(l.mannWhitney.u),
          p: numOrNull(l.mannWhitney.p),
          z: numOrNull(l.mannWhitney.z),
          hodges_lehmann: numOrNull(l.mannWhitney.hodgesLehmann),
        }
      : null,
  });
  await query(
    `UPDATE pattern_links SET
        hit_count          = $2,
        miss_count         = $3,
        inconclusive_count = $4,
        p_value            = $5,
        q_value            = $6,
        effect             = $7,
        test_type          = 'fisher_2x2',
        posterior_alpha    = $8,
        posterior_beta     = $9,
        posterior_p        = $10,
        test_detail        = $11::jsonb,
        status             = $12,
        last_matched_at    = COALESCE($13::timestamptz, last_matched_at),
        e_value            = $14,
        updated_at         = NOW()
      WHERE id = $1`,
    [
      l.linkId,
      l.a,
      l.b,
      l.inconclusive,
      numOrNull(l.pValue),
      numOrNull(l.qValue),
      numOrNull(l.effect),
      l.posteriorAlpha,
      l.posteriorBeta,
      numOrNull(l.posteriorP),
      testDetail,
      l.nextStatus,
      l.lastMatchedAt,
      numOrNull(l.eValue),
    ],
  );
};

/** 링크 주간 스냅샷 UPSERT (link_weekly_stats) — 마틴게일 trail·emerging 진행바·주간대비(멱등). */
export const persistWeeklySnapshot = async (
  userId: number,
  l: LinkVerification,
  weekStart: string,
): Promise<void> => {
  await query(
    `INSERT INTO link_weekly_stats
        (user_id, link_id, week_start, e_value, a, b, c, d,
         posterior_alpha, posterior_beta, p_value, q_value, effect, test_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'fisher_2x2')
     ON CONFLICT (link_id, week_start) DO UPDATE SET
        e_value = EXCLUDED.e_value, a = EXCLUDED.a, b = EXCLUDED.b,
        c = EXCLUDED.c, d = EXCLUDED.d,
        posterior_alpha = EXCLUDED.posterior_alpha, posterior_beta = EXCLUDED.posterior_beta,
        p_value = EXCLUDED.p_value, q_value = EXCLUDED.q_value, effect = EXCLUDED.effect,
        computed_at = NOW()`,
    [
      userId,
      l.linkId,
      weekStart,
      numOrNull(l.eValue),
      l.a,
      l.b,
      l.c,
      l.d,
      l.posteriorAlpha,
      l.posteriorBeta,
      numOrNull(l.pValue),
      numOrNull(l.qValue),
      numOrNull(l.effect),
    ],
  );
};

/** 강도 분위수 컷 UPSERT (strength_band_cutpoints) — 일별 cron의 "오늘 밴드" 판정용(#477 P4a). */
export const persistStrengthCutpoints = async (
  userId: number,
  cuts: StrengthCutpoint[],
): Promise<void> => {
  for (const c of cuts) {
    await query(
      `INSERT INTO strength_band_cutpoints (user_id, target, low_cut, high_cut, n_samples, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, target) DO UPDATE SET
         low_cut = EXCLUDED.low_cut, high_cut = EXCLUDED.high_cut,
         n_samples = EXCLUDED.n_samples, computed_at = NOW()`,
      [userId, c.target, c.low, c.high, c.nSamples],
    );
  }
};

/**
 * 교란 플래그를 pattern_links.confound에 SET (annotate-only, P6 ADR-0041).
 * verdict·status·e-value·tier는 건드리지 않음 — 사이드카 주석. user_id 가드로 교차 유저 차단.
 */
export const persistConfound = async (userId: number, r: ConfoundResult): Promise<void> => {
  await query(`UPDATE pattern_links SET confound = $1::jsonb WHERE id = $2 AND user_id = $3`, [
    JSON.stringify(r.confound),
    r.linkId,
    userId,
  ]);
};
