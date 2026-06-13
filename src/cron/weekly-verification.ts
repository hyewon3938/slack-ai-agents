/**
 * 주간 off-day 검증 엔진 cron — 월요일 06:00 KST (#477 P2·P3).
 * weekly-hypothesis-review를 대체. ADR-0032(통계 스택)·0033(매트릭=가설)·0034(e-value)·0035(노출).
 *
 * 흐름:
 *   1) active pattern_links 전부 off-day 대조 재계산 (verifyUserLinks — raw 윈도우 재계산 + e-value)
 *   2) 링크별 pattern_links UPDATE (counters + p/q/effect/posterior/e_value/test_detail + status 전이)
 *   3) 링크별 주간 스냅샷 link_weekly_stats write (마틴게일 trail·emerging 진행바·주간대비)
 *   4) 시드 영향력 top 5 + 검증 현황(verified / 검증중 / reject) 카드 → #insight
 *
 * P3: 확정 게이트 = e_value ≥ 1/α(=20) → status='confirmed'(verified tier). reject만 추가로 DB 반영.
 * confirmed는 sticky(verifyUserLinks가 active만 재검증). 등급 노출은 saju_influence_summary(080).
 */

import type { App } from '@slack/bolt';
import { query, withTransaction } from '../shared/db.js';
import { getKSTDayOfWeek, getTodayISO } from '../shared/kst.js';
import { postBlockMessage } from '../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import {
  verifyUserLinks,
  computeStrengthCutpoints,
  type LinkVerification,
  type StrengthCutpoint,
} from '../shared/pattern-verification.js';
import { flagConfounds, type ConfoundData, type ConfoundResult } from '../shared/confound.js';
import { posteriorMean, credibleInterval } from '../shared/bayesian-posterior.js';
import { loadActiveSeeds, loadNatalContext, buildNameIdMap } from '../shared/pattern-match.js';
import {
  buildResponseProfile,
  type ProfileLink,
  type ResponseCell,
} from '../shared/response-profile.js';
import { seedLabel } from '../shared/insight-labels.js';
import { runSaturationSweep, type SaturationSweepResult } from '../shared/seed-saturation.js';
import {
  buildVerificationBlocks,
  buildHygieneNotice,
  type SeedInfluenceRow,
} from '../agents/insight/hypothesis-cards.js';
import { recommendDiscoveries } from './discovery-recommend.js';
import type { LifeCronConfig } from './life-cron.js';

const SEED_INFLUENCE_TOP_N = 5;

