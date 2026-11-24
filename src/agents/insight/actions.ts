/**
 * Insight 에이전트 Slack 액션 핸들러.
 *
 * - 발굴 승인 카드 [추적 시작]/[패스] — pending pattern_link → active/archived (#477 P5a, ADR-0039).
 *   사람은 노출·큐레이션(추적할 가치)만 게이트, 믿음(진짜인지)은 주간 e-value 트랙이 가린다.
 * - LLM 신호 승인/반려 [측정 시작]/[반려] — signal_defs(source=llm) pending → active/rejected
 *   (#477 P5b, ADR-0040). 승인 시 게이트 #1(validateSignalSql) 재검증 통과해야만 활성화.
 *   사람은 큐레이션만 게이트, untrusted SQL의 안전은 검증·격리가, 진짜인지는 off-day 통계가 가린다.
 */

import type { AllMiddlewareArgs, App, SlackActionMiddlewareArgs } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
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
import {
  approveDiscoveryLink,
  dismissDiscoveryLink,
  approveLlmSignal,
  rejectLlmSignal,
} from './action-transitions.js';

/** app.action 핸들러 인자 */
type ActionArgs = SlackActionMiddlewareArgs & AllMiddlewareArgs;

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
const extractChannelTs = (body: unknown): { channelId?: string; messageTs?: string } => {
  const b = body as { channel?: { id?: string }; message?: { ts?: string } };
  return {
    channelId: b.channel?.id,
    messageTs: b.message?.ts,
  };
};
/** 발굴 후보 [추적 시작] */
const handleDiscoveryApprove = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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
};

/** 발굴 후보 [패스] */
const handleDiscoveryDismiss = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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
};

/** LLM 신호 [측정 시작] */
const handleLlmSignalApprove = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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
};

/** LLM 신호 [반려] */
const handleLlmSignalReject = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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
};

export const registerInsightActions = (app: App): void => {
  app.action(DISCOVERY_APPROVE_ACTION_ID, handleDiscoveryApprove);
  app.action(DISCOVERY_DISMISS_ACTION_ID, handleDiscoveryDismiss);

  // ── LLM 신호 승인/반려 — signal_defs(source=llm) pending → active/rejected (#477 P5b, ADR-0040) ──
  app.action(LLM_SIGNAL_APPROVE_ACTION_ID, handleLlmSignalApprove);
  app.action(LLM_SIGNAL_REJECT_ACTION_ID, handleLlmSignalReject);
};
