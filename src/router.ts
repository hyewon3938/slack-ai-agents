import type { App, KnownEventFromType, SayFn } from '@slack/bolt';

type MessageEvent = KnownEventFromType<'message'>;

export type AgentHandler = (
  message: MessageEvent,
  say: SayFn,
) => Promise<void>;

const channelAgentMap = new Map<string, AgentHandler>();

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

    if (handler) {
      await handler(message as MessageEvent, say);
    }
  });
};