/** 오늘이 월요일이라는 전제 — 전주 월요일(=7일 전) ISO 반환 (카드 라벨용). */
export const previousMondayISO = (todayIso: string): string => {
  const d = new Date(`${todayIso}T12:00:00+09:00`);
  const dow = d.getUTCDay(); // 0=일, 1=월
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (daysSinceMonday + 7));
  return monday.toISOString().slice(0, 10);
};

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
const persistWeeklySnapshot = async (
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
const persistStrengthCutpoints = async (
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
const persistConfound = async (userId: number, r: ConfoundResult): Promise<void> => {
  await query(`UPDATE pattern_links SET confound = $1::jsonb WHERE id = $2 AND user_id = $3`, [
    JSON.stringify(r.confound),
    r.linkId,
    userId,
  ]);
};

/** 직전 주(들) 링크별 e_value — emerging 진행바 "지난주 → 이번주" delta용 (link당 최신 1행). */
const loadPrevWeekEValues = async (
  userId: number,
  weekStart: string,
): Promise<Map<number, number>> => {
  const res = await query<{ link_id: number; e_value: string | null }>(
    `SELECT DISTINCT ON (link_id) link_id, e_value
       FROM link_weekly_stats
      WHERE user_id = $1 AND week_start < $2
      ORDER BY link_id, week_start DESC`,
    [userId, weekStart],
  );
  const m = new Map<number, number>();
  for (const r of res.rows) {
    if (r.e_value !== null) m.set(r.link_id, Number(r.e_value));
  }
  return m;
};

/**
 * 시드 영향력 top N (credible interval lower bound 정렬).
 * pattern_summary(시드 메타 + active 여부) + pattern_links(α/β 합산, active|confirmed)에서 산출.
 * P3: confirmed(verified) 링크도 합산해 확정된 시드가 영향력 top에서 사라지지 않게(pattern_summary와 일관).
 */
const loadSeedInfluence = async (userId: number, topN: number): Promise<SeedInfluenceRow[]> => {
  const summaryRes = await query<{
    pattern_id: string;
    pattern_kind: 'saju' | 'life_signal';
    pattern_name: string;
    pattern_description: string | null;
    total_hits: string;
    total_misses: string;
  }>(
    `SELECT pattern_id::TEXT, pattern_kind, pattern_name, pattern_description,
            total_hits::TEXT, total_misses::TEXT
       FROM pattern_summary
      WHERE user_id = $1 AND active AND aggregate_posterior_p IS NOT NULL`,
    [userId],
  );
  if (summaryRes.rows.length === 0) return [];

  const abRes = await query<{
    pattern_id: string;
    sum_alpha: string | null;
    sum_beta: string | null;
  }>(
    `SELECT seed_id::TEXT AS pattern_id,
            SUM(posterior_alpha)::TEXT AS sum_alpha,
            SUM(posterior_beta)::TEXT  AS sum_beta
       FROM pattern_links
      WHERE user_id = $1 AND status IN ('active', 'confirmed')
      GROUP BY seed_id`,
    [userId],
  );
  const abMap = new Map<string, { alpha: number; beta: number }>();
  for (const row of abRes.rows) {
    const alpha = row.sum_alpha === null ? NaN : Number(row.sum_alpha);
    const beta = row.sum_beta === null ? NaN : Number(row.sum_beta);
    abMap.set(row.pattern_id, { alpha, beta });
  }

  const rows: SeedInfluenceRow[] = [];
  for (const r of summaryRes.rows) {
    const ab = abMap.get(r.pattern_id);
    if (!ab || !Number.isFinite(ab.alpha) || !Number.isFinite(ab.beta)) continue;
    const mean = posteriorMean(ab.alpha, ab.beta);
    const { lower, upper } = credibleInterval(ab.alpha, ab.beta);
    if (!Number.isFinite(lower)) continue;
    rows.push({
      patternId: Number(r.pattern_id),
      patternKind: r.pattern_kind,
      signalName: r.pattern_name,
      description: r.pattern_description,
      seedLabel: seedLabel({ name: r.pattern_name, description: r.pattern_description }),
      totalHits: Math.max(0, Math.round(Number(r.total_hits))),
      totalMisses: Math.max(0, Math.round(Number(r.total_misses))),
      posteriorP: mean,
      ciLower: lower,
      ciUpper: upper,
    });
  }
  rows.sort((a, b) => b.ciLower - a.ciLower);
  return rows.slice(0, topN);
};

/** saju_response_profile INSERT 컬럼(user_id 제외 — 행마다 $1 공유). */
const RESPONSE_PROFILE_COLS = [
  'axis_level',
  'axis_key',
  'element',
  'domain',
  'tier',
  'alpha',
  'beta',
  'shrunk_effect',
  'n_links',
  'n_active_days',
  'stability',
  'source_link_ids',
] as const;

/** 파생 셀 user당 full-replace — DELETE → 다중 INSERT를 한 트랜잭션으로(원자적, ADR-0049). */
const replaceResponseProfile = async (userId: number, cells: ResponseCell[]): Promise<void> => {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM saju_response_profile WHERE user_id = $1', [userId]);
    if (cells.length === 0) return;
    const params: unknown[] = [userId];
    const valueRows: string[] = [];
    for (const c of cells) {
      const b = params.length; // 다음 placeholder = $(b+1)
      params.push(
        c.axisLevel,
        c.axisKey,
        c.element,
        c.domain,
        c.tier,
        c.alpha,
        c.beta,
        c.shrunkEffect,
        c.nLinks,
        c.nActiveDays,
        c.stability,
        JSON.stringify(c.sourceLinkIds),
      );
      valueRows.push(
        `($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, ` +
          `$${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}::jsonb)`,
      );
    }
    await client.query(
      `INSERT INTO saju_response_profile (user_id, ${RESPONSE_PROFILE_COLS.join(', ')})
       VALUES ${valueRows.join(', ')}`,
      params,
    );
  });
};

interface ProfileLinkRow {
  link_id: number;
  seed_id: number;
  status: string;
  domain: string | null;
  posterior_alpha: string | null;
  posterior_beta: string | null;
  posterior_p: string | null;
  hit_count: number;
  miss_count: number;
  test_detail: Record<string, unknown> | null;
  confound: ConfoundData | null;
}

