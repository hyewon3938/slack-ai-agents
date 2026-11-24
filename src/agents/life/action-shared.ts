/**
 * Life Agent 액션 핸들러 공용 — 핸들러 인자 타입, Slack body → userId 해석.
 */

import type { AllMiddlewareArgs, SlackActionMiddlewareArgs } from '@slack/bolt';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';

/** app.action 핸들러 인자 */
export type ActionArgs = SlackActionMiddlewareArgs & AllMiddlewareArgs;

/** Slack body에서 userId 해석 (미등록이면 DEFAULT_USER_ID 폴백) */
export const resolveBodyUserId = async (body: {
  user?: string | { id: string };
}): Promise<number> => {
  const slackUserId = body.user ? (typeof body.user === 'string' ? body.user : body.user.id) : '';
  if (!slackUserId) return DEFAULT_USER_ID;
  return (await resolveUserId(slackUserId)) ?? DEFAULT_USER_ID;
};
