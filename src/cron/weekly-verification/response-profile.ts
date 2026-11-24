import { query, withTransaction } from '../../shared/db.js';
import type { ConfoundData } from '../../shared/pattern/confound-types.js';
import { loadActiveSeeds } from '../../shared/pattern/match-seeds.js';
import { loadNatalContext } from '../../shared/pattern/match-context.js';
import { buildNameIdMap } from '../../shared/pattern/match-day.js';
import { buildResponseProfile, type ProfileLink } from '../../shared/response-profile/aggregate.js';
import { type ResponseCell } from '../../shared/response-profile/axis.js';

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
export const persistResponseProfile = async (userId: number): Promise<void> => {
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
