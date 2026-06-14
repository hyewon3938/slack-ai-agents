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

/** Block Kit 메시지 전송 (인터랙티브 메시지용). threadTs 지정 시 스레드 답글 */
export const postBlockMessage = async (
  client: WebClient,
  channel: string,
  text: string,
  blocks: KnownBlock[],
  threadTs?: string,
): Promise<{ ts: string; channel: string }> => {
  const result = await client.chat.postMessage({
    channel,
    text,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
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

/**
 * 인터랙션 카드 갱신용 — actions(버튼) 블록만 제거하고 처리 결과 안내 context를 덧붙인다.
 * 제안 본문(section/context 등) 블록은 보존해 버튼 클릭 후에도 어떤 제안이었는지 남는다.
 */
export const resolveActionCard = (blocks: KnownBlock[], noticeText: string): KnownBlock[] => {
  const kept = blocks.filter((b) => b.type !== 'actions');
  return [...kept, { type: 'context', elements: [{ type: 'mrkdwn', text: noticeText }] }];
};

export const sendMessage = async (say: SayFn, text: string): Promise<void> => {
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