/**
 * confirmed+active 링크 → saju_response_profile 집계 후 user당 full-replace (#523 P1, ADR-0049).
 * processUser 말미 격리 호출 — 실패해도 검증 카드·발굴 무탈(파생 레이어). confirmed는 sticky라
 * verifyUserLinks 결과에 없으므로 여기서 DB로 직접 로드(active+confirmed 둘 다, 교정된 Phase 0 수치).
 */
const persistResponseProfile = async (userId: number): Promise<void> => {
  const natal = await loadNatalContext(userId);
  if (!natal) {
    console.warn(`[ResponseProfile] user=${userId} 원국 없음 — 집계 생략`);
    return;
  }
  const [stemNameToId, branchNameToId] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);
  const stemNameById = new Map([...stemNameToId].map(([name, id]) => [id, name] as const));
  const branchNameById = new Map([...branchNameToId].map(([name, id]) => [id, name] as const));
  const seeds = await loadActiveSeeds(userId);
  const seedById = new Map(seeds.map((s) => [s.id, s]));

  const linkRes = await query<ProfileLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.status, s.domain,
            l.posterior_alpha, l.posterior_beta, l.posterior_p,
            l.hit_count, l.miss_count, l.test_detail, l.confound
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status IN ('active', 'confirmed')
        AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );

  const links: ProfileLink[] = [];
  for (const r of linkRes.rows) {
    if (!r.domain) continue; // 도메인 없는 신호는 셀 분할 불가 — 제외
    const td: Record<string, unknown> = r.test_detail ?? {};
    const rateOff = typeof td['rate_off'] === 'number' ? (td['rate_off'] as number) : NaN;
    const stabilityRaw = td['stability'];
    const confound = r.confound;
    const att = confound?.adjusted?.find((a) => a.verdict === 'attenuated');
    links.push({
      linkId: r.link_id,
      seedId: r.seed_id,
      status: r.status === 'confirmed' ? 'confirmed' : 'active',
      domain: r.domain,
      posteriorAlpha: Number(r.posterior_alpha),
      posteriorBeta: Number(r.posterior_beta),
      posteriorP: r.posterior_p === null ? NaN : Number(r.posterior_p),
      rateOff,
      nActive: r.hit_count + r.miss_count,
      stability: typeof stabilityRaw === 'boolean' ? stabilityRaw : null,
      explainedAway: confound?.explainedAway === true,
      attenuatedEffect: att && Number.isFinite(att.adjEffect) ? att.adjEffect : null,
    });
  }

  const cells = buildResponseProfile(
    links,
    seedById,
    natal.dayMaster,
    stemNameById,
    branchNameById,
  );
  await replaceResponseProfile(userId, cells);
  console.warn(
    `[ResponseProfile] user=${userId} 셀 ${cells.length} (입력 링크 ${links.length}) full-replace`,
  );
};

