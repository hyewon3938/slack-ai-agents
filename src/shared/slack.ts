import type { SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';

export const postToChannel = async (
  client: WebClient,
  channel: string,
  text: string,
): Promise<void> => {
  await client.chat.postMessage({ channel, text });
};

export const sendMessage = async (
  say: SayFn,
  text: string,
): Promise<void> => {
  await say(text);
};

export const sendThreadReply = async (
  say: SayFn,
  text: string,
  threadTs: string,
): Promise<void> => {
  await say({ text, thread_ts: threadTs });
};
