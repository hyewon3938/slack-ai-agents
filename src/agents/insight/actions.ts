/**
 * Insight 에이전트 Slack 액션 핸들러.
 *
 * - 가설 후보 카드 등록/패스 버튼 (ADR-0019 Phase 4)
 * - LLM 매트릭 후보 카드 승인/거절 버튼 (ADR-0025·0030 Phase 6)
 */

import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { updateMessage } from '../../shared/slack.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import {
  HYPOTHESIS_REGISTER_ACTION_ID,
  HYPOTHESIS_DISMISS_ACTION_ID,
  decodeActionPayload,
} from './hypothesis-cards.js';
import {
  METRIC_APPROVE_ACTION_ID,
  METRIC_REJECT_ACTION_ID,
  decodeMetricActionPayload,
} from './metric-approval-cards.js';

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

export const registerInsightActions = (app: App): void => {
  app.action(HYPOTHESIS_REGISTER_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeActionPayload(raw);
    if (!payload) {
      console.warn('[Insight Action] hypothesis_register: payload 디코딩 실패');
      return;
    }
    try {
      const userId = await resolveBodyUserId(body);
      await query(
        `INSERT INTO pattern_hypotheses (user_id, trigger_spec, enum_target, source)
         VALUES ($1, $2, $3, 'discovery')`,
        [userId, payload.triggerSpec, payload.enumTarget],
      );
      const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs = 'message' in body && body.message ? body.message.ts : undefined;
      if (channelId && messageTs) {
        await updateMessage(
          client,
          channelId,
          messageTs,
          `가설 등록 완료 — \`${payload.enumTarget}\` 주간 추적 시작.`,
          [],
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] hypothesis_register 오류: ${msg}`);
    }
  });

  app.action(HYPOTHESIS_DISMISS_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeActionPayload(raw);
    try {
      const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs = 'message' in body && body.message ? body.message.ts : undefined;
      if (channelId && messageTs) {
        const label = payload?.enumTarget ?? '후보';
        await updateMessage(client, channelId, messageTs, `_${label} 후보 반려함._`, []);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] hypothesis_dismiss 오류: ${msg}`);
    }
  });

  app.action(METRIC_APPROVE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeMetricActionPayload(raw);
    if (!payload) {
      console.warn('[Insight Action] metric_approve: payload 디코딩 실패');
      return;
    }
    try {
      const userId = await resolveBodyUserId(body);
      const res = await query<{ id: number; description: string }>(
        `UPDATE pattern_metrics
           SET status = 'active', approved_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING id, description`,
        [payload.metricId, userId],
      );
      if (res.rows.length === 0) {
        console.warn(
          `[Insight Action] metric_approve: id=${payload.metricId} pending 아님 또는 권한 없음`,
        );
        return;
      }
      const row = res.rows[0];
      const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs = 'message' in body && body.message ? body.message.ts : undefined;
      if (channelId && messageTs) {
        await updateMessage(
          client,
          channelId,
          messageTs,
          `매트릭 승인 완료 — \`${row.description}\` 다음 매칭 cron부터 활성.`,
          [],
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] metric_approve 오류: ${msg}`);
    }
  });

  app.action(METRIC_REJECT_ACTION_ID, async ({ ack, body, client }) => {
    await ack();
    const raw = extractRawValue(body);
    if (!raw) return;
    const payload = decodeMetricActionPayload(raw);
    if (!payload) {
      console.warn('[Insight Action] metric_reject: payload 디코딩 실패');
      return;
    }
    try {
      const userId = await resolveBodyUserId(body);
      await query(
        `UPDATE pattern_metrics
           SET status = 'rejected', rejected_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
        [payload.metricId, userId],
      );
      const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs = 'message' in body && body.message ? body.message.ts : undefined;
      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, `_매트릭 후보 반려._`, []);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Insight Action] metric_reject 오류: ${msg}`);
    }
  });
};