const processUser = async (
  app: App,
  userId: number,
  channelId: string,
  weekStart: string,
  today: string,
): Promise<void> => {
  // 강도 분위수 컷 갱신(일별 cron 핸드오프) — 검증과 독립. 실패해도 링크 검증은 진행.
  try {
    const cutpoints = await computeStrengthCutpoints(userId, today);
    await persistStrengthCutpoints(userId, cutpoints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 강도 컷 산출/저장 실패 user=${userId}: ${msg}`);
  }

  const results = await verifyUserLinks(userId, today);

  // 직전 주 e_value 먼저 로드(이번 주 스냅샷 쓰기 전 — delta가 과거만 반영하게).
  let prevEValues = new Map<number, number>();
  try {
    prevEValues = await loadPrevWeekEValues(userId, weekStart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 직전주 e_value 로드 실패 user=${userId}: ${msg}`);
  }

  let persisted = 0;
  for (const l of results) {
    // per-link 격리(#434 Phase 8a) — 한 링크 UPDATE 실패가 전체를 막지 않게.
    try {
      await persistLinkVerification(l);
      await persistWeeklySnapshot(userId, l, weekStart);
      persisted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] 링크 persist 실패 link=${l.linkId}: ${msg}`);
    }
  }

  // 포화 시드 양방향 가드(#508 ③, ADR-0046) — 검정 불가 시드 자동 archive ⟷ 탈포화 부활.
  // 검증/발굴과 독립 격리: 실패해도 검증 카드는 무탈(빈 결과). 발굴 surface 전(부활 시드 재페어링 위해).
  let hygiene: SaturationSweepResult = { archived: [], revived: [] };
  try {
    hygiene = await runSaturationSweep(userId, today);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Saturation] user=${userId} sweep 실패: ${msg}`);
  }

  let seedInfluence: SeedInfluenceRow[] = [];
  try {
    seedInfluence = await loadSeedInfluence(userId, SEED_INFLUENCE_TOP_N);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 시드 영향력 로드 실패 user=${userId}: ${msg}`);
  }

  const verified = results.filter((l) => l.nextStatus === 'confirmed').length;
  const rejects = results.filter((l) => l.verdict === 'reject').length;
  console.warn(
    `[Verification] user=${userId} 링크 ${results.length} (persist ${persisted}) verified ${verified} reject ${rejects}`,
  );
  // 가족별 BH 집합 크기(m) 관측 — 발굴 승인 누적에 따른 가족 m-인플레이션 추적(#523 P0, §2-5).
  const familyTally = results.reduce<Map<string, number>>(
    (m, l) => m.set(l.family, (m.get(l.family) ?? 0) + 1),
    new Map(),
  );
  console.warn(
    `[Verification] user=${userId} 가족별 링크 ${[...familyTally].map(([f, n]) => `${f}=${n}`).join(' ') || '없음'}`,
  );

  // 교란 플래그(P6, ADR-0041) — 검증/발굴과 독립 격리. 실패해도 검증 카드는 무탈(빈 맵).
  const confoundByLink = new Map<number, ConfoundData>();
  try {
    const cr = await flagConfounds(userId, today);
    let flagged = 0;
    let adjusted = 0; // P7 — 게이트 통과해 MH 조정한 링크 수
    let explainedAway = 0; // P7 — 조정 후 어부지리 판정(노출 강등 대상)
    for (const r of cr) {
      try {
        await persistConfound(userId, r);
        confoundByLink.set(r.linkId, r.confound);
        if (r.confound.suspected.length > 0) flagged += 1;
        if (r.confound.adjusted && r.confound.adjusted.length > 0) adjusted += 1;
        if (r.confound.explainedAway) explainedAway += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Confound] persist 실패 link=${r.linkId}: ${msg}`);
      }
    }
    console.warn(
      `[Confound] user=${userId} 교란 플래그 ${flagged}/${cr.length} 링크 · 조정 ${adjusted} · 어부지리 ${explainedAway}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Confound] user=${userId} 교란 플래그 실패: ${msg}`);
  }

  // 교란 caveat용 시드 라벨 맵(#504 P2, ADR-0045) — 실패해도 카드는 무탈(빈 맵 → 중립 표현).
  let seedLabelById = new Map<number, string>();
  try {
    const allSeeds = await loadActiveSeeds(userId);
    seedLabelById = new Map(
      allSeeds.map((s) => [s.id, seedLabel({ name: s.name, description: s.description })]),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 시드 라벨 맵 로드 실패 user=${userId}: ${msg}`);
  }

  const blocks = buildVerificationBlocks(
    weekStart,
    results,
    seedInfluence,
    prevEValues,
    confoundByLink,
    seedLabelById,
  );
  // 포화 가드 알림을 카드 말미에 append(#508 ③) — 변수명 미노출 라벨.
  blocks.push(
    ...buildHygieneNotice(
      hygiene.archived.map((s) => s.label),
      hygiene.revived.map((s) => s.label),
    ),
  );
  const fallback = `패턴 검증 주간 리포트 (${weekStart} ~) — 링크 ${results.length}건`;
  try {
    await postBlockMessage(app.client, channelId, fallback, blocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 카드 전송 실패 user=${userId}: ${msg}`);
  }

  // 검증 후 발굴 단계 — 검증 결과를 막지 않게 격리(검증은 이미 완료·발송됨).
  try {
    await recommendDiscoveries(app, userId, channelId, today);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Discovery] user=${userId} 발굴 실패: ${msg}`);
  }

  // 개인화 가중치 집계(#523 P1) — 파생 레이어 격리. 실패해도 검증·발굴 무탈(Phase 2·3가 소비).
  try {
    await persistResponseProfile(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ResponseProfile] user=${userId} 집계 실패: ${msg}`);
  }
};

/**
 * 본체 — life-cron SLOT_TASKS에서 호출. 매일 등록되지만 월요일만 실행(weeklyReport 패턴).
 */
export const weeklyVerificationTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  if (getKSTDayOfWeek() !== 1) return;
  const today = getTodayISO();
  const weekStart = previousMondayISO(today);
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await processUser(app, DEFAULT_USER_ID, insightFallback, weekStart, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId, weekStart, today);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
