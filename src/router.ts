import type { App, KnownEventFromType, SayFn } from '@slack/bolt';
import { RateLimiter } from './shared/rate-limiter.js';

type MessageEvent = KnownEventFromType<'message'>;

export type AgentHandler = (
  message: MessageEvent,
  say: SayFn,
) => Promise<void>;

const channelAgentMap = new Map<string, AgentHandler>();

/** 유저별 rate limiter (1분 5회) */
const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });

/** 메시지 최대 길이 (10KB) */
const MAX_MESSAGE_LENGTH = 10_000;

/** rate limiter 메모리 정리 (10분 주기) */
setInterval(() => rateLimiter.cleanup(), 10 * 60_000);

export const registerAgent = (
  channelId: string,
  handler: AgentHandler,
): void => {
  channelAgentMap.set(channelId, handler);
};

export const registerMessageHandler = (app: App): void => {
  app.message(async ({ message, say }) => {
    if ('bot_id' in message) return;
    if (message.subtype) return;

    const handler = channelAgentMap.get(message.channel);
    if (!handler) return;

    // 유저 식별
    const msg = message as MessageEvent;
    const userId = ('user' in msg ? msg.user : undefined) ?? message.channel;

    // 메시지 길이 제한 — 처리하지 않을 메시지가 요청 한도를 쓰지 않게 한도 차감보다 먼저 본다
    const text = 'text' in message ? (message.text ?? '') : '';
    if (text.length > MAX_MESSAGE_LENGTH) {
      await say('메시지가 너무 길어. 좀 줄여서 다시 보내줘.');
      return;
    }

    // Rate limiting
    if (!rateLimiter.check(userId)) {
      await say('잠깐, 너무 빨라. 1분에 5번까지만 가능해.');
      return;
    }

    await handler(message as MessageEvent, say);
  });
};
