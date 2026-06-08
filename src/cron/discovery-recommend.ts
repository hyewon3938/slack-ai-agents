/**
 * 발굴 후보 surface 공유 모듈 (#477 P5a, ADR-0039).
 *
 * 월요일 06:00 weekly-verification(검증 후 발굴)과 데일리 재추천이 공유하는 surface 함수.
 * weekly-verification의 private surfaceDiscoveries를 함수 레벨 DRY로 추출 — 동작 동일.
 * (재추천 데일리 슬롯·예측 게이트는 #504 Phase 3에서 같은 모듈에 추가.)
 */

import type { App } from '@slack/bolt';
import { postBlockMessage } from '../shared/slack.js';
import {
  discoverCandidates,
  insertPendingDiscoveryLink,
} from '../agents/insight/hypothesis-discovery.js';
import { buildDiscoveryCandidateCard } from '../agents/insight/hypothesis-cards.js';

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
