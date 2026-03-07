import type { SayFn } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';

export const postToChannel = async (
  client: WebClient,
  channel: string,
  text: string,
): Promise<void> => {
  await client.chat.postMessage({ channel, text });
};

/** Block Kit 메시지 전송 (인터랙티브 메시지용) */
export const postBlockMessage = async (
  client: WebClient,
  channel: string,
  text: string,
  blocks: KnownBlock[],
): Promise<{ ts: string; channel: string }> => {
  const result = await client.chat.postMessage({ channel, text, blocks });
  return { ts: result.ts as string, channel: result.channel as string };
};

/** 기존 메시지를 인플레이스 업데이트 (버튼 클릭 후 갱신용) */
export const updateMessage = async (
  client: WebClient,
  channel: string,
  ts: string,
  text: string,
  blocks: KnownBlock[],
): Promise<void> => {
  await client.chat.update({ channel, ts, text, blocks });
};

export const sendMessage = async (
  say: SayFn,
  text: string,
): Promise<void> => {
  await say(text);
};

/** Block Kit 메시지 전송 (say 함수 사용) */
export const sendBlockMessage = async (
  say: SayFn,
  text: string,
  blocks: KnownBlock[],
): Promise<void> => {
  await say({ text, blocks });
};

export const sendThreadReply = async (
  say: SayFn,
  text: string,
  threadTs: string,
): Promise<void> => {
  await say({ text, thread_ts: threadTs });
};
