/**
 * Insight 에이전트 Slack 액션 핸들러.
 *
 * - 발굴 승인 카드 [추적 시작]/[패스] — pending pattern_link → active/archived (#477 P5a, ADR-0039).
 *   사람은 노출·큐레이션(추적할 가치)만 게이트, 믿음(진짜인지)은 주간 e-value 트랙이 가린다.
 * - LLM 매트릭 승인/거절 — P5b까지 suspended (signal_defs source=llm 모델로 포팅 대기).
 */

import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { updateMessage } from '../../shared/slack.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import {
  DISCOVERY_APPROVE_ACTION_ID,
  DISCOVERY_DISMISS_ACTION_ID,
  decodeDiscoveryPayload,
} from './hypothesis-cards.js';
import { METRIC_APPROVE_ACTION_ID, METRIC_REJECT_ACTION_ID } from './metric-approval-cards.js';

/**
 * #477 P5b — LLM 매트릭 승인/거절 인터랙션 비활성 플래그.
 * 옛 pattern_metrics(DROP) 참조 핸들러 → 발굴 승인(P5a)은 pattern_links로 재구축 완료,
 * LLM 신호 제안(P5b)은 signal_defs(source=llm, status=pending) 모델 포팅 대기.
 */
const METRIC_INTERACTION_SUSPENDED_P5B = true;

const resolveBodyUserId = async (body: { user?: string | { id: string } }): Promise<number> => {
  const slackUserId = body.user ? (typeof body.user === 'string' ? body.user : body.user.id) : '';
  if (!slackUserId) return DEFAULT_USER_ID;
  return (await resolveUserId(slackUserId)) ?? DEFAULT_USER_ID;
};

const extractRawValue = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const actions = (body as { actions?: unknown }).actions;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const first = actions[0];
  if (!first || typeof first !== 'object') return null;
  const value = (first as { value?: unknown }).value;
  return typeof value === 'string' ? value : null;
};

// ─── 발굴 승인/패스 — pending pattern_link status 전이 (테스트 가능 코어) ──

/**
 * 발굴 후보 승인 — pending → active. 다음 주간 검증부터 off-day 대조 대상.
 * @returns 전이된 링크 id (pending 아님/타 유저면 null).
 */
export const approveDiscoveryLink = async (
  userId: number,
  linkId: number,
): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE pattern_links SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
    [linkId, userId],
  );
  return res.rows[0]?.id ?? null;
};

/**
 * 발굴 후보 패스 — pending → archived. 사용자 "추적 안 함"이지 통계 'rejected'(데이터 "연관 없음")가 아님.
 * 둘 다 여집합 제외라 재부상 안 함. @returns 전이된 링크 id (pending 아님/타 유저면 null).
 */
export const dismissDiscoveryLink = async (
  userId: number,
  linkId: number,
): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE pattern_links SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
    [linkId, userId],
  );
  return res.rows[0]?.id ?? null;
};

const extractChannelTs = (body: unknown): { channelId?: string; messageTs?: string } => {
  const b = body as { channel?: { id?: string }; message?: { ts?: string } };
  return {
    channelId: b.channel?.id,
    messageTs: b.message?.ts,
  };
};

export const registerInsightActions = (app: App): void => {
  app.action(DISCOVERY_APPROVE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeDiscoveryPayload(raw);
    if (!payload) {
      console.warn('[Insight Action] discovery_approve: payload 디코딩 실패');
      return;
    }
    try {
      const userId = await resolveBodyUserId(body);
      const linkId = await approveDiscoveryLink(userId, payload.linkId);
      if (linkId === null) {
        console.warn(
          `[Insight Action] discovery_approve: link=${payload.linkId} pending 아님 또는 권한 없음`,
        );
        return;
      }
      const { channelId, messageTs } = extractChannelTs(body);
      if (channelId && messageTs) {
        await updateMessage(
          client,
          channelId,
          messageTs,
          '추적 시작 — 다음 주간 검증부터 off-day 대조로 진짜인지 가린다.',
          [],
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] discovery_approve 오류: ${msg}`);
    }
  });

  app.action(DISCOVERY_DISMISS_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeDiscoveryPayload(raw);
    if (!payload) return;
    try {
      const userId = await resolveBodyUserId(body);
      await dismissDiscoveryLink(userId, payload.linkId);
      const { channelId, messageTs } = extractChannelTs(body);
      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, '_후보 패스함 — 추적 안 함._', []);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] discovery_dismiss 오류: ${msg}`);
    }
  });

  // ── LLM 매트릭 승인/거절 — #477 P5b 재설계 대기 (stale 카드 클릭 graceful no-op) ──
  app.action(METRIC_APPROVE_ACTION_ID, async ({ ack }) => {
    await ack();
    if (METRIC_INTERACTION_SUSPENDED_P5B) {
      console.warn('[Insight Action] metric_approve — #477 P5b LLM 신호 제안 재설계 대기 (skip)');
      return;
    }
  });

  app.action(METRIC_REJECT_ACTION_ID, async ({ ack }) => {
    await ack();
    if (METRIC_INTERACTION_SUSPENDED_P5B) {
      console.warn('[Insight Action] metric_reject — #477 P5b LLM 신호 제안 재설계 대기 (skip)');
      return;
    }
  });
};
