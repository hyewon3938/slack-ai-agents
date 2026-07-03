/**
 * Insight 에이전트 Slack 액션 핸들러.
 *
 * - 발굴 승인 카드 [추적 시작]/[패스] — pending pattern_link → active/archived (#477 P5a, ADR-0039).
 *   사람은 노출·큐레이션(추적할 가치)만 게이트, 믿음(진짜인지)은 주간 e-value 트랙이 가린다.
 * - LLM 신호 승인/반려 [측정 시작]/[반려] — signal_defs(source=llm) pending → active/rejected
 *   (#477 P5b, ADR-0040). 승인 시 게이트 #1(validateSignalSql) 재검증 통과해야만 활성화.
 *   사람은 큐레이션만 게이트, untrusted SQL의 안전은 검증·격리가, 진짜인지는 off-day 통계가 가린다.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { query } from '../../shared/db.js';
import { findEquivalentSignal } from '../../shared/signal-defs.js';
import { validateSignalSql } from '../../shared/signal-sql-guard.js';
import { resolveActionCard, updateMessage } from '../../shared/slack.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import {
  DISCOVERY_APPROVE_ACTION_ID,
  DISCOVERY_DISMISS_ACTION_ID,
  decodeDiscoveryPayload,
} from './hypothesis-cards.js';
import {
  LLM_SIGNAL_APPROVE_ACTION_ID,
  LLM_SIGNAL_REJECT_ACTION_ID,
  decodeLlmSignalPayload,
} from './llm-signal-cards.js';

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

/** Slack action body에서 원본 메시지 블록 안전 추출 (없으면 빈 배열). */
export const extractMessageBlocks = (body: unknown): KnownBlock[] => {
  if (!body || typeof body !== 'object') return [];
  const message = (body as { message?: { blocks?: unknown } }).message;
  if (!message || !Array.isArray(message.blocks)) return [];
  return message.blocks as KnownBlock[];
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

// ─── LLM 신호 승인/반려 — signal_defs(source=llm) status 전이 (테스트 가능 코어, ADR-0040) ──

/**
 * LLM 신호 승인 — 게이트 #1 정적 재검증 통과 시에만 pending → active (#477 P5b).
 * 저장된 sql_body도 불신: 승인 시점에 validateSignalSql 재실행, 실패하면 활성화 거부(미승인 = 실행 0).
 *
 * 재생성 가드(#557): monthly-signal-suggest routine(repo 밖)이 기각 이력이 있는 동일 정의를 다시
 * pending으로 INSERT할 수 있다 — SKILL 프롬프트가 그걸 걸러도 봇 승인 게이트가 최종 방어선이다.
 * 승격 직전 findEquivalentSignal(자신 제외)로 동일 측정 정의를 확인:
 *   - 다른 active/pending 동일 정의가 있으면 중복 활성화 거부(reuse).
 *   - rejected 동일 정의만 있으면 기각 재활성화 거부(skip_rejected) — 사람이 기각한 걸 조용히 되살리지 않는다.
 *
 * 가드: 본인(user_id=$2) + pending + source='llm'만. @returns 활성화된 signalId, 아니면 null.
 */
export const approveLlmSignal = async (
  userId: number,
  signalId: number,
): Promise<number | null> => {
  const sel = await query<{
    sql_body: string | null;
    name: string;
    kind: 'sql' | 'tag';
    direction: string | null;
    threshold: string | null;
    tag_name: string | null;
  }>(
    `SELECT sql_body, name, kind, direction, threshold, tag_name FROM signal_defs
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'`,
    [signalId, userId],
  );
  const row = sel.rows[0];
  const sql = row?.sql_body;
  if (!row || !sql) return null;
  const err = validateSignalSql(sql);
  if (err) {
    console.warn(`[Insight Action] llm_signal 승인 거부(검증 실패) id=${signalId}: ${err}`);
    return null;
  }
  const eq = await findEquivalentSignal(
    userId,
    {
      name: row.name,
      kind: row.kind,
      direction: row.direction,
      threshold: row.threshold === null ? null : Number(row.threshold),
      tagName: row.tag_name,
      sqlBody: row.sql_body,
    },
    signalId,
  );
  if (eq.decision !== 'absent') {
    const why = eq.decision === 'reuse' ? '동일 정의 이미 활성/대기' : '기각 이력 재활성화 차단';
    console.warn(`[Insight Action] llm_signal 승인 거부(${why}) id=${signalId}`);
    return null;
  }
  const res = await query<{ id: number }>(
    `UPDATE signal_defs SET status = 'active', approved_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'
       RETURNING id`,
    [signalId, userId],
  );
  return res.rows[0]?.id ?? null;
};

/**
 * LLM 신호 반려 — pending → rejected. 동일 가드(본인·pending·llm). 재제안 시 LLM이 차이를 명시해야.
 * @returns 반려된 signalId, 아니면 null.
 */
export const rejectLlmSignal = async (userId: number, signalId: number): Promise<number | null> => {
  const res = await query<{ id: number }>(
    `UPDATE signal_defs SET status = 'rejected'
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source = 'llm'
       RETURNING id`,
    [signalId, userId],
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
        const notice = '✅ 추적 시작함 — 다음 주간 검증부터 off-day 대조로 진짜인지 가린다.';
        await updateMessage(
          client,
          channelId,
          messageTs,
          notice,
          resolveActionCard(extractMessageBlocks(body), notice),
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
        const notice = '패스함 — 추적 안 함.';
        await updateMessage(
          client,
          channelId,
          messageTs,
          notice,
          resolveActionCard(extractMessageBlocks(body), notice),
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] discovery_dismiss 오류: ${msg}`);
    }
  });

  // ── LLM 신호 승인/반려 — signal_defs(source=llm) pending → active/rejected (#477 P5b, ADR-0040) ──
  app.action(LLM_SIGNAL_APPROVE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeLlmSignalPayload(raw);
    if (!payload) {
      console.warn('[Insight Action] llm_signal_approve: payload 디코딩 실패');
      return;
    }
    try {
      const userId = await resolveBodyUserId(body);
      const signalId = await approveLlmSignal(userId, payload.signalId);
      const { channelId, messageTs } = extractChannelTs(body);
      if (!channelId || !messageTs) return;
      if (signalId === null) {
        const notice = '검증 실패 또는 이미 처리됨 — 활성화 안 됨.';
        await updateMessage(
          client,
          channelId,
          messageTs,
          notice,
          resolveActionCard(extractMessageBlocks(body), notice),
        );
        return;
      }
      const notice =
        '✅ 측정 시작함 — 매일 이 신호를 재고, 다음 발굴에서 시드와 연결되면 off-day로 검정한다.';
      await updateMessage(
        client,
        channelId,
        messageTs,
        notice,
        resolveActionCard(extractMessageBlocks(body), notice),
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] llm_signal_approve 오류: ${msg}`);
    }
  });

  app.action(LLM_SIGNAL_REJECT_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeLlmSignalPayload(raw);
    if (!payload) return;
    try {
      const userId = await resolveBodyUserId(body);
      await rejectLlmSignal(userId, payload.signalId);
      const { channelId, messageTs } = extractChannelTs(body);
      if (channelId && messageTs) {
        const notice = '반려함 — 측정 안 함.';
        await updateMessage(
          client,
          channelId,
          messageTs,
          notice,
          resolveActionCard(extractMessageBlocks(body), notice),
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] llm_signal_reject 오류: ${msg}`);
    }
  });
};
