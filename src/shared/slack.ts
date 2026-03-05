import type { SayFn } from '@slack/bolt';

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
