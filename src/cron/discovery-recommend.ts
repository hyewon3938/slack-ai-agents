/**
 * 발굴 후보 재추천 — 묶음 전부 패스 시 다음 best 묶음을 데일리 틱으로 surface (#504 P3, ADR-0047).
 *
 * 월요일 06:00 weekly-verification과 공유하는 surface 함수(recommendDiscoveries) +
 * 데일리 슬롯(discoveryRecommend, 07:30). 데일리는 싼 예측(이번주 묶음 전부 archived & cap 미만)
 * 통과 시에만 무거운 발굴 재실행. 여집합 자동제외 덕에 재실행=다음 best(커서 없음).
 * 통계·verdict·승인 게이트·카드 불변 — 재실행 *시점*만 늘림.
 */

import type { App } from '@slack/bolt';
import { query } from '../shared/db.js';
import { postBlockMessage } from '../shared/slack.js';
import { getTodayISO, thisWeekMondayISO } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import { INSIGHT_THRESHOLDS } from '../shared/insight-thresholds.js';
import {
  discoverCandidates,
  insertPendingDiscoveryLink,
} from '../agents/insight/hypothesis-discovery.js';
import { buildDiscoveryCandidateCard } from '../agents/insight/hypothesis-cards.js';
import type { LifeCronConfig } from './life-cron.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

/**
 * 링크 없는 (시드×신호) 여집합 off-day 스캔 → pending 링크 선INSERT → 맥락 풍부 승인 카드 발송.
 * 발견 q·top-N(노브)이 후보 폭주를 막는다. 카드 = 노출·큐레이션 제안일 뿐, 진짜인지는
 * 승인 후 주간 e-value 트랙이 가린다(노출·믿음 분리, ADR-0039 §3).
 * 월요일 주간 엔진(검증 후)과 데일리 재추천이 공용. (구 weekly-verification surfaceDiscoveries.)
 */
export const recommendDiscoveries = async (
  app: App,
  userId: number,
  channelId: string,
  today: string,
): Promise<void> => {
  const candidates = await discoverCandidates(userId, today);
  if (candidates.length === 0) return;
  let surfaced = 0;
  for (const c of candidates) {
    const linkId = await insertPendingDiscoveryLink(userId, c);
    if (linkId === null) continue; // ON CONFLICT(이미 존재) — 카드 스킵
    const cardBlocks = buildDiscoveryCandidateCard({ ...c, linkId });
    const cardFallback = `새 패턴 후보 — ${c.seedLabel} × ${c.signalLabel}`;
    await postBlockMessage(app.client, channelId, cardFallback, cardBlocks);
    surfaced += 1;
  }
  console.warn(`[Discovery] user=${userId} surface ${surfaced}/${candidates.length}`);
};

/**
 * 재추천 발사 결정(순수 코어, 테스트 가능). 이번주 발굴 묶음이 전부 패스(archived)됐고
 * 백스톱 cap 미만일 때만 true. archived==total 단일 조건이 "무응답 보류"(pending 남음)와
 * "일부 승인 정지"(active 있음)를 동시에 배제 — 전부 패스됐을 때만 다음 묶음.
 */
export const decideReRecommend = (total: number, archived: number, cap: number): boolean =>
  total > 0 && archived === total && total < cap;

/** 이번주(월요일 KST 00:00~) 발굴 링크 카운트 → 재추천 발사 여부. */
const shouldReRecommend = async (userId: number, today: string): Promise<boolean> => {
  const monday = thisWeekMondayISO(today);
  const res = await query<{ total: string; archived: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'archived')::text AS archived
       FROM pattern_links
      WHERE user_id = $1 AND source = 'discovery' AND created_at >= $2::timestamptz`,
    [userId, `${monday} 00:00:00+09`],
  );
  const total = Number(res.rows[0]?.total ?? 0);
  const archived = Number(res.rows[0]?.archived ?? 0);
  return decideReRecommend(total, archived, V.weeklyDiscoveryCap);
};

/** 한 유저: 예측 통과 시에만 재추천 발사 (유저별 에러 격리). */
const maybeRecommend = async (
  app: App,
  userId: number,
  channelId: string,
  today: string,
): Promise<void> => {
  if (!(await shouldReRecommend(userId, today))) return;
  await recommendDiscoveries(app, userId, channelId, today);
  console.warn(`[Discovery] user=${userId} 재추천 발사 (이번주 묶음 전부 패스)`);
};

/**
 * 데일리 슬롯 본체 — SLOT_TASKS['discoveryRecommend']. 매일 07:30 KST.
 * 유저별 예측 게이트 → 발사. (insight 채널 해석은 weekly-verification 패턴 미러.)
 */
export const discoveryRecommendTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await maybeRecommend(app, DEFAULT_USER_ID, insightFallback, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await maybeRecommend(app, mapping.userId, channelId, today);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Discovery] user=${mapping.userId} 재추천 실패: ${msg}`);
    }
  }
};
